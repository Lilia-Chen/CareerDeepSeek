import type {
  CollectionSession,
  ModelAdapter,
  PageObservation,
  ReviewQueueItem,
  Rubric,
} from '../types.js'

export interface DiscoveryWorkflowResult {
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
  adapter: unknown
  model: ModelAdapter
  dataDir?: string
  write?: boolean
  targetRubric?: Rubric
}): Promise<DiscoveryWorkflowResult> {
  void session
  void adapter
  void model
  void dataDir
  void write
  void targetRubric
  throw new Error('runDiscoveryWorkflow retired: legacy visual action execution has been disabled.')
}
