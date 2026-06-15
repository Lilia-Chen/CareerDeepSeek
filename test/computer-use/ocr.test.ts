import { afterEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

import type { ComputerUseConfig } from '../../src/computer-use/config.js'

import {
  buildOcrTextSnapshot,
  groupOcrTextRows,
  normalizeRecognizeTextInImageInput,
  produceOcrRows,
  recognizeTextInImage,
} from '../../src/computer-use/macos-chrome-driver/ocr.js'

const mocks = vi.hoisted(() => ({
  runSwiftScript: vi.fn(),
}))

vi.mock('../../src/computer-use/swift-runner.js', () => ({
  runSwiftScript: mocks.runSwiftScript,
}))

const raw = {
  recognizedAt: '2026-06-15T10:00:00.000Z',
  imagePath: '/tmp/capture.png',
  imageWidth: 1000,
  imageHeight: 800,
  matches: [
    { matchIndex: 0, text: 'Apply Now', confidence: 0.92, bounds: { x: 100, y: 100, width: 200, height: 40 } },
    { matchIndex: 1, text: 'apply later', confidence: 0.72, bounds: { x: 700, y: 100, width: 180, height: 40 } },
    { matchIndex: 2, text: 'Jobs', confidence: 0.35, bounds: { x: 120, y: 500, width: 120, height: 40 } },
  ],
}

const config: ComputerUseConfig = {
  sessionRoot: '.computer-use',
  screenshotsDir: '.computer-use/screenshots',
  timeoutMs: 15_000,
  binaries: {
    swift: 'swift',
    osascript: 'osascript',
    screencapture: 'screencapture',
    open: 'open',
  },
  denyApps: [],
  openableApps: ['Google Chrome'],
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function mockPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value,
  })
}

describe('ocr raw text runtime helpers', () => {
  afterEach(() => {
    vi.clearAllMocks()
    if (originalPlatform)
      Object.defineProperty(process, 'platform', originalPlatform)
  })

  it('clamps maxObservations to the AUV-compatible 1..256 range', () => {
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png' }).maxObservations, 64)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: Number.NaN }).maxObservations, 64)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: Number.POSITIVE_INFINITY }).maxObservations, 64)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: Number.NEGATIVE_INFINITY }).maxObservations, 64)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: -12 }).maxObservations, 1)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: 0 }).maxObservations, 1)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: 999 }).maxObservations, 256)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', maxObservations: 8 }).maxObservations, 8)
  })

  it('validates minConfidence before provider execution', () => {
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', minConfidence: -0.01 }),
      /minConfidence must be between 0 and 1/,
    )
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', minConfidence: 1.01 }),
      /minConfidence must be between 0 and 1/,
    )
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', minConfidence: 0 }).minConfidence, 0)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', minConfidence: 1 }).minConfidence, 1)
  })

  it('validates ocrScaleFactor before provider execution', () => {
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png' }).ocrScaleFactor, 1)
    assert.equal(normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', ocrScaleFactor: 2 }).ocrScaleFactor, 2)
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', ocrScaleFactor: 0 }),
      /ocrScaleFactor must be finite and greater than 0/,
    )
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', ocrScaleFactor: Number.NaN }),
      /ocrScaleFactor must be finite and greater than 0/,
    )
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', ocrScaleFactor: Number.POSITIVE_INFINITY }),
      /ocrScaleFactor must be finite and greater than 0/,
    )
  })

  it('rejects invalid OCR region ratios before provider execution', () => {
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', region: { left: -0.01, top: 0, right: 1, bottom: 1 } }),
      /region ratios must be finite values between 0 and 1/,
    )
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', region: { left: 0, top: 0, right: Number.NaN, bottom: 1 } }),
      /region ratios must be finite values between 0 and 1/,
    )
    assert.throws(
      () => normalizeRecognizeTextInImageInput({ imagePath: '/tmp/a.png', region: { left: 0.5, top: 0, right: 0.5, bottom: 1 } }),
      /region must have left < right and top < bottom/,
    )
  })

  it('filters by minConfidence and records raw and filtered counts', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      minConfidence: 0.8,
    })

    const snapshot = buildOcrTextSnapshot(raw, normalized)

    assert.equal(snapshot.rawMatchCount, 3)
    assert.equal(snapshot.filteredMatchCount, 1)
    assert.deepEqual(snapshot.matches.map(match => match.text), ['Apply Now'])
    assert.equal(snapshot.minConfidence, 0.8)
  })

  it('uses contains and case-insensitive query matching by default', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'APPLY',
    })

    const snapshot = buildOcrTextSnapshot(raw, normalized)

    assert.equal(snapshot.exact, false)
    assert.equal(snapshot.caseSensitive, false)
    assert.equal(snapshot.normalizedQuery, 'apply')
    assert.deepEqual(snapshot.matches.map(match => match.text), ['Apply Now', 'apply later'])
  })

  it('supports exact and case-sensitive query matching', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'Apply Now',
      exact: true,
      caseSensitive: true,
    })

    const snapshot = buildOcrTextSnapshot(raw, normalized)

    assert.equal(snapshot.exact, true)
    assert.equal(snapshot.caseSensitive, true)
    assert.deepEqual(snapshot.matches.map(match => match.text), ['Apply Now'])
  })

  it('does not match case-sensitive queries with different casing', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'apply now',
      exact: true,
      caseSensitive: true,
    })

    const snapshot = buildOcrTextSnapshot(raw, normalized)

    assert.deepEqual(snapshot.matches.map(match => match.text), [])
  })

  it('uses anchor-normalized query matching for common OCR text confusions', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'ai engineer',
      exact: true,
    })

    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'A| Engineer', confidence: 0.92, bounds: { x: 10, y: 10, width: 100, height: 20 } },
      ],
    }, normalized)

    assert.deepEqual(snapshot.matches.map(match => match.text), ['A| Engineer'])
    assert.equal(snapshot.normalizedQuery, 'ai engineer')
  })

  it('anchor-normalizes OCR text like AUV by folding OCR confusions and removing non-alphanumerics', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'AI Engineer',
      exact: true,
    })

    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'AI Engineer', confidence: 0.92, bounds: { x: 10, y: 10, width: 100, height: 20 } },
        { matchIndex: 1, text: 'AI-Engineer', confidence: 0.92, bounds: { x: 10, y: 40, width: 100, height: 20 } },
        { matchIndex: 2, text: 'AIEngineer', confidence: 0.92, bounds: { x: 10, y: 70, width: 100, height: 20 } },
        { matchIndex: 3, text: 'A| Eng!neer', confidence: 0.92, bounds: { x: 10, y: 100, width: 100, height: 20 } },
      ],
    }, normalized)

    assert.deepEqual(snapshot.matches.map(match => match.text), [
      'AI Engineer',
      'AI-Engineer',
      'AIEngineer',
      'A| Eng!neer',
    ])
  })

  it('applies maxObservations before defensive TS query filtering', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: 'second',
      maxObservations: 1,
    })

    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'First candidate', confidence: 0.92, bounds: { x: 10, y: 10, width: 100, height: 20 } },
        { matchIndex: 1, text: 'Second candidate', confidence: 0.92, bounds: { x: 10, y: 40, width: 100, height: 20 } },
      ],
    }, normalized)

    assert.equal(snapshot.rawMatchCount, 1)
    assert.deepEqual(snapshot.matches.map(match => match.text), [])
  })

  it('filters by OCR box center inside a complete region ratio and records crop metadata', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      query: '',
      region: { left: 0, top: 0, right: 0.5, bottom: 0.5 },
    })

    const snapshot = buildOcrTextSnapshot(raw, normalized)

    assert.equal(snapshot.rawMatchCount, 3)
    assert.equal(snapshot.filteredMatchCount, 1)
    assert.deepEqual(snapshot.matches.map(match => match.matchIndex), [0])
    assert.deepEqual(snapshot.region, { left: 0, top: 0, right: 0.5, bottom: 0.5 })
    assert.deepEqual(snapshot.cropRect, { x: 0, y: 0, width: 500, height: 400 })
  })

  it('treats OCR region right and bottom edges as half-open', () => {
    const normalized = normalizeRecognizeTextInImageInput({
      imagePath: raw.imagePath,
      region: { left: 0, top: 0, right: 0.5, bottom: 0.5 },
    })

    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'Inside', confidence: 0.92, bounds: { x: 489, y: 389, width: 20, height: 20 } },
        { matchIndex: 1, text: 'Right edge', confidence: 0.92, bounds: { x: 490, y: 200, width: 20, height: 20 } },
        { matchIndex: 2, text: 'Bottom edge', confidence: 0.92, bounds: { x: 200, y: 390, width: 20, height: 20 } },
      ],
    }, normalized)

    assert.deepEqual(snapshot.matches.map(match => match.text), ['Inside'])
  })

  it('passes provider-side query, matching, and crop options into the Swift OCR runtime', async () => {
    mockPlatform('darwin')
    mocks.runSwiftScript.mockResolvedValue({
      stdout: JSON.stringify({
        ...raw,
        matches: [
          { matchIndex: 0, text: 'A| Engineer', confidence: 0.92, bounds: { x: 100, y: 100, width: 200, height: 40 } },
        ],
      }),
      stderr: '',
    })

    await recognizeTextInImage(config, {
      imagePath: raw.imagePath,
      maxObservations: 3,
      languages: ['en-US'],
      query: 'ai engineer',
      exact: true,
      caseSensitive: true,
      region: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
      ocrScaleFactor: 2,
    })

    assert.equal(mocks.runSwiftScript.mock.calls.length, 1)
    const options = mocks.runSwiftScript.mock.calls[0]![0]
    assert.deepEqual(options.stdinPayload, {
      imagePath: raw.imagePath,
      maxObservations: 3,
      languages: ['en-US'],
      query: 'ai engineer',
      exact: true,
      caseSensitive: true,
      normalizedQuery: 'ai engineer',
      region: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
      ocrScaleFactor: 2,
    })
    assert.match(options.source, /topCandidates\(5\)/)
    assert.match(options.source, /matchesQuery/)
    assert.match(options.source, /cropping\(to:/)
    assert.match(options.source, /boundsOffsetX/)
    assert.match(options.source, /boundsOffsetY/)
    assert.doesNotMatch(options.source, /output\.append\(" "\)/)
    assert.match(options.source, /ocrScaleFactor\.isFinite && ocrScaleFactor > 0\.0/)
    assert.match(options.source, /resizeCGImage\(ocrImage, scaleFactor: ocrScaleFactor\)/)
    assert.match(options.source, /\/ CGFloat\(ocrScaleFactor\)\)\.rounded\(\)\) \+ boundsOffsetX/)
    assert.match(options.source, /\/ CGFloat\(ocrScaleFactor\)\)\.rounded\(\)\) \+ boundsOffsetY/)
  })
})

describe('ocr row producer runtime helpers', () => {
  it('groups OCR text into capture-local rows using centerY threshold and y/x sort order', () => {
    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 3, text: 'Second row left', confidence: 0.8, bounds: { x: 20, y: 230, width: 140, height: 20 } },
        { matchIndex: 1, text: 'First row right', confidence: 0.9, bounds: { x: 180, y: 101, width: 120, height: 20 } },
        { matchIndex: 0, text: 'First row left', confidence: 0.91, bounds: { x: 20, y: 100, width: 130, height: 20 } },
        { matchIndex: 2, text: 'First row low', confidence: 0.86, bounds: { x: 330, y: 131, width: 120, height: 20 } },
      ],
    }, normalizeRecognizeTextInImageInput({ imagePath: raw.imagePath }))

    const rows = groupOcrTextRows(snapshot)

    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0]!.textFragments.map(fragment => fragment.text), [
      'First row left',
      'First row right',
      'First row low',
    ])
    assert.deepEqual(rows[0]!.bounds, { x: 20, y: 100, width: 430, height: 51 })
    assert.equal(rows[0]!.rowIndex, 0)
    assert.equal(rows[0]!.source, 'ocr_row')
    assert.equal(rows[0]!.detail?.originalSource, 'ocr-text')
    assert.equal(rows[1]!.rowIndex, 1)
    assert.deepEqual(rows[1]!.textFragments.map(fragment => fragment.text), ['Second row left'])
  })

  it('dedupes identical OCR text fragments within a grouped row', () => {
    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'Remote', confidence: 0.91, bounds: { x: 20, y: 100, width: 80, height: 20 } },
        { matchIndex: 1, text: 'Remote', confidence: 0.89, bounds: { x: 20, y: 100, width: 80, height: 20 } },
        { matchIndex: 2, text: 'AI Engineer', confidence: 0.92, bounds: { x: 130, y: 101, width: 160, height: 20 } },
      ],
    }, normalizeRecognizeTextInImageInput({ imagePath: raw.imagePath }))

    const rows = groupOcrTextRows(snapshot)

    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0]!.textFragments.map(fragment => fragment.text), ['Remote', 'AI Engineer'])
  })

  it('does not merge separate rows through transitive row-bound expansion', () => {
    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'Top row left', confidence: 0.91, bounds: { x: 20, y: 100, width: 120, height: 20 } },
        { matchIndex: 1, text: 'Top row right', confidence: 0.89, bounds: { x: 180, y: 130, width: 130, height: 20 } },
        { matchIndex: 2, text: 'Bottom row left', confidence: 0.9, bounds: { x: 20, y: 160, width: 150, height: 20 } },
        { matchIndex: 3, text: 'Bottom row right', confidence: 0.88, bounds: { x: 190, y: 190, width: 150, height: 20 } },
      ],
    }, normalizeRecognizeTextInImageInput({ imagePath: raw.imagePath }))

    const rows = groupOcrTextRows(snapshot)

    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0]!.textFragments.map(fragment => fragment.text), ['Top row left', 'Top row right'])
    assert.deepEqual(rows[1]!.textFragments.map(fragment => fragment.text), ['Bottom row left', 'Bottom row right'])
  })

  it('does not expose TS PNG decoding or image-pixel visual row segmentation APIs', async () => {
    const ocrModule = await import('../../src/computer-use/macos-chrome-driver/ocr.js')

    assert.equal('readVisualRowImageFromPngFile' in ocrModule, false)
    assert.equal('decodePngToVisualRowImage' in ocrModule, false)
    assert.equal('detectVisualRows' in ocrModule, false)
  })

  it('uses ocr-text strategy and OCR rows from raw OCR text evidence', async () => {
    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'Company', confidence: 0.91, bounds: { x: 20, y: 100, width: 100, height: 20 } },
        { matchIndex: 1, text: 'AI Engineer', confidence: 0.92, bounds: { x: 140, y: 102, width: 160, height: 20 } },
      ],
    }, normalizeRecognizeTextInImageInput({ imagePath: raw.imagePath }))

    const result = await produceOcrRows({ textSnapshot: snapshot })

    assert.equal(result.strategy, 'ocr-text')
    assert.equal(result.rawMatchCount, 2)
    assert.equal(result.filteredMatchCount, 2)
    assert.equal(result.rowCount, 1)
    assert.equal(result.rows[0]!.source, 'ocr_row')
    assert.deepEqual(result.rows[0]!.textFragments.map(fragment => fragment.text), ['Company', 'AI Engineer'])
    assert.equal(result.providerDetail.originalStrategy, 'ocr-text')
    assert.equal('visualRowCount' in result.providerDetail, false)
  })

  it('keeps rowIndex capture-local without stable list or cross-scroll identity claims', async () => {
    const snapshot = buildOcrTextSnapshot({
      ...raw,
      matches: [
        { matchIndex: 0, text: 'Only row', confidence: 0.91, bounds: { x: 20, y: 100, width: 100, height: 20 } },
      ],
    }, normalizeRecognizeTextInImageInput({ imagePath: raw.imagePath }))

    const result = await produceOcrRows({ textSnapshot: snapshot })
    const row = result.rows[0]!

    assert.equal(row.rowIndex, 0)
    assert.ok(row.knownLimits?.some(limit => limit.includes('capture-local')))
    assert.equal('stableId' in row, false)
    assert.equal('stable_id' in row, false)
    assert.equal('listId' in row, false)
    assert.equal('list_id' in row, false)
    assert.equal('crossScrollId' in row, false)
    assert.equal('cross_scroll_id' in row, false)
  })
})
