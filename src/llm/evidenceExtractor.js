import { normalizePageObservation } from "../collection/pageObservation.js";
import { normalizeVisualState } from "../automation/visualState.js";
import { generateJson, assertPlainObject } from "./modelContract.js";

export async function extractPageObservation({ model, session, state }) {
  const visualState = normalizeVisualState(state);
  const output = await generateJson(model, {
    task: "extract_page_observation",
    instructions:
      "Extract short evidence and structured candidate fields from visible page content. Do not return raw page text. Use only facts visible in the provided state.",
    session: {
      id: session.id,
      goal: session.goal
    },
    state: {
      url: visualState.url,
      title: visualState.title,
      sourceType: visualState.sourceType,
      observedAt: visualState.observedAt,
      screenshot: visualState.screenshot,
      visibleText: visualState.visibleText,
      elements: visualState.elements.map((element) => ({
        id: element.id,
        role: element.role,
        text: element.text,
        href: element.href
      })),
      signals: visualState.signals
    },
    requiredOutput:
      "Return JSON with evidence[] and extracted. extracted.candidateType must be target_company, job_opportunity, person_contact_surface, source_evidence, or irrelevant."
  });

  assertPlainObject(output, "Model extraction output");

  return normalizePageObservation({
    sessionId: visualState.sessionId,
    url: visualState.url,
    title: visualState.title,
    sourceType: visualState.sourceType,
    observedAt: visualState.observedAt,
    evidence: output.evidence ?? [],
    extracted: output.extracted
  });
}
