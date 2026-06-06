import { createDeepSeekModelAdapter } from './deepseekModelAdapter.js'
import type { JsonRecord, ModelAdapter } from '../types.js'

const SMOKE_ID = 'careerdeepseek-llm-smoke'
const PROVIDER = 'deepseek'
const MODEL = 'deepseek-v4-pro'

export interface LlmSmokeResult {
  ok: true
  provider: typeof PROVIDER
  model: typeof MODEL
  smokeId: typeof SMOKE_ID
  response: JsonRecord
}

export async function runLlmSmoke({
  model = createDeepSeekModelAdapter(),
}: {
  model?: ModelAdapter
} = {}): Promise<LlmSmokeResult> {
  const response = await model.generateJson({
    task: 'llm_smoke_test',
    instructions:
      'Return JSON only. Return exactly these fields and values: ok true, provider deepseek, model deepseek-v4-pro, smokeId careerdeepseek-llm-smoke.',
    requiredOutput: {
      ok: true,
      provider: PROVIDER,
      model: MODEL,
      smokeId: SMOKE_ID,
    },
  })

  assertSmokeResponse(response)

  return {
    ok: true,
    provider: PROVIDER,
    model: MODEL,
    smokeId: SMOKE_ID,
    response,
  }
}

function assertSmokeResponse(value: unknown): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Smoke response must be a JSON object.')
  }

  const response = value as JsonRecord
  assertField(response, 'ok', true)
  assertField(response, 'provider', PROVIDER)
  assertField(response, 'model', MODEL)
  assertField(response, 'smokeId', SMOKE_ID)
}

function assertField(response: JsonRecord, key: string, expected: unknown): void {
  if (response[key] !== expected) {
    throw new Error(`Smoke response field ${key} must equal ${String(expected)}.`)
  }
}
