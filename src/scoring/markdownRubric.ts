import type { Rubric, RubricDimension } from '../types.js'

type MarkdownRow = Record<string, string>
type ScoreLevels = Record<string, string>

export function parseRubricMarkdown(markdown: string): Rubric {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')

  const version = readInlineCodeValue(lines, 'Runtime version')
  const maxScore = Number(readInlineCodeValue(lines, 'Max score'))
  if (!Number.isFinite(maxScore)) {
    throw new TypeError('Rubric markdown must define a numeric Max score.')
  }

  const hardBlockers = parseHardBlockers(lines)
  const dimensions = parseDimensions(lines)
  const decisionThresholds = parseDecisionThresholds(lines)

  return {
    version,
    maxScore,
    dimensions,
    decisionThresholds,
    hardBlockers,
  }
}

function readInlineCodeValue(lines: string[], label: string): string {
  const prefix = `${label}:`
  const line = lines.find(item => item.startsWith(prefix))
  const match = line?.match(/`([^`]+)`/)
  if (!match) {
    throw new Error(`Rubric markdown must define ${label} as an inline code value.`)
  }
  return match[1]
}

function parseHardBlockers(lines: string[]): string[] {
  const section = readSection(lines, '## Hard Blockers')
  const blockers = section
    .map(line => line.match(/^- `([^`]+)`/))
    .filter(Boolean)
    .map(match => match?.[1])
    .filter((blocker): blocker is string => typeof blocker === 'string')

  if (blockers.length === 0) {
    throw new Error('Rubric markdown must define at least one hard blocker.')
  }
  return blockers
}

function parseDimensions(lines: string[]): RubricDimension[] {
  const dimensions: RubricDimension[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseDimensionHeading(lines[index])
    if (!heading) {
      continue
    }

    const { label, weight } = heading
    const body = readSectionFrom(lines, index + 1, 3)
    const runtimeId = readRuntimeId(body, label)
    const levels = parseScoreTable(body, label)
    const scores = Object.keys(levels).map(Number)

    dimensions.push({
      id: runtimeId,
      label,
      weight,
      min: Math.min(...scores),
      max: Math.max(...scores),
      description: levels['5'],
      levels,
    })
  }

  if (dimensions.length === 0) {
    throw new Error('Rubric markdown must define scoring dimensions.')
  }
  return dimensions
}

function parseDimensionHeading(line: string): { label: string, weight: number } | null {
  const prefix = line.match(/^### D\d+: /i)
  if (!prefix) {
    return null
  }

  const body = line.slice(prefix[0].length)
  const marker = body.includes('（weight ') ? '（weight ' : '(weight '
  const markerIndex = body.lastIndexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  const closing = marker.startsWith('（') ? '）' : ')'
  if (!body.endsWith(closing)) {
    return null
  }

  const label = body.slice(0, markerIndex).trim()
  const weightText = body.slice(markerIndex + marker.length, -closing.length)
  if (label === '' || !/^\d+$/.test(weightText)) {
    return null
  }

  return {
    label,
    weight: Number(weightText),
  }
}

function readRuntimeId(lines: string[], label: string): string {
  const line = lines.find(item => item.startsWith('Runtime ID:'))
  const match = line?.match(/`([^`]+)`/)
  if (!match) {
    throw new Error(`Dimension "${label}" must define a Runtime ID.`)
  }
  return match[1]
}

function parseScoreTable(lines: string[], label: string): ScoreLevels {
  const rows = parseMarkdownTable(lines, ['Score', 'Description'])
  const levels: ScoreLevels = {}

  for (const row of rows) {
    const score = row.Score
    if (!/^[0-5]$/.test(score)) {
      throw new Error(`Dimension "${label}" has invalid score "${score}".`)
    }
    levels[score] = row.Description
  }

  for (const required of ['0', '1', '2', '3', '4', '5']) {
    if (!(required in levels)) {
      throw new Error(`Dimension "${label}" is missing score ${required}.`)
    }
  }

  return levels
}

function parseDecisionThresholds(lines: string[]): Rubric['decisionThresholds'] {
  const section = readSection(lines, '## Decision Thresholds')
  const rows = parseMarkdownTable(section, ['Min Score', 'Decision ID', 'Label', 'Action'])

  if (rows.length === 0) {
    throw new Error('Rubric markdown must define decision thresholds.')
  }

  return rows.map(row => ({
    decision: row['Decision ID'],
    label: row.Label,
    minScore: Number(row['Min Score']),
    action: row.Action,
  }))
}

function readSection(lines: string[], heading: string): string[] {
  const index = lines.findIndex(line => line.trim() === heading)
  if (index === -1) {
    throw new Error(`Rubric markdown must define section "${heading}".`)
  }
  return readSectionFrom(lines, index + 1, 2)
}

function readSectionFrom(lines: string[], startIndex: number, headingLevel: number): string[] {
  const nextHeading = '#'.repeat(headingLevel)
  const section: string[] = []

  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].startsWith(`${nextHeading} `)) {
      break
    }
    section.push(lines[index])
  }

  return section
}

function parseMarkdownTable(lines: string[], expectedHeaders: string[]): MarkdownRow[] {
  const headerIndex = lines.findIndex((line) => {
    if (!line.trim().startsWith('|')) {
      return false
    }
    const cells = splitTableRow(line)
    return expectedHeaders.every((header, index) => cells[index] === header)
  })

  if (headerIndex === -1) {
    return []
  }

  const rows: MarkdownRow[] = []
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('|')) {
      break
    }

    const cells = splitTableRow(line)
    const row: MarkdownRow = {}
    expectedHeaders.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] ?? ''
    })
    rows.push(row)
  }

  return rows
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}
