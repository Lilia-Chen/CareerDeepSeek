# ADR-002: Use Vercel AI SDK for DeepSeek LLM Capability

## Status

Accepted

## Date

2026-05-31

## Context

CareerDeepSeek already has an internal `ModelAdapter` contract:

```txt
generateJson(request) -> object
```

The workflow uses this contract for visual action planning and page evidence extraction. The repository now needs a real DeepSeek V4 Pro capability while keeping provider details out of the workflow layer and keeping API keys out of committed files.

DeepSeek documents OpenAI-compatible API access through `https://api.deepseek.com`, model `deepseek-v4-pro`, thinking mode, reasoning effort, and JSON output. Vercel AI SDK provides a first-party DeepSeek provider and structured JSON output support.

## Decision

Use Vercel AI SDK packages `ai` and `@ai-sdk/deepseek` for the real LLM capability layer.

Add `src/llm/deepseekModelAdapter.ts` as the provider-specific adapter. It maps the Vercel AI SDK DeepSeek provider to the existing `generateJson(request)` contract and defaults to:

- `DEEPSEEK_API_KEY`
- `https://api.deepseek.com`
- `deepseek-v4-pro`
- thinking mode enabled
- reasoning effort high
- JSON output

## Alternatives Considered

### OpenAI SDK

Pros:
- DeepSeek official quick-start examples use OpenAI-compatible SDK calls.
- DeepSeek-specific request fields can be sent close to the raw API shape.

Cons:
- It keeps the implementation closer to one provider's transport instead of a broader agent-oriented SDK.
- It does not add a higher-level model abstraction for later provider or structured-output work.

Rejected for now because CareerDeepSeek needs an extensible LLM capability layer, not only a raw-compatible client.

### xsAI

Pros:
- Small OpenAI-compatible SDK surface.
- Good fit for lightweight CLI usage.

Cons:
- Current npm package is beta.
- The project is likely to need agent, structured output, tool, and provider abstractions where Vercel AI SDK is stronger.

Rejected for now because the dependency risk is higher and the abstraction is narrower.

## Consequences

- Workflow code continues to depend on `ModelAdapter`, not Vercel AI SDK types.
- DeepSeek API keys stay in local environment variables or ignored `.env` files.
- Tests use dependency injection instead of calling the real API.
- Future provider changes should be isolated to LLM adapter modules.
