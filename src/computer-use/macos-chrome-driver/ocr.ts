import process from 'node:process'

import type { ComputerUseConfig } from '../config.js'
import type { Bounds } from '../types.js'
import type { OcrTextSnapshot } from './types.js'

import { runSwiftScript } from '../swift-runner.js'

export interface RecognizeTextInImageInput {
  imagePath: string
  maxObservations?: number
  languages?: string[]
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

function ocrScript(): string {
  return String.raw`
import Foundation
import ImageIO
import Vision

struct InputJSON: Decodable {
  let imagePath: String
  let maxObservations: Int?
  let languages: [String]?
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

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = try JSONDecoder().decode(InputJSON.self, from: inputData)

let imageURL = URL(fileURLWithPath: input.imagePath)
guard
  let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
  throw NSError(domain: "CareerDeepSeekOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "could not load image for OCR"])
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = (input.languages?.isEmpty == false) ? input.languages! : ["zh-Hans", "zh-Hant", "en-US"]
if #available(macOS 26.0, *) {
  request.automaticallyDetectsLanguage = true
}

let handler = VNImageRequestHandler(cgImage: image, options: [:])
try handler.perform([request])

let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
let maxObservations = max(input.maxObservations ?? 256, 1)
var matches: [MatchJSON] = []

for observation in observations.prefix(maxObservations) {
  guard let candidate = observation.topCandidates(1).first else {
    continue
  }
  let text = sanitize(candidate.string)
  if text.isEmpty {
    continue
  }
  let box = observation.boundingBox
  matches.append(MatchJSON(
    matchIndex: matches.count,
    text: text,
    confidence: Double(candidate.confidence),
    bounds: BoundsJSON(
      x: Int((box.minX * CGFloat(image.width)).rounded()),
      y: Int(((1.0 - box.maxY) * CGFloat(image.height)).rounded()),
      width: Int((box.width * CGFloat(image.width)).rounded()),
      height: Int((box.height * CGFloat(image.height)).rounded())
    )
  ))
}

let output = OutputJSON(
  recognizedAt: ISO8601DateFormatter().string(from: Date()),
  imagePath: input.imagePath,
  imageWidth: image.width,
  imageHeight: image.height,
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
  if (process.platform !== 'darwin') {
    return {
      recognizedAt: new Date().toISOString(),
      imagePath: input.imagePath,
      imageWidth: 0,
      imageHeight: 0,
      matches: [],
    }
  }

  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: ocrScript(),
    stdinPayload: {
      imagePath: input.imagePath,
      maxObservations: input.maxObservations ?? 256,
      languages: input.languages ?? ['zh-Hans', 'zh-Hant', 'en-US'],
    },
  })

  const raw = JSON.parse(stdout.trim()) as RawOcrOutput
  return {
    recognizedAt: raw.recognizedAt,
    imagePath: raw.imagePath,
    imageWidth: raw.imageWidth,
    imageHeight: raw.imageHeight,
    matches: raw.matches,
  }
}
