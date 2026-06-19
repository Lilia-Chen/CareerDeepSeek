import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type {
  ArtifactRef,
  CandidatePromotion,
  ChromeWindowCapture,
  ObservationSnapshot,
  PromotedCandidate,
  RecognitionResult,
  SafetyCheckResult,
} from '../../src/computer-use/macos-chrome-driver/types.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import { createMacOSChromeInvokeHandlers } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'
import type { MacOSChromeInvokeDriver } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'

describe('prepare and action Chrome invoke commands', () => {
  it('promotes the latest recognition and returns same-session candidate provenance refs', async () => {
    const capture = fakeCapture()
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    const driver = fakeDriver({
      lastCapture: capture,
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: ['promotion residual'] },
    })
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
      { handlers },
    )
    const result = await invoke(
      { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
      { handlers },
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.commandId, 'chrome.promote')
    assert.deepEqual(driver.promoteCalls, [{ recognition, capture, targetKind: 'visible_text' }])
    assert.deepEqual(result.output, {
      candidateLocalId: candidate.candidate_local_id,
      candidateRef: promotedCandidateRef(candidate),
      kind: candidate.kind,
      label: candidate.label,
    })
    assert.ok(result.signals.includes('candidate_promoted'))
    assert.ok(result.artifacts.some(ref => sameArtifactRef(ref, promotedCandidateRef(candidate))))
    assert.ok(result.artifacts.some(ref => sameArtifactRef(ref, candidate.evidence.capture_artifact)))
    assert.ok(result.artifacts.some(ref => sameArtifactRef(ref, candidate.evidence.recognition_artifact)))
    assert.ok(result.knownLimits.includes('same_session_candidate_only'))
  })

  it('passes the latest recognition target kind into driver promotion', async () => {
    const capture = fakeCapture()
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition, kind: 'ax_textfield', label: 'Search' })
    candidate.target_spec.grounding = 'ax_node'
    const driver = fakeDriver({
      lastCapture: capture,
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'text_input', name: 'Search' } } },
      { handlers },
    )
    await invoke(
      { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
      { handlers },
    )

    assert.deepEqual(driver.promoteCalls, [{ recognition, capture, targetKind: 'text_input' }])
  })

  it('refuses chrome.promote when no successful recognition exists in the handler sequence', async () => {
    const driver = fakeDriver({ lastCapture: fakeCapture() })

    const result = await invoke(
      { commandId: 'chrome.promote' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'candidate_promotion')
    assert.equal(result.failure?.code, 'recognition_not_in_sequence')
    assert.equal(driver.promoteCalls.length, 0)
  })

  it('refuses chrome.promote when the latest capture is missing', async () => {
    const recognition = fakeRecognitionResult()
    const driver = fakeDriver({
      lastCapture: fakeCapture(),
      recognizeResult: recognition,
    })
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
      { handlers },
    )
    driver.lastCaptureValue = undefined
    const result = await invoke(
      { commandId: 'chrome.promote' },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'candidate_promotion')
    assert.equal(result.failure?.code, 'last_capture_missing')
    assert.equal(driver.promoteCalls.length, 0)
  })

  it('returns candidate_promotion refusal when driver promotion refuses the candidate', async () => {
    const recognition = fakeRecognitionResult()
    const driver = fakeDriver({
      lastCapture: fakeCapture(),
      recognizeResult: recognition,
      promoteResult: {
        status: 'refused',
        reasons: ['hard_stop_signal'],
        residual_known_limits: ['hard-stop exposed'],
      },
    })
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'button', text: 'Apply' } } },
      { handlers },
    )
    const result = await invoke(
      { commandId: 'chrome.promote' },
      { handlers },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'candidate_promotion')
    assert.equal(result.failure?.code, 'hard_stop_signal')
    assert.ok(result.signals.includes('candidate_promotion_refused'))
    assert.ok(result.signals.includes('hard_stop_signal'))
  })

  it('refuses clickCandidate for ax_node text input candidates', async () => {
    const { driver, handlers, candidate } = await promotedTextInputSequence()

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'candidate_provenance')
    assert.equal(result.failure?.code, 'unsupported_click_candidate_grounding')
    assert.deepEqual(driver.clickCalls, [])
    assert.deepEqual(driver.focusTextInputCalls, [])
  })

  it('focuses a same-session ax_node text input candidate before keyboard input', async () => {
    const { driver, handlers, candidate } = await promotedTextInputSequence()

    const focusResult = await invoke(
      { commandId: 'chrome.focusTextInput', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const pressResult = await invoke(
      { commandId: 'chrome.pressKey', inputs: { key: 'enter', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(focusResult.status, 'completed')
    assert.deepEqual(driver.focusTextInputCalls, [candidate])
    assert.deepEqual(driver.clickCalls, [])
    assert.ok(focusResult.signals.includes('focused_target_recorded'))
    assert.ok(focusResult.artifacts.some(ref => sameArtifactRef(ref, promotedCandidateRef(candidate))))
    assert.equal(typeResult.status, 'completed')
    assert.equal(pressResult.status, 'completed')
    assert.deepEqual(driver.typeTextCalls, ['AI engineer'])
    assert.deepEqual(driver.pressKeyCalls, [{ key: 'enter', modifiers: [] }])
  })

  it('invalidates focused target after observe and does not tell callers to observe before keyboard input', async () => {
    const { driver, handlers, candidate } = await promotedTextInputSequence()

    const focusResult = await invoke(
      { commandId: 'chrome.focusTextInput', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(focusResult.status, 'completed')
    assert.equal(focusResult.knownLimits.includes('caller_must_invoke_chrome_observe_after_action'), false)
    assert.ok(focusResult.knownLimits.includes('caller_must_invoke_chrome_observe_after_keyboard_action'))
    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.deepEqual(driver.typeTextCalls, [])
  })

  it('does not record keyboard focus provenance after clicking a non-text-input candidate', async () => {
    const { driver, handlers, candidate } = await promotedSequence()

    const clickResult = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const pressResult = await invoke(
      { commandId: 'chrome.pressKey', inputs: { key: 'enter', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(clickResult.status, 'completed')
    assert.equal(clickResult.signals.includes('focused_target_recorded'), false)
    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_text_input')
    assert.equal(pressResult.status, 'refused')
    assert.equal(pressResult.failure?.class, 'candidate_provenance')
    assert.equal(pressResult.failure?.code, 'focused_candidate_not_text_input')
    assert.deepEqual(driver.typeTextCalls, [])
    assert.deepEqual(driver.pressKeyCalls, [])
  })

  it('does not record keyboard focus provenance for text_input recognition unless the candidate is ax_node grounded', async () => {
    const { driver, handlers, candidate } = await promotedTextInputRecognitionWithOcrCandidateSequence()

    const clickResult = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(clickResult.status, 'completed')
    assert.equal(clickResult.signals.includes('focused_target_recorded'), false)
    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_text_input')
    assert.deepEqual(driver.typeTextCalls, [])
  })

  it('refuses clickCandidate when candidateRef does not match the registered promoted candidate', async () => {
    const { driver, handlers, candidate } = await promotedSequence()

    const result = await invoke(
      {
        commandId: 'chrome.clickCandidate',
        inputs: {
          candidateLocalId: candidate.candidate_local_id,
          candidateRef: { ...promotedCandidateRef(candidate), artifact_id: 'promoted_other' },
        },
      },
      { handlers },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'candidate_provenance')
    assert.equal(result.failure?.code, 'candidate_ref_mismatch')
    assert.equal(driver.clickCalls.length, 0)
  })

  it('refuses clickCandidate when the candidateLocalId is not registered in the handler sequence', async () => {
    const driver = fakeDriver()

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: 'unknown_candidate' } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'candidate_provenance')
    assert.equal(result.failure?.code, 'candidate_not_in_sequence')
    assert.equal(driver.clickCalls.length, 0)
  })

  it('rejects raw candidate JSON as clickCandidate input', async () => {
    const candidate = fakeCandidate()
    const driver = fakeDriver()

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidate } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'invalid_input')
    assert.equal(result.failure?.code, 'raw_candidate_not_accepted')
    assert.equal(driver.clickCalls.length, 0)
  })

  it('maps clickCandidate driver provenance refusal to candidate_provenance', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    driver.clickError = codedError('missing_promoted_candidate_artifact', 'Click candidate was not promoted by this driver session.')

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'candidate_provenance')
    assert.equal(result.failure?.code, 'missing_promoted_candidate_artifact')
  })

  it('maps clickCandidate driver artifact mismatch refusal to candidate_provenance', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    driver.clickError = codedError('promoted_candidate_artifact_mismatch', 'Click candidate does not match the promoted-candidate artifact.')

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'candidate_provenance')
    assert.equal(result.failure?.code, 'promoted_candidate_artifact_mismatch')
  })

  it('maps clickCandidate hard-stop driver refusal to hard_stop', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    driver.clickError = codedError('hard_stop_signal', 'Safety gate refused click: hard_stop_signal.')

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'hard_stop')
    assert.equal(result.failure?.code, 'hard_stop_signal')
  })

  it('refuses typeText and pressKey without the latest audited focused target', async () => {
    const driver = fakeDriver()
    const handlers = createMacOSChromeInvokeHandlers(driver)

    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'hello', focusedCandidateLocalId: 'candidate_1' } },
      { handlers },
    )
    const pressResult = await invoke(
      { commandId: 'chrome.pressKey', inputs: { key: 'enter', focusedCandidateLocalId: 'candidate_1' } },
      { handlers },
    )

    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.equal(pressResult.status, 'refused')
    assert.equal(pressResult.failure?.class, 'candidate_provenance')
    assert.equal(pressResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.equal(driver.typeTextCalls.length, 0)
    assert.equal(driver.pressKeyCalls.length, 0)
  })

  it('types text and presses keys only after a successful focusTextInput record', async () => {
    const { driver, handlers, candidate } = await promotedTextInputSequence()
    await invoke(
      { commandId: 'chrome.focusTextInput', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const beforeObserveCalls = driver.observeCalls

    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const pressResult = await invoke(
      { commandId: 'chrome.pressKey', inputs: { key: 'enter', modifiers: ['command'], focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(typeResult.status, 'completed')
    assert.equal(pressResult.status, 'completed')
    assert.deepEqual(driver.typeTextCalls, ['AI engineer'])
    assert.deepEqual(driver.pressKeyCalls, [{ key: 'enter', modifiers: ['command'] }])
    assert.equal(driver.observeCalls, beforeObserveCalls)
  })

  it('refuses scroll before an observe-derived scroll region exists', async () => {
    const driver = fakeDriver()

    const result = await invoke(
      { commandId: 'chrome.scroll', inputs: { deltaY: 400 } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'safety_gate')
    assert.equal(result.failure?.code, 'scroll_region_not_observed')
    assert.equal(driver.scrollCalls.length, 0)
  })

  it('scrolls the latest observed viewport region without a promoted candidate', async () => {
    const driver = fakeDriver()
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )

    const result = await invoke(
      {
        commandId: 'chrome.scroll',
        inputs: {
          deltaY: 320,
          deltaX: 16,
          settleMs: 40,
        },
      },
      { handlers },
    )

    assert.equal(result.status, 'completed')
    assert.deepEqual(driver.scrollCalls, [{
      deltaY: 320,
      deltaX: 16,
      options: {
        settleMs: 40,
      },
    }])
    assert.ok(result.signals.includes('scroll_delivered'))
    assert.equal('candidateLocalId' in (result.output as Record<string, unknown>), false)
  })

  it('refuses legacy candidateLocalId input for scroll even after observe', async () => {
    const { driver, handlers, candidate } = await promotedSequence()

    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const result = await invoke(
      { commandId: 'chrome.scroll', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'refused')
    assert.equal(result.failure?.class, 'invalid_input')
    assert.equal(result.failure?.code, 'scroll_target_input_not_accepted')
    assert.equal(driver.scrollCalls.length, 0)
  })

  it('invalidates promoted candidates after a new observe boundary without requiring one for scroll', async () => {
    const { driver, handlers, candidate } = await promotedSequence()

    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const clickResult = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const scrollResult = await invoke(
      { commandId: 'chrome.scroll' },
      { handlers },
    )

    assert.equal(clickResult.status, 'refused')
    assert.equal(clickResult.failure?.class, 'candidate_provenance')
    assert.equal(clickResult.failure?.code, 'candidate_not_in_sequence')
    assert.equal(scrollResult.status, 'completed')
    assert.equal(driver.clickCalls.length, 0)
    assert.equal(driver.scrollCalls.length, 1)
  })

  it('invalidates latest recognition after a new observe boundary before promote', async () => {
    const recognition = fakeRecognitionResult()
    const driver = fakeDriver({
      lastCapture: fakeCapture(),
      recognizeResult: recognition,
    })
    const handlers = createMacOSChromeInvokeHandlers(driver)

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
      { handlers },
    )
    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const result = await invoke(
      { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'candidate_promotion')
    assert.equal(result.failure?.code, 'recognition_not_in_sequence')
    assert.equal(driver.promoteCalls.length, 0)
  })

  it('invalidates promoted candidates and focused target after a new recognize boundary', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
      { handlers },
    )
    const clickResult = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(clickResult.status, 'refused')
    assert.equal(clickResult.failure?.class, 'candidate_provenance')
    assert.equal(clickResult.failure?.code, 'candidate_not_in_sequence')
    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.deepEqual(driver.typeTextCalls, [])
  })

  it('invalidates focused target after caller post-action observe', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const typeResult = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )
    const pressResult = await invoke(
      { commandId: 'chrome.pressKey', inputs: { key: 'enter', focusedCandidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(typeResult.status, 'refused')
    assert.equal(typeResult.failure?.class, 'candidate_provenance')
    assert.equal(typeResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.equal(pressResult.status, 'refused')
    assert.equal(pressResult.failure?.class, 'candidate_provenance')
    assert.equal(pressResult.failure?.code, 'focused_candidate_not_in_sequence')
    assert.deepEqual(driver.typeTextCalls, [])
    assert.deepEqual(driver.pressKeyCalls, [])
  })

  it('maps action driver delivery failures to action_delivery/action_execution_error', async () => {
    const driver = fakeDriver()
    const handlers = createMacOSChromeInvokeHandlers(driver)
    driver.scrollError = new Error('CGEvent delivery failed')

    await invoke(
      { commandId: 'chrome.observe' },
      { handlers },
    )
    const result = await invoke(
      { commandId: 'chrome.scroll' },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'action_delivery')
    assert.equal(result.failure?.code, 'action_execution_error')
    assert.match(result.failure?.message ?? '', /CGEvent delivery failed/)
  })

  it('preserves driver liveness ActionRefusalError codes instead of generic delivery failures', async () => {
    const { driver, handlers, candidate } = await promotedSequence()
    driver.clickError = actionRefusalError('anchor_recheck_moved', 'Refusing click: anchor_recheck_moved beyond max_pixel_distance.')

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', inputs: { candidateLocalId: candidate.candidate_local_id } },
      { handlers },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'safety_gate')
    assert.equal(result.failure?.code, 'anchor_recheck_moved')
  })

  it('keeps dry-run action requests runtime-short-circuited before handler dispatch', async () => {
    const driver = fakeDriver()

    const result = await invoke(
      { commandId: 'chrome.clickCandidate', dryRun: true, inputs: { candidateLocalId: 'candidate_1' } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.commandId, 'chrome.clickCandidate')
    assert.ok(result.signals.includes('dry_run'))
    assert.equal(driver.clickCalls.length, 0)
  })
})

async function promotedSequence(): Promise<{
  driver: FakeInvokeDriver
  handlers: ReturnType<typeof createMacOSChromeInvokeHandlers>
  candidate: PromotedCandidate
}> {
  const recognition = fakeRecognitionResult()
  const candidate = fakeCandidate({ recognition })
  const driver = fakeDriver({
    lastCapture: fakeCapture(),
    recognizeResult: recognition,
    promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
  })
  const handlers = createMacOSChromeInvokeHandlers(driver)

  await invoke(
    { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
    { handlers },
  )
  await invoke(
    { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
    { handlers },
  )

  return { driver, handlers, candidate }
}

async function promotedTextInputSequence(): Promise<{
  driver: FakeInvokeDriver
  handlers: ReturnType<typeof createMacOSChromeInvokeHandlers>
  candidate: PromotedCandidate
}> {
  const recognition = fakeRecognitionResult()
  const candidate = fakeCandidate({ recognition, kind: 'ax_textfield', label: 'Search' })
  candidate.target_spec.grounding = 'ax_node'
  candidate.target_spec.anchor_text = 'Search'
  candidate.liveness.preconditions.anchor_recheck!.text = 'Search'
  const driver = fakeDriver({
    lastCapture: fakeCapture(),
    recognizeResult: recognition,
    promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
  })
  const handlers = createMacOSChromeInvokeHandlers(driver)

  await invoke(
    { commandId: 'chrome.recognize', inputs: { target: { kind: 'text_input', name: 'Search' } } },
    { handlers },
  )
  await invoke(
    { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
    { handlers },
  )

  return { driver, handlers, candidate }
}

async function promotedTextInputRecognitionWithOcrCandidateSequence(): Promise<{
  driver: FakeInvokeDriver
  handlers: ReturnType<typeof createMacOSChromeInvokeHandlers>
  candidate: PromotedCandidate
}> {
  const recognition = fakeRecognitionResult()
  const candidate = fakeCandidate({ recognition })
  const driver = fakeDriver({
    lastCapture: fakeCapture(),
    recognizeResult: recognition,
    promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
  })
  const handlers = createMacOSChromeInvokeHandlers(driver)

  await invoke(
    { commandId: 'chrome.recognize', inputs: { target: { kind: 'text_input', name: 'Search' } } },
    { handlers },
  )
  await invoke(
    { commandId: 'chrome.promote', inputs: { recognitionId: recognition.recognition_id } },
    { handlers },
  )

  return { driver, handlers, candidate }
}

interface FakeInvokeDriver extends MacOSChromeInvokeDriver {
  lastCaptureValue?: ChromeWindowCapture
  observeCalls: number
  promoteCalls: Array<{ recognition: RecognitionResult, capture: ChromeWindowCapture, targetKind: string | undefined }>
  clickCalls: PromotedCandidate[]
  focusTextInputCalls: PromotedCandidate[]
  typeTextCalls: string[]
  pressKeyCalls: Array<{ key: string, modifiers: string[] }>
  scrollCalls: Array<{
    deltaY: number
    deltaX: number
    options: { settleMs?: number }
  }>
  clickError?: Error
  typeTextError?: Error
  pressKeyError?: Error
  scrollError?: Error
}

function fakeDriver(options: {
  lastCapture?: ChromeWindowCapture
  recognizeResult?: RecognitionResult
  promoteResult?: CandidatePromotion
} = {}): FakeInvokeDriver {
  const driver: FakeInvokeDriver = {
    lastCaptureValue: options.lastCapture,
    observeCalls: 0,
    promoteCalls: [],
    clickCalls: [],
    focusTextInputCalls: [],
    typeTextCalls: [],
    pressKeyCalls: [],
    scrollCalls: [],
    get lastCapture() {
      return driver.lastCaptureValue
    },
    observe: async () => {
      driver.observeCalls += 1
      return fakeObservationSnapshot()
    },
    recognizeFromCapture: async () => options.recognizeResult ?? fakeRecognitionResult(),
    checkSafetyGate: async () => fakeSafetyCheckResult(),
    promoteCandidate: async (recognition, capture, targetKind) => {
      driver.promoteCalls.push({ recognition, capture, targetKind })
      return options.promoteResult ?? {
        status: 'promoted',
        candidate: fakeCandidate({ recognition }),
        residual_known_limits: [],
      }
    },
    click: async (candidate) => {
      if (driver.clickError)
        throw driver.clickError
      driver.clickCalls.push(candidate)
    },
    focusTextInput: async (candidate) => {
      driver.focusTextInputCalls.push(candidate)
    },
    typeText: async (text) => {
      if (driver.typeTextError)
        throw driver.typeTextError
      driver.typeTextCalls.push(text)
    },
    pressKey: async (key, modifiers = []) => {
      if (driver.pressKeyError)
        throw driver.pressKeyError
      driver.pressKeyCalls.push({ key, modifiers })
    },
    scroll: async (deltaY = 600, deltaX = 0, options = {}) => {
      if (driver.scrollError)
        throw driver.scrollError
      driver.scrollCalls.push({ deltaY, deltaX, options })
    },
  }
  return driver
}

function fakeObservationSnapshot(): ObservationSnapshot {
  return {
    api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
    snapshot_id: 'mco_1',
    run_id: 'run_1',
    span_id: 'observe_mco_1',
    captured_at_millis: 1,
    source: 'merged',
    scope: {
      surface: 'window',
      window_number: 42,
      app_bundle_id: 'com.google.Chrome',
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    },
    evidence: [
      { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    ],
    nodes: [],
    detail: { signals: [] },
    known_limits: [],
  }
}

function fakeCapture(): ChromeWindowCapture {
  return {
    snapshotId: 'mco_1',
    screenshot: {
      dataBase64: '',
      mimeType: 'image/png',
      path: '/tmp/fake.png',
      width: 1200,
      height: 800,
      capturedAt: '2026-06-18T00:00:00.000Z',
    },
    contract: {
      coordinateContractVersion: 1,
      captureSource: {
        kind: 'window',
        windowNumber: 42,
        ownerPid: 100,
        ownerBundleId: 'com.google.Chrome',
      },
      sourceGlobalLogicalBounds: { x: 0, y: 0, width: 1200, height: 800 },
      screenshotPixelSize: { width: 1200, height: 800 },
      pixelToLogicalScale: { x: 1, y: 1 },
      logicalToPixelScale: { x: 1, y: 1 },
      capturedAt: '2026-06-18T00:00:00.000Z',
    },
  }
}

function fakeRecognitionResult(): RecognitionResult {
  const captureRef = { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'recognize_1' }
  const recognitionRef = { run_id: 'run_1', artifact_id: 'recognition_mcr_unsafe_1', span_id: 'recognize_1' }
  const recognizedItem = {
    item_id: 'item_1',
    kind: 'ocr_text',
    box: { x: 20, y: 20, width: 100, height: 24 },
    text: 'Open jobs',
    detail: {},
  }
  return {
    found: true,
    recognition_id: 'mcr:unsafe/1',
    source: 'ocr_text',
    scope: {
      surface: 'window',
      window_number: 42,
      capture_artifact: captureRef,
      capture_contract_artifact: { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'recognize_1' },
    },
    best: recognizedItem,
    filtered: [recognizedItem],
    all: [recognizedItem],
    detail: {},
    evidence: [captureRef, recognitionRef],
    known_limits: [],
  }
}

function fakeCandidate(options: {
  recognition?: RecognitionResult
  kind?: string
  label?: string
} = {}): PromotedCandidate {
  const recognition = options.recognition ?? fakeRecognitionResult()
  const kind = options.kind ?? 'ocr_text'
  const label = options.label ?? 'Open jobs'
  return {
    candidate_local_id: `${recognition.recognition_id}:item_1`,
    kind,
    label,
    target_spec: {
      grounding: 'ocr_anchor',
      box: { x: 20, y: 20, width: 100, height: 24 },
      anchor_text: label,
    },
    evidence: {
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'recognize_1' },
      recognition_artifact: { run_id: 'run_1', artifact_id: 'recognition_mcr_unsafe_1', span_id: 'recognize_1' },
      observation_blob: {},
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: 'com.google.Chrome',
          window_number: 42,
        },
        anchor_recheck: {
          text: label,
          expected_min_confidence: 0.3,
          max_pixel_distance: 50,
        },
      },
      ttl_hint_ms: 15000,
    },
    control: {
      requires_app_frontmost: true,
      requires_window_focus: true,
    },
    source_run_id: 'run_1',
    source_span_id: 'session',
    source_operation_id: recognition.recognition_id,
    source_artifact_id: 'recognition_mcr_unsafe_1',
    known_limits: [],
  }
}

function fakeSafetyCheckResult(): SafetyCheckResult {
  return {
    passed: true,
    checks: {
      profile_verified: true,
      chrome_foreground: true,
      no_hard_stop_signal: true,
    },
    failures: [],
  }
}

function promotedCandidateRef(candidate: PromotedCandidate): ArtifactRef {
  return {
    run_id: candidate.source_run_id,
    span_id: candidate.source_span_id,
    artifact_id: `promoted_${sanitizeArtifactId(candidate.source_operation_id)}`,
  }
}

function sanitizeArtifactId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 120)
}

function sameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.run_id === b.run_id
    && a.span_id === b.span_id
    && a.artifact_id === b.artifact_id
    && a.captured_event_id === b.captured_event_id
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function actionRefusalError(code: string, message: string): Error {
  const error = codedError(code, message)
  error.name = 'ActionRefusalError'
  return error
}
