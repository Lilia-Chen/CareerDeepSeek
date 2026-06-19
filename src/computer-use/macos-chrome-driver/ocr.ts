import process from 'node:process'

import type { ComputerUseConfig } from '../config.js'
import type { Bounds } from '../types.js'
import type {
  OcrCropRect,
  OcrRegionRatio,
  OcrRowEvidence,
  OcrRowSnapshot,
  OcrTextFragmentEvidence,
  OcrTextMatch,
  OcrTextSnapshot,
} from './types.js'

import { runSwiftScript } from '../swift-runner.js'
import { uniqueStrings } from './shared.js'

const DEFAULT_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en-US']
const DEFAULT_MAX_OBSERVATIONS = 64
const MIN_MAX_OBSERVATIONS = 1
const MAX_MAX_OBSERVATIONS = 256
const OCR_ROW_MIN_MERGE_DISTANCE = 36
const OCR_ROW_HEIGHT_MULTIPLIER = 1.5

export interface RecognizeTextInImageInput {
  imagePath: string
  maxObservations?: number
  languages?: string[]
  query?: string
  exact?: boolean
  caseSensitive?: boolean
  minConfidence?: number
  region?: OcrRegionRatio
  ocrScaleFactor?: number
}

export interface NormalizedRecognizeTextInImageInput {
  imagePath: string
  maxObservations: number
  languages: string[]
  query: string
  exact: boolean
  caseSensitive: boolean
  normalizedQuery: string
  minConfidence?: number
  region?: OcrRegionRatio
  ocrScaleFactor: number
}

export interface ProduceOcrRowsInput {
  textSnapshot: OcrTextSnapshot
}

interface RawOcrOutput {
  recognizedAt: string
  imagePath: string
  imageWidth: number
  imageHeight: number
  matches: Array<{
    matchIndex: number
    text: string
    confidence: number
    bounds: Bounds
  }>
}

interface OcrRowAccumulator {
  row: OcrRowEvidence
  centerYSum: number
  centerYCount: number
  maxFragmentHeight: number
}

export function normalizeRecognizeTextInImageInput(
  input: RecognizeTextInImageInput,
): NormalizedRecognizeTextInImageInput {
  const minConfidence = input.minConfidence
  if (minConfidence !== undefined && (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
    throw new RangeError('minConfidence must be between 0 and 1.')
  }

  const maxObservations = clampMaxObservations(input.maxObservations)
  const caseSensitive = input.caseSensitive ?? false
  const query = sanitizeText(input.query ?? '')
  const ocrScaleFactor = normalizeOcrScaleFactor(input.ocrScaleFactor)

  return {
    imagePath: input.imagePath,
    maxObservations,
    languages: input.languages?.length ? input.languages : DEFAULT_LANGUAGES,
    query,
    exact: input.exact ?? false,
    caseSensitive,
    normalizedQuery: normalizeForMatch(query, caseSensitive),
    minConfidence,
    region: input.region ? validateRegion(input.region) : undefined,
    ocrScaleFactor,
  }
}

export function buildOcrTextSnapshot(
  raw: RawOcrOutput,
  input: NormalizedRecognizeTextInImageInput,
): OcrTextSnapshot {
  const cropRect = input.region ? regionToCropRect(input.region, raw.imageWidth, raw.imageHeight) : undefined
  const rawMatches = raw.matches.slice(0, input.maxObservations)
  const matches = rawMatches.filter(match => ocrMatchPassesFilters(match, input, cropRect))

  return {
    recognizedAt: raw.recognizedAt,
    imagePath: raw.imagePath,
    imageWidth: raw.imageWidth,
    imageHeight: raw.imageHeight,
    query: input.query,
    exact: input.exact,
    caseSensitive: input.caseSensitive,
    normalizedQuery: input.normalizedQuery,
    minConfidence: input.minConfidence,
    region: input.region,
    cropRect,
    ocrScaleFactor: input.ocrScaleFactor,
    matches,
    rawMatchCount: rawMatches.length,
    filteredMatchCount: matches.length,
  }
}

export function groupOcrTextRows(snapshot: OcrTextSnapshot): OcrRowEvidence[] {
  const matches = snapshot.matches
    .slice()
    .sort(compareMatchesByCenterYThenX)

  const rows: OcrRowAccumulator[] = []

  for (const match of matches) {
    const lastRow = rows.at(-1)
    if (lastRow && shouldMergeIntoRow(lastRow, match)) {
      mergeMatchIntoRow(lastRow, match)
      continue
    }

    rows.push(createRowAccumulator(rows.length, match))
  }

  return rows.map(({ row }, rowIndex) => ({
    ...row,
    rowIndex,
    textFragments: row.textFragments
      .slice()
      .sort(compareFragmentsByX),
  }))
}

export async function produceOcrRows(input: ProduceOcrRowsInput): Promise<OcrRowSnapshot> {
  const ocrRows = groupOcrTextRows(input.textSnapshot)
  return {
    strategy: 'ocr-text',
    imagePath: input.textSnapshot.imagePath,
    imageWidth: input.textSnapshot.imageWidth,
    imageHeight: input.textSnapshot.imageHeight,
    rawMatchCount: input.textSnapshot.rawMatchCount,
    filteredMatchCount: input.textSnapshot.filteredMatchCount,
    rowCount: ocrRows.length,
    rows: ocrRows,
    providerDetail: {
      provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
      ocrRowCount: ocrRows.length,
      originalStrategy: 'ocr-text',
    },
    knownLimits: uniqueStrings(ocrRows.flatMap(row => row.knownLimits ?? [])),
  }
}

function clampMaxObservations(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_MAX_OBSERVATIONS
  return Math.min(MAX_MAX_OBSERVATIONS, Math.max(MIN_MAX_OBSERVATIONS, Math.trunc(value)))
}

function compareMatchesByCenterYThenX(a: OcrTextMatch, b: OcrTextMatch): number {
  const dy = centerY(a.bounds) - centerY(b.bounds)
  return dy !== 0 ? dy : a.bounds.x - b.bounds.x
}

function compareFragmentsByX(a: OcrTextFragmentEvidence, b: OcrTextFragmentEvidence): number {
  return (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0)
}

function createRowAccumulator(rowIndex: number, match: OcrTextMatch): OcrRowAccumulator {
  return {
    row: {
      rowIndex,
      source: 'ocr_row',
      bounds: { ...match.bounds },
      textFragments: [matchToFragment(match)],
      confidence: match.confidence,
      knownLimits: ['row grouping is heuristic and capture-local'],
      detail: {
        originalSource: 'ocr-text',
        sourceStrategy: 'ocr-text',
        auvSource: 'ocr-text',
      },
    },
    centerYSum: centerY(match.bounds),
    centerYCount: 1,
    maxFragmentHeight: match.bounds.height,
  }
}

function shouldMergeIntoRow(row: OcrRowAccumulator, match: OcrTextMatch): boolean {
  const rowCenterY = row.centerYSum / row.centerYCount
  const distance = Math.abs(rowCenterY - centerY(match.bounds))
  const threshold = Math.max(OCR_ROW_MIN_MERGE_DISTANCE, Math.max(row.maxFragmentHeight, match.bounds.height) * OCR_ROW_HEIGHT_MULTIPLIER)
  return distance <= threshold
}

function mergeMatchIntoRow(row: OcrRowAccumulator, match: OcrTextMatch): void {
  row.row.bounds = unionBounds(row.row.bounds, match.bounds)
  if (!row.row.textFragments.some(fragment => sameFragment(fragment, match))) {
    row.row.textFragments.push(matchToFragment(match))
    row.centerYSum += centerY(match.bounds)
    row.centerYCount += 1
    row.maxFragmentHeight = Math.max(row.maxFragmentHeight, match.bounds.height)
  }
  row.row.confidence = averageConfidence(row.row.textFragments)
}

function matchToFragment(match: OcrTextMatch): OcrTextFragmentEvidence {
  return {
    matchIndex: match.matchIndex,
    text: match.text,
    confidence: match.confidence,
    bounds: { ...match.bounds },
  }
}

function sameFragment(fragment: OcrTextFragmentEvidence, match: OcrTextMatch): boolean {
  return fragment.text === match.text && boundsEqual(fragment.bounds, match.bounds)
}

function boundsEqual(a: Bounds | undefined, b: Bounds): boolean {
  return a !== undefined
    && a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
}

function averageConfidence(fragments: OcrTextFragmentEvidence[]): number | undefined {
  const confidences = fragments
    .map(fragment => fragment.confidence)
    .filter((confidence): confidence is number => Number.isFinite(confidence))
  if (confidences.length === 0)
    return undefined
  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
}

function centerY(bounds: Bounds): number {
  return bounds.y + bounds.height / 2
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function normalizeOcrScaleFactor(value: number | undefined): number {
  if (value === undefined)
    return 1
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError('ocrScaleFactor must be finite and greater than 0.')
  return value
}

function validateRegion(region: OcrRegionRatio): OcrRegionRatio {
  const values = [region.left, region.top, region.right, region.bottom]
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError('region ratios must be finite values between 0 and 1.')
  }
  if (region.left >= region.right || region.top >= region.bottom) {
    throw new RangeError('region must have left < right and top < bottom.')
  }
  return {
    left: region.left,
    top: region.top,
    right: region.right,
    bottom: region.bottom,
  }
}

function ocrMatchPassesFilters(
  match: RawOcrOutput['matches'][number],
  input: NormalizedRecognizeTextInImageInput,
  cropRect: OcrCropRect | undefined,
): boolean {
  if (input.minConfidence !== undefined && match.confidence < input.minConfidence)
    return false
  if (cropRect && !boundsCenterInside(match.bounds, cropRect))
    return false
  if (!input.normalizedQuery)
    return true

  const normalizedText = normalizeForMatch(match.text, input.caseSensitive)
  if (input.exact
    ? normalizedText === input.normalizedQuery
    : normalizedText.includes(input.normalizedQuery)) {
    return true
  }

  const ocrAnchorFallbackQuery = normalizeOcrAnchorFallbackForMatch(input.query, input.caseSensitive)
  const ocrAnchorFallbackText = normalizeOcrAnchorFallbackForMatch(match.text, input.caseSensitive)
  return input.exact
    ? ocrAnchorFallbackText === ocrAnchorFallbackQuery
    : ocrAnchorFallbackText.includes(ocrAnchorFallbackQuery)
}

function boundsCenterInside(bounds: Bounds, cropRect: OcrCropRect): boolean {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return centerX >= cropRect.x
    && centerX < cropRect.x + cropRect.width
    && centerY >= cropRect.y
    && centerY < cropRect.y + cropRect.height
}

function regionToCropRect(region: OcrRegionRatio, imageWidth: number, imageHeight: number): OcrCropRect {
  const x = Math.round(region.left * imageWidth)
  const y = Math.round(region.top * imageHeight)
  const right = Math.round(region.right * imageWidth)
  const bottom = Math.round(region.bottom * imageHeight)
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(value: string, caseSensitive: boolean): string {
  const sanitized = sanitizeText(value)
  return caseSensitive ? sanitized : sanitized.toLocaleLowerCase()
}

// OCR anchor fallback only: this is not general-purpose text correction.
function normalizeOcrAnchorFallbackForMatch(value: string, caseSensitive: boolean): string {
  const sanitized = sanitizeText(value)
  const cased = caseSensitive ? sanitized : sanitized.toLocaleLowerCase()
  let normalized = ''

  for (const char of cased) {
    const folded = char === '|' || char === '!' || char === 'l' || char === 'I'
      ? 'i'
      : char

    if (/^[a-z0-9]$/i.test(folded)) {
      normalized += folded
    }
  }

  return normalized
}

function ocrScript(): string {
  return String.raw`
import Foundation
import CoreGraphics
import ImageIO
import Vision

struct RegionJSON: Decodable {
  let left: Double
  let top: Double
  let right: Double
  let bottom: Double
}

struct InputJSON: Decodable {
  let imagePath: String
  let maxObservations: Int?
  let languages: [String]?
  let query: String?
  let exact: Bool?
  let caseSensitive: Bool?
  let normalizedQuery: String?
  let region: RegionJSON?
  let ocrScaleFactor: Double?
}

struct BoundsJSON: Encodable {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

struct MatchJSON: Encodable {
  let matchIndex: Int
  let text: String
  let confidence: Double
  let bounds: BoundsJSON
}

struct OutputJSON: Encodable {
  let recognizedAt: String
  let imagePath: String
  let imageWidth: Int
  let imageHeight: Int
  let matches: [MatchJSON]
}

func sanitize(_ value: String) -> String {
  value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
}

func normalizeForMatch(_ value: String, caseSensitive: Bool) -> String {
  let sanitized = sanitize(value)
  return caseSensitive ? sanitized : sanitized.lowercased()
}

// OCR anchor fallback only: this is not general-purpose text correction.
func normalizeOcrAnchorFallbackForMatch(_ value: String, caseSensitive: Bool) -> String {
  let sanitized = sanitize(value)
  let cased = caseSensitive ? sanitized : sanitized.lowercased()
  var output = ""

  for scalar in cased.unicodeScalars {
    let value = scalar.value
    if value == 124 || value == 33 || value == 108 || value == 73 {
      output.append("i")
      continue
    }

    let isDigit = value >= 48 && value <= 57
    let isUppercaseAscii = value >= 65 && value <= 90
    let isLowercaseAscii = value >= 97 && value <= 122
    if isDigit || isUppercaseAscii || isLowercaseAscii {
      output.append(String(scalar))
    }
  }

  return output
}

func matchesQuery(_ text: String, normalizedQuery: String, ocrAnchorFallbackQuery: String, exact: Bool, caseSensitive: Bool) -> Bool {
  if normalizedQuery.isEmpty {
    return !sanitize(text).isEmpty
  }
  let normalizedText = normalizeForMatch(text, caseSensitive: caseSensitive)
  if exact {
    if normalizedText == normalizedQuery {
      return true
    }
    let ocrAnchorFallbackText = normalizeOcrAnchorFallbackForMatch(text, caseSensitive: caseSensitive)
    return ocrAnchorFallbackText == ocrAnchorFallbackQuery
  }

  if normalizedText.contains(normalizedQuery) {
    return true
  }
  let ocrAnchorFallbackText = normalizeOcrAnchorFallbackForMatch(text, caseSensitive: caseSensitive)
  return ocrAnchorFallbackText.contains(ocrAnchorFallbackQuery)
}

func validatedCropRect(_ region: RegionJSON, imageWidth: Int, imageHeight: Int) throws -> CGRect {
  let values = [region.left, region.top, region.right, region.bottom]
  if values.contains(where: { !$0.isFinite || $0 < 0.0 || $0 > 1.0 }) {
    throw NSError(domain: "CareerDeepSeekOCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "region ratios must be finite values between 0 and 1"])
  }
  if region.left >= region.right || region.top >= region.bottom {
    throw NSError(domain: "CareerDeepSeekOCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "region must have left < right and top < bottom"])
  }

  let x = Int((region.left * Double(imageWidth)).rounded())
  let y = Int((region.top * Double(imageHeight)).rounded())
  let right = Int((region.right * Double(imageWidth)).rounded())
  let bottom = Int((region.bottom * Double(imageHeight)).rounded())
  let width = right - x
  let height = bottom - y
  if width <= 0 || height <= 0 {
    throw NSError(domain: "CareerDeepSeekOCR", code: 4, userInfo: [NSLocalizedDescriptionKey: "region crop is empty"])
  }

  return CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(width), height: CGFloat(height))
}

func validatedOcrScaleFactor(_ value: Double?) throws -> Double {
  let ocrScaleFactor = value ?? 1.0
  guard ocrScaleFactor.isFinite && ocrScaleFactor > 0.0 else {
    throw NSError(domain: "CareerDeepSeekOCR", code: 6, userInfo: [NSLocalizedDescriptionKey: "ocrScaleFactor must be finite and greater than 0"])
  }
  return ocrScaleFactor
}

func resizeCGImage(_ image: CGImage, scaleFactor: Double) throws -> CGImage {
  if scaleFactor == 1.0 {
    return image
  }

  let scaledWidth = Int((Double(image.width) * scaleFactor).rounded())
  let scaledHeight = Int((Double(image.height) * scaleFactor).rounded())
  if scaledWidth <= 0 || scaledHeight <= 0 {
    throw NSError(domain: "CareerDeepSeekOCR", code: 7, userInfo: [NSLocalizedDescriptionKey: "scaled OCR image is empty"])
  }

  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
  guard let context = CGContext(
    data: nil,
    width: scaledWidth,
    height: scaledHeight,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ) else {
    throw NSError(domain: "CareerDeepSeekOCR", code: 8, userInfo: [NSLocalizedDescriptionKey: "could not create scaled OCR image context"])
  }

  context.interpolationQuality = .high
  context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(scaledWidth), height: CGFloat(scaledHeight)))
  guard let scaledImage = context.makeImage() else {
    throw NSError(domain: "CareerDeepSeekOCR", code: 9, userInfo: [NSLocalizedDescriptionKey: "could not create scaled OCR image"])
  }
  return scaledImage
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = try JSONDecoder().decode(InputJSON.self, from: inputData)
let ocrScaleFactor = try validatedOcrScaleFactor(input.ocrScaleFactor)

let imageURL = URL(fileURLWithPath: input.imagePath)
guard
  let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
  throw NSError(domain: "CareerDeepSeekOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "could not load image for OCR"])
}

let originalImageWidth = image.width
let originalImageHeight = image.height
var ocrImage = image
var boundsOffsetX = 0
var boundsOffsetY = 0

if let region = input.region {
  let cropRect = try validatedCropRect(region, imageWidth: originalImageWidth, imageHeight: originalImageHeight)
  guard let croppedImage = image.cropping(to: cropRect) else {
    throw NSError(domain: "CareerDeepSeekOCR", code: 5, userInfo: [NSLocalizedDescriptionKey: "could not crop image for OCR"])
  }
  ocrImage = croppedImage
  boundsOffsetX = Int(cropRect.origin.x)
  boundsOffsetY = Int(cropRect.origin.y)
}

ocrImage = try resizeCGImage(ocrImage, scaleFactor: ocrScaleFactor)

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = (input.languages?.isEmpty == false) ? input.languages! : ["zh-Hans", "zh-Hant", "en-US"]
if #available(macOS 26.0, *) {
  request.automaticallyDetectsLanguage = true
}

let handler = VNImageRequestHandler(cgImage: ocrImage, options: [:])
try handler.perform([request])

let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
let maxObservations = min(max(input.maxObservations ?? 64, 1), 256)
let exact = input.exact ?? false
let caseSensitive = input.caseSensitive ?? false
let normalizedQuery = input.normalizedQuery ?? normalizeForMatch(input.query ?? "", caseSensitive: caseSensitive)
let ocrAnchorFallbackQuery = normalizeOcrAnchorFallbackForMatch(input.query ?? "", caseSensitive: caseSensitive)
var matches: [MatchJSON] = []

for observation in observations.prefix(maxObservations) {
  var selectedText: String?
  var selectedConfidence: Float?

  for candidate in observation.topCandidates(5) {
    let text = sanitize(candidate.string)
    if text.isEmpty {
      continue
    }
    if matchesQuery(text, normalizedQuery: normalizedQuery, ocrAnchorFallbackQuery: ocrAnchorFallbackQuery, exact: exact, caseSensitive: caseSensitive) {
      selectedText = text
      selectedConfidence = candidate.confidence
      break
    }
  }

  guard let text = selectedText, let confidence = selectedConfidence else {
    continue
  }

  let box = observation.boundingBox
  let scale = CGFloat(ocrScaleFactor)
  matches.append(MatchJSON(
    matchIndex: matches.count,
    text: text,
    confidence: Double(confidence),
    bounds: BoundsJSON(
      x: Int(((box.minX * CGFloat(ocrImage.width)) / CGFloat(ocrScaleFactor)).rounded()) + boundsOffsetX,
      y: Int((((1.0 - box.maxY) * CGFloat(ocrImage.height)) / CGFloat(ocrScaleFactor)).rounded()) + boundsOffsetY,
      width: Int(((box.width * CGFloat(ocrImage.width)) / scale).rounded()),
      height: Int(((box.height * CGFloat(ocrImage.height)) / scale).rounded())
    )
  ))
}

let output = OutputJSON(
  recognizedAt: ISO8601DateFormatter().string(from: Date()),
  imagePath: input.imagePath,
  imageWidth: originalImageWidth,
  imageHeight: originalImageHeight,
  matches: matches
)
let data = try JSONEncoder().encode(output)
print(String(data: data, encoding: .utf8)!)
`
}

export async function recognizeTextInImage(
  config: ComputerUseConfig,
  input: RecognizeTextInImageInput,
): Promise<OcrTextSnapshot> {
  const normalizedInput = normalizeRecognizeTextInImageInput(input)

  if (process.platform !== 'darwin') {
    return buildOcrTextSnapshot({
      recognizedAt: new Date().toISOString(),
      imagePath: normalizedInput.imagePath,
      imageWidth: 0,
      imageHeight: 0,
      matches: [],
    }, normalizedInput)
  }

  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: ocrScript(),
    stdinPayload: {
      imagePath: normalizedInput.imagePath,
      maxObservations: normalizedInput.maxObservations,
      languages: normalizedInput.languages,
      query: normalizedInput.query,
      exact: normalizedInput.exact,
      caseSensitive: normalizedInput.caseSensitive,
      normalizedQuery: normalizedInput.normalizedQuery,
      region: normalizedInput.region,
      ocrScaleFactor: normalizedInput.ocrScaleFactor,
    },
  })

  const raw = JSON.parse(stdout.trim()) as RawOcrOutput
  return buildOcrTextSnapshot(raw, normalizedInput)
}
