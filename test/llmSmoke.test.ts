import assert from 'node:assert/strict'
import { it } from 'vitest'
import { runLlmSmoke } from '../src/llm/llmSmoke.js'
import type { JsonRecord, ModelAdapter } from '../src/types.js'

interface CapturingModel extends ModelAdapter {
  calls: JsonRecord[]
}

function createCapturingModel(output: unknown): CapturingModel {
  return {
    calls: [],
    async generateJson(request: JsonRecord): Promise<unknown> {
      this.calls.push(request)
      return output
    },
  }
}

it('runs a fixed DeepSeek JSON smoke request through the model adapter', async () => {
  const model = createCapturingModel({
    ok: true,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    smokeId: 'careerdeepseek-llm-smoke',
  })

  const result = await runLlmSmoke({ model })

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'deepseek')
  assert.equal(result.model, 'deepseek-v4-pro')
  assert.equal(result.smokeId, 'careerdeepseek-llm-smoke')
  assert.deepEqual(result.response, {
    ok: true,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    smokeId: 'careerdeepseek-llm-smoke',
  })

  const request = model.calls[0]
  assert.ok(request)
  assert.equal(request.task, 'llm_smoke_test')
  assert.match(String(request.instructions), /Return JSON/)
  assert.deepEqual(request.requiredOutput, {
    ok: true,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    smokeId: 'careerdeepseek-llm-smoke',
  })
})

it('fails the smoke check when the model does not return the expected JSON object', async () => {
  const model = createCapturingModel({
    ok: true,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
  })

  await assert.rejects(
    async () => {
      await runLlmSmoke({ model })
    },
    /Smoke response field smokeId must equal careerdeepseek-llm-smoke/,
  )
})
