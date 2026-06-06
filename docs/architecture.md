# Architecture

CareerDeepSeek starts as a local-first eval and workflow repository, then adds bounded visible-browser discovery sessions for automated job and target search.

## Components

- Opportunity scoring rubric: `docs/scoring-rubric.md` is the canonical human-edited rubric for specific job opportunities.
- Target hunting rubric: `docs/target-rubric.md` is the canonical human-edited rubric for company or team targets before a specific role exists.
- Runtime rubric artifacts: `config/scoring-rubric.json` and `config/target-rubric.json` are generated from the Markdown rubrics.
- Scoring engines: deterministic scoring from structured opportunity or target signals and the generated runtime rubrics.
- Browser observation core: read-only DOM-visible observation, ARIA/HTML semantic approximation, viewport boxes, occlusion checks, screenshot metadata, and optional CDP debug corroboration.
- Visual-action automation core: screenshot-backed visual state, coordinate-grounded action space, action policy, progress verification, mock computer-use adapter, browser-use debug adapter, and session runner.
- LLM decision layer: structured JSON model contract, DeepSeek V4 Pro adapter through Vercel AI SDK, visual action planner, evidence extractor, and end-to-end discovery workflow.
- Browser session policy: bounded visible-browser automation rules for search, navigation, evidence extraction, stop conditions, and private writes.
- Collection workflow core: session validation, browser action contract checks, page observation normalization, candidate classification, review item building, and private review queue writes.
- Browser discovery runner: default low-footprint observer extension for current-tab read-only observation. Playwright and CDP are explicit debug/high-fidelity modes, not the default browser observation layer.
- Page observation and evidence extraction: structured conversion of visible page content into short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Candidate classifier: classifies pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Review queue writer: writes ranked findings requiring human approval to the private data root.
- Synthetic evals: public fixtures that test decision thresholds and risk handling.
- OpenCode configuration: project agents and commands for planning, scoring, and review.
- Policy docs: browser-use and privacy constraints that every agent must follow.
- Private data root: repo-external directory for real CRM data and evidence.

## Data flow

```txt
docs/scoring-rubric.md
  -> npm run generate:rubric
  -> config/scoring-rubric.json

docs/target-rubric.md
  -> npm run generate:target-rubric
  -> config/target-rubric.json

synthetic fixture or user-provided opportunity
  -> structured scoring inputs
  -> scoring engine
  -> decision and evidence summary
  -> eval comparison or private CRM write

target company/team JSON
  -> structured target signals
  -> target scoring engine
  -> decision, evidence summary, and next action
  -> optional private target record under CAREERDEEPSEEK_DATA_DIR/targets

bounded visible-browser discovery session
  -> read-only browser observation
  -> DOM-visible + ARIA/HTML semantic approximation
  -> screenshot corroboration
  -> optional CDP debug corroboration
  -> page observation
  -> LLM evidence extraction
  -> target/opportunity classification
  -> scoring
  -> private CRM record and review queue write
```

Real opportunity records must be written only to `CAREERDEEPSEEK_DATA_DIR`.

## First implementation boundary

The committed first version proves the opportunity scoring contract, target-level company/team scoring contract, private data boundary, and eval loop on synthetic offline data.

The current implementation boundary now separates default observation from action-capable automation. Default browser observation lives in `src/observation/` and `extensions/careerdeepseek-observer/`. It returns DOM-visible elements, ARIA/HTML-derived semantic approximation, viewport boxes, `elementFromPoint` occlusion checks, and screenshot metadata. It does not claim native accessibility tree access.

Native AX tree and DOMSnapshot access are available only through the CDP debug observer. The debug observer allowlist is `Accessibility.getFullAXTree`, `DOMSnapshot.captureSnapshot`, and `Page.captureScreenshot`. The Playwright-backed browser-use adapter remains useful for explicit debug/automation experiments, but it is not the default browser observation layer.

The current LLM capability layer includes `src/llm/deepseekModelAdapter.ts`, which adapts the Vercel AI SDK DeepSeek provider to the internal `generateJson(request)` contract. It defaults to `deepseek-v4-pro`, `https://api.deepseek.com`, thinking mode enabled, reasoning effort high, and JSON output.

The next boundary is wiring read-only observation outputs into the discovery workflow before reintroducing any action-capable browser automation. It must not use raw HTTP scraping, hidden APIs, CAPTCHA bypass, proxy rotation, headless bulk collection, auto-apply, auto-send behavior, or OS-level desktop control. Databases and LLM-driven self-modification remain out of scope until supervised browser runs are implemented and tested.
