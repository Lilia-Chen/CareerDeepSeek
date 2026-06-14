export type JsonRecord = Record<string, unknown>

export type SourceType
  = | 'search_engine'
    | 'company_site'
    | 'public_careers'
    | 'public_ats'
    | 'engineering_blog'
    | 'documentation'
    | 'changelog'
    | 'github_org'

export type CandidateType
  = | 'target_company'
    | 'job_opportunity'
    | 'person_contact_surface'
    | 'source_evidence'
    | 'irrelevant'

export interface EvidenceItem {
  label: string
  text: string
  sourceUrl: string
}

export interface PageBudget {
  maxPages: number
}

export interface CollectionSession {
  id: string
  goal: string
  sourceScope: SourceType[]
  pageBudget: PageBudget
  stopConditions: string[]
}

export interface VisualBox {
  x: number
  y: number
  width: number
  height: number
}

export interface VisualPoint {
  x: number
  y: number
}

export interface VisualElement {
  id: string
  role: string
  text: string
  href: string | null
  intent: string | null
  source?: string
  box: VisualBox
  center: VisualPoint
}

export interface VisualScreenshot {
  id: string
  width: number
  height: number
}

export interface VisualState {
  sessionId: string
  step: number
  url: string
  title: string
  sourceType: SourceType
  observedAt: string
  screenshot: VisualScreenshot
  visibleText: string
  elements: VisualElement[]
  signals: string[]
  evidence: EvidenceItem[]
  extracted: JsonRecord
}

export type VisualAction
  = | {
    type: 'click'
    elementId: string
    point: VisualPoint
    target: {
      role: string
      text: string
      href: string | null
      intent: string | null
    }
    reason?: string | null
    expectedChange?: string | null
  }
  | {
    type: 'type'
    text: string
    reason?: string | null
    expectedChange?: string | null
  }
  | {
    type: 'press' | 'scroll' | 'wait' | 'capture_screenshot'
    [key: string]: unknown
  }
  | {
    type: 'stop'
    reason?: string
  }

export interface ActionProgress {
  changed: boolean
  reason: string
}

export interface VisualActionHistoryItem {
  before: VisualState
  action: VisualAction
  after: VisualState
  progress: ActionProgress
}

export interface ComputerUseAdapter {
  observe: () => Promise<unknown> | unknown
  act: (action: VisualAction) => Promise<unknown> | unknown
}

export interface PageObservation {
  sessionId: string
  url: string
  title: string
  sourceType: SourceType
  observedAt: string
  evidence: EvidenceItem[]
  extracted: JsonRecord & {
    candidateType?: CandidateType
    target?: TargetInput
    opportunity?: OpportunityInput
    id?: string
  }
}

export interface CandidateClassification {
  candidateType: CandidateType
  candidateId: string | null
  sourceType: SourceType
  reason: string
}

export interface RubricDimension {
  id: string
  label: string
  weight: number
  min: number
  max: number
  description?: string
  levels?: Record<string, string>
}

export interface DecisionThreshold {
  decision: string
  label?: string
  minScore: number
  action?: string
}

export interface Rubric {
  version?: string
  maxScore: number
  dimensions: RubricDimension[]
  decisionThresholds: DecisionThreshold[]
  hardBlockers: string[]
}

export interface ScoreContribution {
  id: string
  label: string
  value: number
  weight: number
  points: number
}

export type EvidenceCoverageStatus = 'confirmed' | 'partial' | 'unknown' | 'blocked'
export type ResearchConfidence = 'high' | 'medium' | 'low'

export interface EvidenceCoverageItem {
  dimensionId: string
  status: EvidenceCoverageStatus
  sourceCount: number
  note: string
}

export interface TargetResearchQuality {
  sourceCount: number
  sourceTypes: string[]
  evidenceCoverage: EvidenceCoverageItem[]
  confidence?: ResearchConfidence
  stopReason?: string | null
}

export interface TargetResearchQualityAssessment extends TargetResearchQuality {
  confidence: ResearchConfidence
  coverageSummary: {
    confirmedDimensions: number
    partialDimensions: number
    unknownDimensions: number
    blockedDimensions: number
    criticalGaps: string[]
  }
  decisionCap: string | null
  missingInfo: string[]
}

export interface OpportunityInput {
  id: string
  title: string
  company: string
  scores: Record<string, number>
  evidence?: string[]
  riskFlags?: string[]
  missingInfo?: string[]
}

export interface ScoredOpportunity extends Omit<OpportunityInput, 'scores'> {
  total: number
  decision: string
  hardBlockers: string[]
  contributions: ScoreContribution[]
  riskFlags: string[]
  missingInfo: string[]
}

export interface TargetInput {
  id: string
  name: string
  category: string
  scores: Record<string, number>
  evidence?: string[]
  riskFlags?: string[]
  missingInfo?: string[]
  nextAction?: string | null
  researchQuality?: TargetResearchQuality
}

export interface ScoredTarget extends Omit<TargetInput, 'scores'> {
  total: number
  decision: string
  hardBlockers: string[]
  contributions: ScoreContribution[]
  riskFlags: string[]
  missingInfo: string[]
  nextAction: string | null
  researchQuality: TargetResearchQualityAssessment
}

export interface ReviewQueueItem {
  recordType: 'review_queue_item'
  schemaVersion: string
  id: string
  sessionId: string
  candidateType: CandidateType
  candidateId: string
  privateRecordType: string
  score: number
  decision: string
  source: {
    url: string
    title: string
    sourceType: SourceType
    observedAt: string
  }
  evidence: EvidenceItem[]
  missingInfo: string[]
  riskFlags: string[]
  nextAction: string | null
}

export interface ModelAdapter {
  generateJson: (request: JsonRecord) => Promise<unknown> | unknown
}
