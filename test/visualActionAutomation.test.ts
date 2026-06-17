import { it } from 'vitest'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { normalizePageObservation } from '../src/collection/pageObservation.js'
import { normalizeVisualState } from '../src/automation/visualState.js'
import { visualStateToPageObservation } from '../src/automation/visualObservation.js'

const searchState = {
  sessionId: 'visual-agent-discovery',
  step: 0,
  url: 'https://search.example/search?q=agent+infrastructure+hiring',
  title: 'Search results',
  sourceType: 'search_engine',
  observedAt: '2026-05-21T11:00:00.000Z',
  screenshot: {
    id: 'shot-search',
    width: 1440,
    height: 900,
  },
  visibleText: 'Synthetic Agent Lab - Careers. Building agent runtime observability.',
  elements: [
    {
      id: 'result-synthetic-agent-lab',
      role: 'link',
      text: 'Synthetic Agent Lab Careers',
      href: 'https://synthetic-agent-lab.example/careers',
      box: {
        x: 160,
        y: 220,
        width: 420,
        height: 36,
      },
    },
  ],
  signals: [],
}

const companyState = {
  sessionId: 'visual-agent-discovery',
  step: 1,
  url: 'https://synthetic-agent-lab.example/careers',
  title: 'Synthetic Agent Lab Careers',
  sourceType: 'company_site',
  observedAt: '2026-05-21T11:00:05.000Z',
  screenshot: {
    id: 'shot-company-careers',
    width: 1440,
    height: 900,
  },
  visibleText: 'Synthetic Agent Lab builds agent runtime observability and is hiring engineers.',
  elements: [
    {
      id: 'engineering-role',
      role: 'link',
      text: 'AI Infrastructure Engineer',
      href: 'https://synthetic-agent-lab.example/careers/ai-infra-engineer',
      box: {
        x: 220,
        y: 360,
        width: 360,
        height: 32,
      },
    },
  ],
  signals: [],
  evidence: [
    {
      label: 'domain_alignment',
      text: 'Builds agent runtime observability.',
      sourceUrl: 'https://synthetic-agent-lab.example/careers',
    },
  ],
  extracted: {
    candidateType: 'target_company',
    target: {
      id: 'synthetic-agent-lab',
    },
  },
}

it('keeps retired P1 visual automation and public catalog paths out of runtime source', async () => {
  const retiredFiles = [
    'src/automation/actionSpace.ts',
    'src/automation/actionPolicy.ts',
    'src/automation/sessionRunner.ts',
    'src/automation/mockComputerUseAdapter.ts',
    'src/automation/progressVerifier.ts',
    'src/llm/visualActionPlanner.ts',
    'src/collection/toolContract.ts',
  ]

  const existingRetiredFiles = await Promise.all(retiredFiles.map(async (file) => {
    try {
      await stat(new URL(`../${file}`, import.meta.url))
      return file
    }
    catch {
      return null
    }
  }))

  assert.deepEqual(existingRetiredFiles.filter(Boolean), [])

  const sourceFiles = await sourceFilePaths(new URL('../src/', import.meta.url))
  const sources = await Promise.all(
    sourceFiles.map(async file => ({
      file,
      source: await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
    })),
  )

  const forbiddenChecks: Array<[string, (source: string) => boolean]> = [
    ['ComputerUseAdapter.act', source => source.includes('interface ComputerUseAdapter') && /\bact\s*:/.test(source)],
    ['runVisualActionSession', source => /\brunVisualActionSession\b/.test(source)],
    ['VISUAL_ACTION_TYPES', source => /\bVISUAL_ACTION_TYPES\b/.test(source)],
    ['allowedActionTypes', source => /\ballowedActionTypes\b/.test(source)],
    ['ALLOWED_BROWSER_ACTIONS', source => /\bALLOWED_BROWSER_ACTIONS\b/.test(source)],
    ['createClickAction with point', source => source.includes('function createClickAction') && /\bpoint\s*:/.test(source)],
    ['VisualAction click point', source => source.includes('type VisualAction') && source.includes('type: \'click\'') && /\bpoint\s*:/.test(source)],
  ]

  const hits = sources.flatMap(({ file, source }) =>
    forbiddenChecks
      .filter(([, check]) => check(source))
      .map(([name]) => `${file}: ${name}`),
  )

  assert.deepEqual(hits, [])
})

async function sourceFilePaths(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory())
      return sourceFilePaths(url)
    if (entry.isFile() && entry.name.endsWith('.ts'))
      return [`src/${url.pathname.slice(new URL('../src/', import.meta.url).pathname.length)}`]
    return []
  }))
  return files.flat()
}

it('normalizes visual state with screenshot and coordinate-grounded elements', () => {
  const state = normalizeVisualState(searchState)

  assert.equal(state.screenshot.id, 'shot-search')
  assert.equal(state.elements[0].center.x, 370)
  assert.equal(state.elements[0].center.y, 238)

  assert.throws(
    () =>
      normalizeVisualState({
        ...searchState,
        screenshot: null,
      }),
    /screenshot/,
  )
})

it('converts a visual state into a collection page observation without raw visible text', () => {
  const visualState = normalizeVisualState(companyState)
  const observation = normalizePageObservation(visualStateToPageObservation(visualState))

  assert.equal(observation.url, 'https://synthetic-agent-lab.example/careers')
  assert.equal(observation.sourceType, 'company_site')
  assert.equal(observation.evidence.length, 1)
  assert.equal(observation.extracted.candidateType, 'target_company')
  assert.equal(JSON.stringify(observation).includes(companyState.visibleText), false)
})
