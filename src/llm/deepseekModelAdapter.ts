import { existsSync } from 'node:fs'
import process, { loadEnvFile } from 'node:process'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { Output, generateText as aiGenerateText } from 'ai'
import type { DeepSeekLanguageModelOptions, DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import type { LanguageModel } from 'ai'
import type { JsonRecord, ModelAdapter } from '../types.js'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-pro'
const DEFAULT_THINKING_TYPE = 'enabled'
const DEFAULT_REASONING_EFFORT = 'high'
const DEFAULT_ENV_FILE_PATH = '.env'

const SYSTEM_PROMPT = [
  'You are the JSON model capability for CareerDeepSeek.',
  'Return only valid JSON with no markdown fences, prose, or commentary.',
  'Use only facts and instructions provided in the request payload.',
].join(' ')

type DeepSeekThinkingType = NonNullable<NonNullable<DeepSeekLanguageModelOptions['thinking']>['type']>
type DeepSeekReasoningEffort = NonNullable<DeepSeekLanguageModelOptions['reasoningEffort']>

export interface DeepSeekModelConfig {
  apiKey: string
  baseURL: string
  model: string
  thinking: {
    type: DeepSeekThinkingType
  }
  reasoningEffort: DeepSeekReasoningEffort
}

interface DeepSeekModelConfigOverrides {
  apiKey?: string
  baseURL?: string
  model?: string
  thinking?: {
    type?: DeepSeekThinkingType
  }
  reasoningEffort?: DeepSeekReasoningEffort
}

export type DeepSeekProviderFactory = (
  settings: Required<Pick<DeepSeekProviderSettings, 'apiKey' | 'baseURL'>>,
) => (modelId: string) => unknown

export interface GenerateTextJsonOptions {
  model: unknown
  output: unknown
  system: string
  prompt: string
  temperature: number
  providerOptions: {
    deepseek: DeepSeekLanguageModelOptions
  }
}

export type GenerateTextJson = (options: GenerateTextJsonOptions) => Promise<{ output: unknown }>

export interface CreateDeepSeekModelAdapterOptions extends DeepSeekModelConfigOverrides {
  env?: NodeJS.ProcessEnv
  envFilePath?: string
  createDeepSeekProvider?: DeepSeekProviderFactory
  generateText?: GenerateTextJson
}

export function resolveDeepSeekModelConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: DeepSeekModelConfigOverrides = {},
): DeepSeekModelConfig {
  const apiKey = textOrUndefined(overrides.apiKey) ?? textOrUndefined(env.DEEPSEEK_API_KEY)
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY must be set before creating the DeepSeek model adapter.')
  }

  return {
    apiKey,
    baseURL: textOrUndefined(overrides.baseURL) ?? DEFAULT_BASE_URL,
    model: textOrUndefined(overrides.model) ?? DEFAULT_MODEL,
    thinking: {
      type: overrides.thinking?.type ?? DEFAULT_THINKING_TYPE,
    },
    reasoningEffort: overrides.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  }
}

const defaultCreateDeepSeekProvider: DeepSeekProviderFactory = settings => createDeepSeek(settings)

const defaultGenerateText: GenerateTextJson = async (options) => {
  const result = await aiGenerateText({
    ...options,
    model: options.model as LanguageModel,
    output: options.output as ReturnType<typeof Output.json>,
  })

  return {
    output: result.output,
  }
}

export function createDeepSeekModelAdapter(options: CreateDeepSeekModelAdapterOptions = {}): ModelAdapter {
  if (!options.env) {
    loadEnvFileIfPresent(options.envFilePath ?? DEFAULT_ENV_FILE_PATH)
  }

  const config = resolveDeepSeekModelConfig(options.env, options)
  const createProvider = options.createDeepSeekProvider ?? defaultCreateDeepSeekProvider
  const generateText = options.generateText ?? defaultGenerateText
  const provider = createProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
  const model = provider(config.model)

  return {
    async generateJson(request: JsonRecord): Promise<unknown> {
      const result = await generateText({
        model,
        output: Output.json(),
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify(request, null, 2),
        temperature: 0,
        providerOptions: {
          deepseek: {
            reasoningEffort: config.reasoningEffort,
            thinking: config.thinking,
          },
        },
      })

      if (!isJsonRecord(result.output)) {
        throw new TypeError('DeepSeek JSON output must be an object.')
      }

      return result.output
    },
  }
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function loadEnvFileIfPresent(path: string): void {
  if (existsSync(path)) {
    loadEnvFile(path)
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
