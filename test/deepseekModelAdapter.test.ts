import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import {
  createDeepSeekModelAdapter,
  resolveDeepSeekModelConfig,
} from '../src/llm/deepseekModelAdapter.js'
import type { GenerateTextJsonOptions } from '../src/llm/deepseekModelAdapter.js'
import type { JsonRecord } from '../src/types.js'

it('resolves DeepSeek V4 Pro defaults from environment without exposing secrets', () => {
  const config = resolveDeepSeekModelConfig({
    DEEPSEEK_API_KEY: 'test-secret-key',
  })

  assert.equal(config.apiKey, 'test-secret-key')
  assert.equal(config.baseURL, 'https://api.deepseek.com')
  assert.equal(config.model, 'deepseek-v4-pro')
  assert.equal(config.thinking.type, 'enabled')
  assert.equal(config.reasoningEffort, 'high')
})

it('requires a DeepSeek API key before creating the provider', () => {
  assert.throws(
    () => resolveDeepSeekModelConfig({}),
    /DEEPSEEK_API_KEY must be set/,
  )
})

it('loads a local env file before resolving the DeepSeek API key', async () => {
  const originalApiKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY

  const envFilePath = join(tmpdir(), `careerdeepseek-env-${crypto.randomUUID()}`)
  await writeFile(envFilePath, 'DEEPSEEK_API_KEY=env-file-secret\n', 'utf8')

  try {
    const adapter = createDeepSeekModelAdapter({
      envFilePath,
      createDeepSeekProvider: (settings) => {
        assert.equal(settings.apiKey, 'env-file-secret')
        return () => ({ provider: 'deepseek' })
      },
      generateText: async () => ({
        output: {
          ok: true,
        },
      }),
    })

    assert.deepEqual(await adapter.generateJson({ task: 'env_file' }), { ok: true })
  }
  finally {
    if (originalApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    }
    else {
      process.env.DEEPSEEK_API_KEY = originalApiKey
    }
  }
})

it('generates arbitrary JSON through the Vercel AI SDK DeepSeek provider', async () => {
  const providerCalls: JsonRecord[] = []
  const generateCalls: GenerateTextJsonOptions[] = []
  const model = { provider: 'deepseek', model: 'deepseek-v4-pro' }

  const adapter = createDeepSeekModelAdapter({
    env: {
      DEEPSEEK_API_KEY: 'test-secret-key',
    },
    createDeepSeekProvider: (settings) => {
      providerCalls.push(settings)
      return (modelId) => {
        providerCalls.push({ modelId })
        return model
      }
    },
    generateText: async (options) => {
      generateCalls.push(options)
      return {
        output: {
          ok: true,
          task: 'plan_visual_action',
        },
      }
    },
  })

  const output = await adapter.generateJson({
    task: 'plan_visual_action',
    state: {
      url: 'https://search.example',
    },
  })

  assert.deepEqual(output, {
    ok: true,
    task: 'plan_visual_action',
  })
  assert.deepEqual(providerCalls, [
    {
      apiKey: 'test-secret-key',
      baseURL: 'https://api.deepseek.com',
    },
    {
      modelId: 'deepseek-v4-pro',
    },
  ])

  const request = generateCalls[0]
  assert.ok(request)
  assert.equal(request.model, model)
  assert.equal(request.temperature, 0)
  assert.deepEqual(request.providerOptions, {
    deepseek: {
      reasoningEffort: 'high',
      thinking: {
        type: 'enabled',
      },
    },
  })
  assert.match(String(request.system), /Return only valid JSON/)
  assert.match(String(request.prompt), /plan_visual_action/)
})

it('rejects JSON mode output that is not an object', async () => {
  const adapter = createDeepSeekModelAdapter({
    env: {
      DEEPSEEK_API_KEY: 'test-secret-key',
    },
    createDeepSeekProvider: () => () => ({ provider: 'deepseek' }),
    generateText: async () => ({
      output: ['not', 'an', 'object'],
    }),
  })

  await assert.rejects(
    async () => {
      await adapter.generateJson({ task: 'extract_page_observation' })
    },
    /DeepSeek JSON output must be an object/,
  )
})
