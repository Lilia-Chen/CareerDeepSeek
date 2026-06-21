import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function readSource(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('single dispatch source shape', () => {
  it('does not retain the old programmatic handler registry', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/invoke-handlers.ts')

    expect(source).not.toContain('createMacOSChromeInvokeHandlers')
    expect(source).not.toContain('latestRecognition')
    expect(source).not.toContain('promotedCandidates')
    expect(source).not.toContain('chrome.clickCandidate')
    expect(source).not.toContain('chrome.typeTextAudited')
  })

  it('does not expose driver atomic command adapters', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/driver.ts')

    expect(source).not.toContain('atomicCommands')
    expect(source).not.toContain('#atomicCommands')
  })

  it('resolves atomic command Chrome context without per-poll DOM tab metadata', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/driver.ts')
    const invokeOperationBody = source.slice(
      source.indexOf('async invokeOperation('),
      source.indexOf('async checkSafetyGate()'),
    )

    expect(invokeOperationBody).toContain('includeTabMetadata: false')
  })

  it('does not retain the old driver workflow API or cross-call state', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/driver.ts')

    for (const oldToken of [
      'get lastCapture',
      'recognizeFromCapture',
      'promoteCandidate',
      'async click(',
      'focusTextInput',
      'typeText',
      'pressKey',
      'MacOSChromeScrollOptions',
      '#lastCapture',
      '#lastObservation',
      '#recognitionArtifacts',
      '#promotedCandidateArtifacts',
      '#focusedTextInputLease',
      '#scrollRegionLease',
      '#executeAction',
      '#checkActionPreconditions',
      '#recheckCandidateLiveness',
      '#captureEvidenceRefs',
      '#visibleTextForSafety',
    ]) {
      expect(source).not.toContain(oldToken)
    }
  })

  it('does not leak driver injection through the public invoke entry options', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/invoke-entry.ts')

    expect(source).not.toContain('driver?: MacOSChromeInvokeDriver')
    expect(source).not.toMatch(/options\.driver(?!Options)/)
  })

  it('does not export the old typed programmatic driver surface', () => {
    const driverIndex = readSource('src/computer-use/macos-chrome-driver/index.ts')
    const computerUseIndex = readSource('src/computer-use/index.ts')

    for (const source of [driverIndex, computerUseIndex]) {
      expect(source).not.toMatch(/export\s+\{\s*MacOSChromeDriver[\s,}]/)
      expect(source).not.toContain('MacOSChromeScrollOptions')
      expect(source).not.toContain('ChromeRecognitionTarget')
      expect(source).not.toContain('CandidatePromotion')
      expect(source).not.toContain('PromotedCandidate')
      expect(source).not.toContain('RecognizedItem')
      expect(source).not.toContain('RecognitionResult')
      expect(source).not.toContain('PromotionOptions')
    }
  })

  it('does not retain old recognition or candidate API types', () => {
    const types = readSource('src/computer-use/macos-chrome-driver/types.ts')
    const invokeTypes = readSource('src/computer-use/macos-chrome-driver/invoke-types.ts')
    const qaReport = readSource('src/computer-use/macos-chrome-driver/invoke-qa-report.ts')

    for (const oldToken of [
      'ChromeRecognitionTarget',
      'RecognizedItem',
      'RecognitionResult',
      'CandidatePromotion',
      'PromotionRefusal',
      'CandidateGrounding',
      'PromotedCandidate',
    ]) {
      expect(types).not.toContain(oldToken)
    }
    expect(invokeTypes).not.toContain('candidate_promotion')
    expect(invokeTypes).not.toContain('candidate_provenance')
    expect(qaReport).not.toContain('candidate_promotion')
    expect(qaReport).not.toContain('candidate_provenance')
  })

  it('does not retain removed P2.0.1 command methods in the action path', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/atomic-commands.ts')

    for (const oldToken of [
      'async clickText(',
      'async findRows(',
      'async clickRow(',
      'async focusText(',
      'async axFocusText(',
      'async pressButton(',
      'async axPressButton(',
      'async typeText(',
      'executeAXQueryAction',
    ]) {
      expect(source).not.toContain(oldToken)
    }
    expect(source).toContain('async clickTarget(')
    expect(source).toContain('async typeInput(')
  })

  it('does not use the no-op-prone window-targeted scroll path for scrollRegion', () => {
    const source = readSource('src/computer-use/macos-chrome-driver/atomic-commands.ts')
    const scrollRegionBody = source.slice(
      source.indexOf('async scrollRegion(input:'),
      source.indexOf('async #captureWindow('),
    )

    expect(scrollRegionBody).toContain('executeScroll(')
    expect(scrollRegionBody).not.toContain('executeWindowTargetedScroll')
  })
})
