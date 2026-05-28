import { classifyCandidate } from '../collection/classifyCandidate.js'
import { buildReviewItem } from '../collection/buildReviewItem.js'
import { writeReviewQueueItem } from '../collection/writeReviewQueue.js'
import { runVisualActionSession } from '../automation/sessionRunner.js'
import { planVisualAction } from '../llm/visualActionPlanner.js'
import { extractPageObservation } from '../llm/evidenceExtractor.js'
import { loadTargetRubric } from '../targets/targetRubric.js'
import { scoreTarget } from '../targets/scoreTarget.js'
import type {
  CandidateClassification,
  CollectionSession,
  ComputerUseAdapter,
  ModelAdapter,
  PageObservation,
  ReviewQueueItem,
  Rubric,
  ScoredTarget,
  TargetInput,
} from '../types.js'
import type { VisualActionSessionResult } from '../automation/sessionRunner.js'

export interface DiscoveryWorkflowResult {
  sessionResult: VisualActionSessionResult
  pageObservations: PageObservation[]
  reviewItems: ReviewQueueItem[]
  outputPaths: string[]
}

export async function runDiscoveryWorkflow({
  session,
  adapter,
  model,
  dataDir,
  write = true,
  targetRubric,
}: {
  session: CollectionSession
  adapter: ComputerUseAdapter
  model: ModelAdapter
  dataDir?: string
  write?: boolean
  targetRubric?: Rubric
}): Promise<DiscoveryWorkflowResult> {
  const sessionResult = await runVisualActionSession({
    session,
    adapter,
    planner: ({ session: boundedSession, state, history }) =>
      planVisualAction({
        model,
        session: boundedSession,
        state,
        history,
      }),
  })

  const finalState = sessionResult.observations.at(-1)
  if (!finalState) {
    throw new Error('Discovery workflow ended without page observations.')
  }

  const pageObservation = await extractPageObservation({
    model,
    session,
    state: finalState,
  })
  const classification = classifyCandidate(pageObservation)
  const scoredRecord = await scoreObservation({ pageObservation, classification, targetRubric })
  const reviewItem = buildReviewItem({
    session,
    observation: pageObservation,
    classification,
    scoredRecord,
  })

  const outputPaths: string[] = []
  if (write) {
    outputPaths.push(await writeReviewQueueItem(reviewItem, { dataDir }))
  }

  return {
    sessionResult,
    pageObservations: [pageObservation],
    reviewItems: [reviewItem],
    outputPaths,
  }
}

async function scoreObservation({
  pageObservation,
  classification,
  targetRubric,
}: {
  pageObservation: PageObservation
  classification: CandidateClassification
  targetRubric?: Rubric
}): Promise<ScoredTarget> {
  if (classification.candidateType === 'target_company') {
    const rubric = targetRubric ?? (await loadTargetRubric())
    return scoreTarget(pageObservation.extracted.target as TargetInput, rubric)
  }

  throw new Error(`Unsupported scoring path for candidate type: ${classification.candidateType}`)
}
