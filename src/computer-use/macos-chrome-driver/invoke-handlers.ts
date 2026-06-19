import type {
  ComputerUseCommandSpec,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
  ComputerUseInvokeStatus,
} from './invoke-types.js'
import type {
  ArtifactRef,
  CandidatePromotion,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ObservationSnapshot,
  PromotedCandidate,
  RecognitionResult,
  SafetyCheckResult,
} from './types.js'

export interface ComputerUseCommandHandlerContext {
  request: ComputerUseInvokeRequest
  spec: Readonly<ComputerUseCommandSpec>
  spanId: string
}

export type ComputerUseCommandHandler
  = (context: ComputerUseCommandHandlerContext) => ComputerUseInvokeResult | Promise<ComputerUseInvokeResult>

export type ComputerUseCommandHandlerRegistry = Readonly<Partial<Record<string, ComputerUseCommandHandler>>>

export const EMPTY_COMPUTER_USE_COMMAND_HANDLERS: ComputerUseCommandHandlerRegistry = Object.freeze({})

export interface MacOSChromeInvokeScrollOptions {
  settleMs?: number
}

export interface MacOSChromeInvokeDriver {
  readonly lastCapture?: ChromeWindowCapture
  observe: () => Promise<ObservationSnapshot>
  recognizeFromCapture: (
    capture: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ) => Promise<RecognitionResult>
  checkSafetyGate: () => Promise<SafetyCheckResult>
  promoteCandidate: (
    recognition: RecognitionResult,
    capture: ChromeWindowCapture,
    targetKind?: ChromeRecognitionTarget['kind'],
  ) => Promise<CandidatePromotion>
  click: (candidate: PromotedCandidate) => Promise<void>
  focusTextInput: (candidate: PromotedCandidate) => Promise<void>
  typeText: (text: string) => Promise<void>
  pressKey: (key: string, modifiers?: string[]) => Promise<void>
  scroll: (
    deltaY?: number,
    deltaX?: number,
    options?: MacOSChromeInvokeScrollOptions,
  ) => Promise<void>
}

export function createMacOSChromeInvokeHandlers(driver: MacOSChromeInvokeDriver): ComputerUseCommandHandlerRegistry {
  let latestRecognition: RecognitionResult | undefined
  let latestRecognitionTargetKind: ChromeRecognitionTarget['kind'] | undefined
  let latestFocusedTarget: RegisteredFocusedTarget | undefined
  let latestNonTextInputClickedTarget: RegisteredFocusedTarget | undefined
  let latestObservation: ObservationSnapshot | undefined
  const promotedCandidates = new Map<string, RegisteredPromotedCandidate>()
  const resetActionSequence = (): void => {
    latestRecognition = undefined
    latestRecognitionTargetKind = undefined
    latestFocusedTarget = undefined
    latestNonTextInputClickedTarget = undefined
    promotedCandidates.clear()
  }

  return Object.freeze({
    'chrome.observe': async ({ spec }) => {
      resetActionSequence()
      const result = await invokeObserve(spec, driver)
      latestObservation = isObservationSnapshot(result.output) ? result.output : undefined
      return result
    },
    'chrome.recognize': async ({ request, spec }) => {
      resetActionSequence()
      const result = await invokeRecognize(request, spec, driver)
      if (result.status === 'completed' && isRecognitionResult(result.output)) {
        latestRecognition = result.output
        const targetResult = parseRecognitionTarget(request.inputs?.target)
        latestRecognitionTargetKind = targetResult.ok ? targetResult.target.kind : undefined
      }
      return result
    },
    'chrome.checkSafetyGate': async ({ spec }) => invokeCheckSafetyGate(spec, driver),
    'chrome.promote': async ({ request, spec }) =>
      invokePromote(request, spec, driver, latestRecognition, latestRecognitionTargetKind, promotedCandidates),
    'chrome.clickCandidate': async ({ request, spec }) =>
      invokeClickCandidate(request, spec, driver, promotedCandidates, (target) => {
        latestObservation = undefined
        latestFocusedTarget = undefined
        latestNonTextInputClickedTarget = target
      }),
    'chrome.focusTextInput': async ({ request, spec }) =>
      invokeFocusTextInput(request, spec, driver, promotedCandidates, (target) => {
        latestObservation = undefined
        latestFocusedTarget = target
        latestNonTextInputClickedTarget = undefined
      }),
    'chrome.typeText': async ({ request, spec }) =>
      invokeTypeText(request, spec, driver, latestFocusedTarget, latestNonTextInputClickedTarget)
        .then((result) => {
          if (result.status === 'completed')
            latestObservation = undefined
          return result
        }),
    'chrome.pressKey': async ({ request, spec }) =>
      invokePressKey(request, spec, driver, latestFocusedTarget, latestNonTextInputClickedTarget)
        .then((result) => {
          if (result.status === 'completed')
            latestObservation = undefined
          return result
        }),
    'chrome.scroll': async ({ request, spec }) =>
      invokeScroll(request, spec, driver, latestObservation)
        .then((result) => {
          if (result.status === 'completed')
            latestObservation = undefined
          return result
        }),
  })
}

interface RegisteredPromotedCandidate {
  candidate: PromotedCandidate
  candidateRef: ArtifactRef
  recognitionTargetKind: ChromeRecognitionTarget['kind'] | undefined
}

interface RegisteredFocusedTarget {
  candidateLocalId: string
  candidateRef: ArtifactRef
}

async function invokeObserve(
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  try {
    const snapshot = await driver.observe()
    const artifacts = uniqueArtifactRefs([
      observationArtifactRef(snapshot),
      ...snapshot.evidence,
      ...(snapshot.capture_contract_ref ? [snapshot.capture_contract_ref] : []),
    ])
    const hardStopSignals = observationHardStopSignals(snapshot)

    return {
      commandId: spec.id,
      status: 'completed',
      summary: `Observed Chrome window snapshot ${snapshot.snapshot_id}.`,
      output: snapshot,
      signals: [
        'observe_completed',
        ...(hardStopSignals.length > 0 ? ['hard_stop_signal'] : []),
      ],
      artifacts,
      knownLimits: uniqueStrings([
        'read_only_observation_only',
        ...snapshot.known_limits,
      ]),
    }
  }
  catch (error) {
    return failureResult({
      commandId: spec.id,
      summary: 'Chrome observe failed.',
      failureClass: 'observe',
      code: 'observe_failed',
      message: errorMessage(error),
      signals: ['observe_failed'],
      knownLimits: ['read_only_observation_only'],
    })
  }
}

async function invokeRecognize(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const targetResult = parseRecognitionTarget(request.inputs?.target)
  if (!targetResult.ok) {
    return failureResult({
      commandId: spec.id,
      summary: 'Recognition target input is invalid.',
      failureClass: 'invalid_input',
      code: targetResult.code,
      message: targetResult.message,
      signals: ['invalid_recognition_target'],
      knownLimits: ['read_only_recognition_requires_explicit_target'],
    })
  }

  const capture = driver.lastCapture
  if (!capture) {
    return failureResult({
      commandId: spec.id,
      summary: 'Recognition requires a previous Chrome capture.',
      failureClass: 'recognition',
      code: 'last_capture_missing',
      message: 'chrome.recognize requires driver.lastCapture from a prior chrome.observe call.',
      signals: ['last_capture_missing'],
      knownLimits: ['caller_must_invoke_chrome_observe_before_chrome_recognize'],
    })
  }

  try {
    const recognition = await driver.recognizeFromCapture(capture, targetResult.target)
    const recognitionRef = recognitionArtifactRef(recognition)
    const artifacts = uniqueArtifactRefs([recognitionRef, ...recognition.evidence])
    if (!recognition.found) {
      return {
        commandId: spec.id,
        status: 'failed',
        summary: `Recognition ${recognition.recognition_id} found no matching target.`,
        output: recognition,
        signals: ['recognition_not_found'],
        artifacts,
        failure: {
          class: 'recognition',
          code: 'recognition_not_found',
          message: 'No matching recognition target was found in the latest capture.',
        },
        knownLimits: uniqueStrings([
          'read_only_recognition_only',
          ...recognition.known_limits,
        ]),
      }
    }

    return {
      commandId: spec.id,
      status: 'completed',
      summary: `Recognition ${recognition.recognition_id} found a target.`,
      output: recognition,
      signals: ['recognition_found'],
      artifacts,
      knownLimits: uniqueStrings([
        'read_only_recognition_only',
        ...recognition.known_limits,
      ]),
    }
  }
  catch (error) {
    return failureResult({
      commandId: spec.id,
      summary: 'Chrome recognition failed.',
      failureClass: 'recognition',
      code: 'recognition_failed',
      message: errorMessage(error),
      signals: ['recognition_failed'],
      knownLimits: ['read_only_recognition_only'],
    })
  }
}

async function invokeCheckSafetyGate(
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  try {
    const result = await driver.checkSafetyGate()
    if (result.passed) {
      return {
        commandId: spec.id,
        status: 'completed',
        summary: 'Chrome safety gate passed.',
        output: result,
        signals: ['safety_gate_passed'],
        artifacts: [],
        knownLimits: ['read_only_safety_check_only'],
      }
    }

    const failure = result.failures[0]
    const hardStop = result.failures.some(item => item.code === 'hard_stop_signal')
    const failureCode = hardStop ? 'hard_stop_signal' : (failure?.code ?? 'safety_gate_failed')

    return {
      commandId: spec.id,
      status: 'refused',
      summary: `Chrome safety gate refused: ${failureCode}.`,
      output: result,
      signals: uniqueStrings([
        'safety_gate_failed',
        ...result.failures.map(item => item.code),
      ]),
      artifacts: [],
      failure: {
        class: hardStop ? 'hard_stop' : 'safety_gate',
        code: failureCode,
        message: failure?.detail ?? 'Chrome safety gate refused the current context.',
      },
      knownLimits: [
        hardStop ? 'hard_stop_exposed_without_overlay_dismissal' : 'read_only_safety_check_only',
      ],
    }
  }
  catch (error) {
    return failureResult({
      commandId: spec.id,
      summary: 'Chrome safety gate check failed.',
      failureClass: 'safety_gate',
      code: 'check_safety_gate_failed',
      message: errorMessage(error),
      signals: ['safety_gate_check_failed'],
      knownLimits: ['read_only_safety_check_only'],
    })
  }
}

async function invokePromote(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  latestRecognition: RecognitionResult | undefined,
  latestRecognitionTargetKind: ChromeRecognitionTarget['kind'] | undefined,
  promotedCandidates: Map<string, RegisteredPromotedCandidate>,
): Promise<ComputerUseInvokeResult> {
  if (isRecord(request.inputs) && Object.hasOwn(request.inputs, 'recognition')) {
    return failureResult({
      commandId: spec.id,
      summary: 'Raw recognition JSON is not accepted by chrome.promote.',
      failureClass: 'invalid_input',
      code: 'raw_recognition_not_accepted',
      message: 'chrome.promote consumes the latest same-sequence recognition result, not raw recognition JSON.',
      signals: ['raw_recognition_not_accepted'],
      knownLimits: ['same_sequence_recognition_required'],
    })
  }

  if (!latestRecognition) {
    return failureResult({
      commandId: spec.id,
      summary: 'Promotion requires a successful same-sequence recognition.',
      failureClass: 'candidate_promotion',
      code: 'recognition_not_in_sequence',
      message: 'Run chrome.recognize successfully before chrome.promote with the same handler registry.',
      signals: ['recognition_not_in_sequence'],
      knownLimits: ['caller_must_invoke_chrome_recognize_before_chrome_promote'],
    })
  }

  const recognitionId = request.inputs?.recognitionId
  if (recognitionId !== undefined && typeof recognitionId !== 'string') {
    return failureResult({
      commandId: spec.id,
      summary: 'Promotion recognitionId input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_recognition_id',
      message: 'chrome.promote inputs.recognitionId must be a string when provided.',
      signals: ['invalid_recognition_id'],
      knownLimits: ['same_sequence_recognition_required'],
    })
  }
  if (typeof recognitionId === 'string' && recognitionId !== latestRecognition.recognition_id) {
    return failureResult({
      commandId: spec.id,
      summary: 'Promotion recognitionId does not match the latest recognition.',
      failureClass: 'candidate_promotion',
      code: 'recognition_id_mismatch',
      message: `Latest recognition is ${latestRecognition.recognition_id}, not ${recognitionId}.`,
      signals: ['recognition_id_mismatch'],
      knownLimits: ['same_sequence_recognition_required'],
    })
  }

  const capture = driver.lastCapture
  if (!capture) {
    return failureResult({
      commandId: spec.id,
      summary: 'Promotion requires the latest Chrome capture.',
      failureClass: 'candidate_promotion',
      code: 'last_capture_missing',
      message: 'chrome.promote requires driver.lastCapture from a prior chrome.observe/chrome.recognize sequence.',
      signals: ['last_capture_missing'],
      knownLimits: ['caller_must_keep_latest_capture_available_for_promotion'],
    })
  }

  let promotion: CandidatePromotion
  try {
    promotion = await driver.promoteCandidate(latestRecognition, capture, latestRecognitionTargetKind)
  }
  catch (error) {
    return failureResult({
      commandId: spec.id,
      summary: 'Chrome candidate promotion failed.',
      failureClass: 'candidate_promotion',
      code: 'promotion_failed',
      message: errorMessage(error),
      signals: ['candidate_promotion_failed'],
      knownLimits: ['same_sequence_recognition_required'],
    })
  }

  if (promotion.status === 'refused') {
    const code = promotion.reasons[0] ?? 'candidate_promotion_refused'
    return failureResult({
      commandId: spec.id,
      status: 'refused',
      summary: `Chrome candidate promotion refused: ${code}.`,
      output: promotion,
      failureClass: 'candidate_promotion',
      code,
      message: `Candidate promotion refused: ${promotion.reasons.join(', ') || code}.`,
      signals: uniqueStrings(['candidate_promotion_refused', ...promotion.reasons]),
      knownLimits: uniqueStrings([
        'same_sequence_recognition_required',
        ...promotion.residual_known_limits,
      ]),
    })
  }

  const { candidate } = promotion
  const candidateRef = promotedCandidateArtifactRef(candidate)
  promotedCandidates.set(candidate.candidate_local_id, {
    candidate,
    candidateRef,
    recognitionTargetKind: latestRecognitionTargetKind,
  })

  return {
    commandId: spec.id,
    status: 'completed',
    summary: `Promoted candidate ${candidate.candidate_local_id}.`,
    output: {
      candidateLocalId: candidate.candidate_local_id,
      candidateRef,
      kind: candidate.kind,
      label: candidate.label,
    },
    signals: ['candidate_promoted'],
    artifacts: uniqueArtifactRefs([
      candidateRef,
      ...candidateEvidenceRefs(candidate),
    ]),
    knownLimits: uniqueStrings([
      'same_session_candidate_only',
      ...candidate.known_limits,
      ...promotion.residual_known_limits,
    ]),
  }
}

async function invokeClickCandidate(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  promotedCandidates: Map<string, RegisteredPromotedCandidate>,
  setNonTextInputClickedTarget: (target: RegisteredFocusedTarget) => void,
): Promise<ComputerUseInvokeResult> {
  const parsed = parseCandidateLocalIdInput(request.inputs, {
    missingCode: 'missing_candidate_local_id',
    rawCandidateCode: 'raw_candidate_not_accepted',
  })
  if (!parsed.ok)
    return parsed.result(spec.id)

  const registered = promotedCandidates.get(parsed.candidateLocalId)
  if (!registered) {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'candidate_not_in_sequence',
      message: 'candidateLocalId was not produced by chrome.promote in this handler sequence.',
      signals: ['candidate_not_in_sequence'],
    })
  }

  if (parsed.candidateRef && !sameArtifactRef(parsed.candidateRef, registered.candidateRef)) {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'candidate_ref_mismatch',
      message: 'candidateRef does not match the registered same-session promoted candidate.',
      signals: ['candidate_ref_mismatch'],
      artifacts: [registered.candidateRef],
    })
  }

  if (registered.candidate.target_spec.grounding === 'ax_node') {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'unsupported_click_candidate_grounding',
      message: 'chrome.clickCandidate consumes OCR click candidates only; use chrome.focusTextInput for ax_node text inputs.',
      signals: ['unsupported_click_candidate_grounding'],
      artifacts: [registered.candidateRef],
    })
  }

  const artifacts = uniqueArtifactRefs([registered.candidateRef, ...candidateEvidenceRefs(registered.candidate)])
  try {
    await driver.click(registered.candidate)
  }
  catch (error) {
    return driverActionFailureResult(spec.id, 'click', error, artifacts)
  }

  const clickedTarget = {
    candidateLocalId: registered.candidate.candidate_local_id,
    candidateRef: registered.candidateRef,
  }
  setNonTextInputClickedTarget(clickedTarget)

  return {
    commandId: spec.id,
    status: 'completed',
    summary: `Clicked candidate ${registered.candidate.candidate_local_id}.`,
    output: {
      candidateLocalId: registered.candidate.candidate_local_id,
      candidateRef: registered.candidateRef,
    },
    signals: ['candidate_clicked'],
    artifacts,
    knownLimits: [
      'caller_must_invoke_chrome_observe_after_action',
      'driver_liveness_recheck_preserved',
    ],
  }
}

async function invokeFocusTextInput(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  promotedCandidates: Map<string, RegisteredPromotedCandidate>,
  setFocusedTarget: (target: RegisteredFocusedTarget) => void,
): Promise<ComputerUseInvokeResult> {
  const parsed = parseCandidateLocalIdInput(request.inputs, {
    missingCode: 'missing_candidate_local_id',
    rawCandidateCode: 'raw_candidate_not_accepted',
  })
  if (!parsed.ok)
    return parsed.result(spec.id)

  const registered = promotedCandidates.get(parsed.candidateLocalId)
  if (!registered) {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'candidate_not_in_sequence',
      message: 'candidateLocalId was not produced by chrome.promote in this handler sequence.',
      signals: ['candidate_not_in_sequence'],
    })
  }

  if (registered.recognitionTargetKind !== 'text_input' || registered.candidate.target_spec.grounding !== 'ax_node') {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'focus_candidate_not_ax_node_text_input',
      message: 'chrome.focusTextInput requires a same-session ax_node candidate recognized as text_input.',
      signals: ['focus_candidate_not_ax_node_text_input'],
      artifacts: [registered.candidateRef],
    })
  }

  if (parsed.candidateRef && !sameArtifactRef(parsed.candidateRef, registered.candidateRef)) {
    return candidateProvenanceRefusal({
      commandId: spec.id,
      code: 'candidate_ref_mismatch',
      message: 'candidateRef does not match the registered same-session promoted candidate.',
      signals: ['candidate_ref_mismatch'],
      artifacts: [registered.candidateRef],
    })
  }

  const artifacts = uniqueArtifactRefs([registered.candidateRef, ...candidateEvidenceRefs(registered.candidate)])
  try {
    await driver.focusTextInput(registered.candidate)
  }
  catch (error) {
    return driverActionFailureResult(spec.id, 'focusTextInput', error, artifacts)
  }

  const focusedTarget = {
    candidateLocalId: registered.candidate.candidate_local_id,
    candidateRef: registered.candidateRef,
  }
  setFocusedTarget(focusedTarget)

  return {
    commandId: spec.id,
    status: 'completed',
    summary: `Focused text input candidate ${registered.candidate.candidate_local_id}.`,
    output: {
      candidateLocalId: registered.candidate.candidate_local_id,
      candidateRef: registered.candidateRef,
    },
    signals: ['candidate_focused', 'focused_target_recorded'],
    artifacts,
    knownLimits: [
      'caller_must_invoke_chrome_observe_after_keyboard_action',
      'driver_liveness_recheck_preserved',
    ],
  }
}

async function invokeTypeText(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  latestFocusedTarget: RegisteredFocusedTarget | undefined,
  latestNonTextInputClickedTarget: RegisteredFocusedTarget | undefined,
): Promise<ComputerUseInvokeResult> {
  const text = request.inputs?.text
  if (typeof text !== 'string') {
    return failureResult({
      commandId: spec.id,
      summary: 'typeText requires text input.',
      failureClass: 'invalid_input',
      code: 'missing_text',
      message: 'chrome.typeText requires inputs.text as a string.',
      signals: ['missing_text'],
      knownLimits: ['audited_focused_target_required'],
    })
  }

  const focused = requireFocusedCandidate(request.inputs, latestFocusedTarget, latestNonTextInputClickedTarget)
  if (!focused.ok)
    return focused.result(spec.id)

  try {
    await driver.typeText(text)
  }
  catch (error) {
    return driverActionFailureResult(spec.id, 'typeText', error, [focused.focusedTarget.candidateRef])
  }

  return {
    commandId: spec.id,
    status: 'completed',
    summary: 'Typed text into audited focused target.',
    output: {
      focusedCandidateLocalId: focused.focusedTarget.candidateLocalId,
      textLength: text.length,
    },
    signals: ['text_typed'],
    artifacts: [focused.focusedTarget.candidateRef],
    knownLimits: [
      'audited_focused_target_required',
      'caller_must_invoke_chrome_observe_after_action',
    ],
  }
}

async function invokePressKey(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  latestFocusedTarget: RegisteredFocusedTarget | undefined,
  latestNonTextInputClickedTarget: RegisteredFocusedTarget | undefined,
): Promise<ComputerUseInvokeResult> {
  const key = request.inputs?.key
  if (typeof key !== 'string') {
    return failureResult({
      commandId: spec.id,
      summary: 'pressKey requires key input.',
      failureClass: 'invalid_input',
      code: 'missing_key',
      message: 'chrome.pressKey requires inputs.key as a string.',
      signals: ['missing_key'],
      knownLimits: ['audited_focused_target_required'],
    })
  }

  const modifiers = request.inputs?.modifiers
  if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.some(item => typeof item !== 'string'))) {
    return failureResult({
      commandId: spec.id,
      summary: 'pressKey modifiers input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_modifiers',
      message: 'chrome.pressKey inputs.modifiers must be an array of strings when provided.',
      signals: ['invalid_modifiers'],
      knownLimits: ['audited_focused_target_required'],
    })
  }

  const focused = requireFocusedCandidate(request.inputs, latestFocusedTarget, latestNonTextInputClickedTarget)
  if (!focused.ok)
    return focused.result(spec.id)

  const normalizedModifiers = modifiers ?? []
  try {
    await driver.pressKey(key, normalizedModifiers)
  }
  catch (error) {
    return driverActionFailureResult(spec.id, 'pressKey', error, [focused.focusedTarget.candidateRef])
  }

  return {
    commandId: spec.id,
    status: 'completed',
    summary: 'Pressed key for audited focused target.',
    output: {
      focusedCandidateLocalId: focused.focusedTarget.candidateLocalId,
      key,
      modifiers: normalizedModifiers,
    },
    signals: ['key_pressed'],
    artifacts: [focused.focusedTarget.candidateRef],
    knownLimits: [
      'audited_focused_target_required',
      'caller_must_invoke_chrome_observe_after_action',
    ],
  }
}

async function invokeScroll(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
  latestObservation: ObservationSnapshot | undefined,
): Promise<ComputerUseInvokeResult> {
  const forbiddenInput = firstForbiddenScrollInput(request.inputs)
  if (forbiddenInput) {
    return failureResult({
      commandId: spec.id,
      status: 'refused',
      summary: 'scroll rejected unsupported target input.',
      failureClass: 'invalid_input',
      code: 'scroll_target_input_not_accepted',
      message: `chrome.scroll does not accept inputs.${forbiddenInput}; run chrome.observe and let the driver derive the scroll region.`,
      signals: ['scroll_target_input_not_accepted', forbiddenInput],
      knownLimits: ['scroll_uses_latest_observed_chrome_region'],
    })
  }

  const deltaY = numberInputOrDefault(request.inputs?.deltaY, 600)
  if (!deltaY.ok)
    return deltaY.result(spec.id, 'deltaY')
  const deltaX = numberInputOrDefault(request.inputs?.deltaX, 0)
  if (!deltaX.ok)
    return deltaX.result(spec.id, 'deltaX')
  const settleMs = optionalNumberInput(request.inputs?.settleMs)
  if (!settleMs.ok)
    return settleMs.result(spec.id, 'settleMs')

  if (!latestObservation) {
    return failureResult({
      commandId: spec.id,
      status: 'refused',
      summary: 'scroll requires a prior observe command.',
      failureClass: 'safety_gate',
      code: 'scroll_region_not_observed',
      message: 'chrome.scroll requires a latest chrome.observe result so the driver can use its observed Chrome scroll region.',
      signals: ['scroll_region_not_observed'],
      knownLimits: ['caller_must_invoke_chrome_observe_before_scroll'],
    })
  }

  const options: MacOSChromeInvokeScrollOptions = {}
  if (settleMs.value !== undefined)
    options.settleMs = settleMs.value

  const artifacts = uniqueArtifactRefs([
    observationArtifactRef(latestObservation),
    ...latestObservation.evidence,
    ...(latestObservation.capture_contract_ref ? [latestObservation.capture_contract_ref] : []),
  ])
  try {
    await driver.scroll(deltaY.value, deltaX.value, options)
  }
  catch (error) {
    return driverActionFailureResult(spec.id, 'scroll', error, artifacts)
  }

  return {
    commandId: spec.id,
    status: 'completed',
    summary: `Scrolled observed Chrome region from snapshot ${latestObservation.snapshot_id}.`,
    output: {
      observationSnapshotId: latestObservation.snapshot_id,
      deltaY: deltaY.value,
      deltaX: deltaX.value,
    },
    signals: ['scroll_delivered'],
    artifacts,
    knownLimits: [
      'scroll_uses_latest_observed_chrome_region',
      'scroll_result_does_not_claim_page_boundary',
      'caller_must_invoke_chrome_observe_after_action',
    ],
  }
}

function isRecognitionResult(value: unknown): value is RecognitionResult {
  return isRecord(value)
    && typeof value.recognition_id === 'string'
    && typeof value.found === 'boolean'
    && Array.isArray(value.evidence)
}

function isObservationSnapshot(value: unknown): value is ObservationSnapshot {
  return isRecord(value)
    && value.api_version === 'careerdeepseek.observation_snapshot.v1alpha1'
    && typeof value.snapshot_id === 'string'
    && Array.isArray(value.evidence)
}

function firstForbiddenScrollInput(inputs: Record<string, unknown> | undefined): string | undefined {
  if (!inputs)
    return undefined
  for (const field of ['candidateLocalId', 'candidateRef', 'candidate', 'screenPoint', 'windowLocalPoint']) {
    if (Object.hasOwn(inputs, field))
      return field
  }
  return undefined
}

function observationArtifactRef(snapshot: ObservationSnapshot): ArtifactRef {
  return {
    run_id: snapshot.run_id,
    artifact_id: `observation_${snapshot.snapshot_id}`,
    span_id: snapshot.span_id,
  }
}

function recognitionArtifactRef(result: RecognitionResult): ArtifactRef {
  return {
    run_id: result.detail.run_id && typeof result.detail.run_id === 'string'
      ? result.detail.run_id
      : result.evidence[0]?.run_id ?? 'unknown_run',
    artifact_id: `recognition_${result.recognition_id}`,
    span_id: result.detail.span_id && typeof result.detail.span_id === 'string'
      ? result.detail.span_id
      : result.evidence[0]?.span_id ?? 'unknown_span',
  }
}

function promotedCandidateArtifactRef(candidate: PromotedCandidate): ArtifactRef {
  return {
    run_id: candidate.source_run_id,
    artifact_id: `promoted_${sanitizeArtifactId(candidate.source_operation_id)}`,
    span_id: candidate.source_span_id,
  }
}

function candidateEvidenceRefs(candidate: PromotedCandidate): ArtifactRef[] {
  return [
    candidate.evidence.capture_artifact,
    candidate.evidence.recognition_artifact,
  ]
}

function sanitizeArtifactId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 120)
}

type RecognitionTargetParseResult
  = | { ok: true, target: ChromeRecognitionTarget }
    | { ok: false, code: string, message: string }

function parseRecognitionTarget(value: unknown): RecognitionTargetParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: 'missing_recognition_target',
      message: 'chrome.recognize requires inputs.target.',
    }
  }

  switch (value.kind) {
    case 'text_input':
      if (isStringOrRegExp(value.name))
        return { ok: true, target: { kind: value.kind, name: value.name } }
      break
    case 'button':
    case 'link':
    case 'visible_text':
    case 'ocr_text':
    case 'ocr_row':
      if (isStringOrRegExp(value.text))
        return { ok: true, target: { kind: value.kind, text: value.text } }
      break
  }

  return {
    ok: false,
    code: 'invalid_recognition_target',
    message: 'Recognition target must include a supported kind and a string or RegExp text/name field.',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringOrRegExp(value: unknown): value is string | RegExp {
  return typeof value === 'string' || value instanceof RegExp
}

type CandidateLocalIdParseResult
  = | {
    ok: true
    candidateLocalId: string
    candidateRef?: ArtifactRef
  }
  | {
    ok: false
    result: (commandId: string) => ComputerUseInvokeResult
  }

function parseCandidateLocalIdInput(
  inputs: Record<string, unknown> | undefined,
  codes: {
    missingCode: string
    rawCandidateCode: string
  },
): CandidateLocalIdParseResult {
  if (isRecord(inputs) && Object.hasOwn(inputs, 'candidate')) {
    return {
      ok: false,
      result: commandId => failureResult({
        commandId,
        summary: 'Raw candidate JSON is not accepted as action input.',
        failureClass: 'invalid_input',
        code: codes.rawCandidateCode,
        message: 'Action commands consume same-session candidateLocalId, not raw PromotedCandidate JSON.',
        signals: [codes.rawCandidateCode],
        knownLimits: ['same_session_candidate_only'],
      }),
    }
  }

  const candidateLocalId = inputs?.candidateLocalId
  if (typeof candidateLocalId !== 'string' || candidateLocalId.trim() === '') {
    return {
      ok: false,
      result: commandId => candidateProvenanceRefusal({
        commandId,
        code: codes.missingCode,
        message: 'Action command requires inputs.candidateLocalId from a prior chrome.promote call.',
        signals: [codes.missingCode],
      }),
    }
  }

  const candidateRefInput = inputs?.candidateRef
  if (candidateRefInput === undefined)
    return { ok: true, candidateLocalId }

  if (!isArtifactRef(candidateRefInput)) {
    return {
      ok: false,
      result: commandId => failureResult({
        commandId,
        summary: 'candidateRef input is invalid.',
        failureClass: 'invalid_input',
        code: 'invalid_candidate_ref',
        message: 'inputs.candidateRef must be an ArtifactRef when provided.',
        signals: ['invalid_candidate_ref'],
        knownLimits: ['same_session_candidate_only'],
      }),
    }
  }

  return { ok: true, candidateLocalId, candidateRef: candidateRefInput }
}

type FocusedCandidateCheck
  = | { ok: true, focusedTarget: RegisteredFocusedTarget }
    | { ok: false, result: (commandId: string) => ComputerUseInvokeResult }

function requireFocusedCandidate(
  inputs: Record<string, unknown> | undefined,
  latestFocusedTarget: RegisteredFocusedTarget | undefined,
  latestNonTextInputClickedTarget: RegisteredFocusedTarget | undefined,
): FocusedCandidateCheck {
  const focusedCandidateLocalId = inputs?.focusedCandidateLocalId
  if (typeof focusedCandidateLocalId !== 'string' || focusedCandidateLocalId.trim() === '') {
    return {
      ok: false,
      result: commandId => candidateProvenanceRefusal({
        commandId,
        code: 'missing_focused_candidate_local_id',
        message: 'Keyboard action requires inputs.focusedCandidateLocalId from a successful focusTextInput action.',
        signals: ['missing_focused_candidate_local_id'],
      }),
    }
  }

  if (!latestFocusedTarget || latestFocusedTarget.candidateLocalId !== focusedCandidateLocalId) {
    if (latestNonTextInputClickedTarget?.candidateLocalId === focusedCandidateLocalId) {
      return {
        ok: false,
        result: commandId => candidateProvenanceRefusal({
          commandId,
          code: 'focused_candidate_not_text_input',
          message: 'focusedCandidateLocalId refers to the latest clicked candidate, but that candidate was not recognized as text_input.',
          signals: ['focused_candidate_not_text_input'],
          artifacts: [latestNonTextInputClickedTarget.candidateRef],
        }),
      }
    }

    return {
      ok: false,
      result: commandId => candidateProvenanceRefusal({
        commandId,
        code: 'focused_candidate_not_in_sequence',
        message: 'focusedCandidateLocalId does not match the latest successful focusTextInput record.',
        signals: ['focused_candidate_not_in_sequence'],
      }),
    }
  }

  return { ok: true, focusedTarget: latestFocusedTarget }
}

function candidateProvenanceRefusal(input: {
  commandId: string
  code: string
  message: string
  signals: string[]
  artifacts?: ArtifactRef[]
}): ComputerUseInvokeResult {
  return failureResult({
    commandId: input.commandId,
    status: 'refused',
    summary: `Candidate provenance refused: ${input.code}.`,
    failureClass: 'candidate_provenance',
    code: input.code,
    message: input.message,
    signals: input.signals,
    artifacts: input.artifacts,
    knownLimits: ['same_session_candidate_only'],
  })
}

type NumberInputResult
  = | { ok: true, value: number | undefined }
    | {
      ok: false
      result: (commandId: string, field: string) => ComputerUseInvokeResult
    }

function numberInputOrDefault(value: unknown, defaultValue: number): NumberInputResult {
  if (value === undefined)
    return { ok: true, value: defaultValue }
  return optionalNumberInput(value)
}

function optionalNumberInput(value: unknown): NumberInputResult {
  if (value === undefined)
    return { ok: true, value }
  if (typeof value === 'number' && Number.isFinite(value))
    return { ok: true, value }
  return {
    ok: false,
    result: (commandId, field) => failureResult({
      commandId,
      summary: `${field} input is invalid.`,
      failureClass: 'invalid_input',
      code: `invalid_${field}`,
      message: `${field} must be a finite number when provided.`,
      signals: [`invalid_${field}`],
      knownLimits: ['scroll_uses_latest_observed_chrome_region'],
    }),
  }
}

function driverActionFailureResult(
  commandId: string,
  actionType: string,
  error: unknown,
  artifacts: ArtifactRef[],
): ComputerUseInvokeResult {
  const mapped = mapDriverActionError(error)
  return failureResult({
    commandId,
    summary: `${actionType} action failed: ${mapped.code}.`,
    failureClass: mapped.failureClass,
    code: mapped.code,
    message: errorMessage(error),
    signals: uniqueStrings([`${actionType}_failed`, mapped.code]),
    artifacts,
    knownLimits: ['driver_action_failure_mapped_without_browser_recovery'],
  })
}

const SAFETY_GATE_FAILURE_CODES = new Set([
  'chrome_context_lease_missing',
  'chrome_context_lease_invalid',
  'profile_mismatch',
  'chrome_not_foreground',
  'fresh_window_mismatch',
  'fresh_observe_failed',
  'fresh_capture_missing',
  'fresh_recognition_failed',
  'fresh_recognition_not_found',
  'fresh_target_conflict',
  'fresh_target_unstable',
  'fresh_target_outside_window',
  'unsupported_click_candidate_kind',
  'anchor_recheck_unavailable',
  'anchor_recheck_ambiguous',
  'anchor_recheck_missing',
  'anchor_recheck_incompatible_source',
  'anchor_recheck_projection_unavailable',
  'anchor_recheck_low_confidence',
  'anchor_recheck_moved',
  'anchor_recheck_outside_window',
  'scroll_region_not_observed',
  'scroll_region_stale',
  'scroll_region_window_changed',
  'scroll_region_outside_window',
])

function mapDriverActionError(error: unknown): {
  failureClass: ComputerUseFailureClass
  code: string
} {
  const code = errorCode(error)
  const message = errorMessage(error)
  const searchable = `${code ?? ''}\n${message}`.toLowerCase()

  if (searchable.includes('missing_promoted_candidate_artifact')) {
    return {
      failureClass: 'candidate_provenance',
      code: 'missing_promoted_candidate_artifact',
    }
  }
  if (searchable.includes('promoted_candidate_artifact_mismatch')) {
    return {
      failureClass: 'candidate_provenance',
      code: 'promoted_candidate_artifact_mismatch',
    }
  }
  if (searchable.includes('hard_stop_signal'))
    return { failureClass: 'hard_stop', code: 'hard_stop_signal' }
  if (code && SAFETY_GATE_FAILURE_CODES.has(code))
    return { failureClass: 'safety_gate', code }
  if (code === 'action_execution_error' || errorName(error) === 'ActionExecutionError')
    return { failureClass: 'action_delivery', code: 'action_execution_error' }

  for (const safetyCode of SAFETY_GATE_FAILURE_CODES) {
    if (searchable.includes(safetyCode))
      return { failureClass: 'safety_gate', code: safetyCode }
  }

  return { failureClass: 'action_delivery', code: 'action_execution_error' }
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  return isRecord(value)
    && typeof value.run_id === 'string'
    && typeof value.artifact_id === 'string'
    && typeof value.span_id === 'string'
    && (
      value.captured_event_id === undefined
      || typeof value.captured_event_id === 'string'
    )
}

function sameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.run_id === b.run_id
    && a.span_id === b.span_id
    && a.artifact_id === b.artifact_id
    && a.captured_event_id === b.captured_event_id
}

function observationHardStopSignals(snapshot: ObservationSnapshot): string[] {
  const signals = isRecord(snapshot.detail) ? snapshot.detail.signals : undefined
  if (!Array.isArray(signals))
    return []
  return signals.filter((item): item is string => typeof item === 'string')
}

function failureResult(input: {
  commandId: string
  status?: ComputerUseInvokeStatus
  summary: string
  output?: unknown
  failureClass: ComputerUseFailureClass
  code: string
  message: string
  signals: string[]
  artifacts?: ArtifactRef[]
  knownLimits: string[]
}): ComputerUseInvokeResult {
  return {
    commandId: input.commandId,
    status: input.status ?? 'failed',
    summary: input.summary,
    output: input.output,
    signals: input.signals,
    artifacts: input.artifacts ?? [],
    failure: {
      class: input.failureClass,
      code: input.code,
      message: input.message,
    },
    knownLimits: input.knownLimits,
  }
}

function uniqueArtifactRefs(refs: ArtifactRef[]): ArtifactRef[] {
  const seen = new Set<string>()
  const unique: ArtifactRef[] = []
  for (const ref of refs) {
    const key = `${ref.run_id}:${ref.span_id}:${ref.artifact_id}:${ref.captured_event_id ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(ref)
    }
  }
  return unique
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return 'unknown error'
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error))
    return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function errorName(error: unknown): string | undefined {
  if (!isRecord(error))
    return undefined
  return typeof error.name === 'string' ? error.name : undefined
}
