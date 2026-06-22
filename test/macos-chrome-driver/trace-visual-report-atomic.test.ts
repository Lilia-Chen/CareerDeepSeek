import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateVisualTraceReport } from '../../src/computer-use/macos-chrome-driver/trace-visual-report.js'

describe('visual trace report atomic artifacts', () => {
  it('summarizes atomic OCR and action-result artifacts', () => {
    const traceDir = mkdtempSync(join(tmpdir(), 'cds-atomic-trace-'))
    writeFileSync(join(traceDir, 'run.json'), JSON.stringify({
      run_id: 'run_atomic',
      trace_id: 'trace_atomic',
      root_span_id: 'session',
    }))
    writeFileSync(join(traceDir, 'spans.jsonl'), '')
    writeFileSync(join(traceDir, 'events.jsonl'), '')
    writeFileSync(join(traceDir, 'ocr.json'), `${JSON.stringify({
      matches: [{
        text: 'LangChain',
        confidence: 0.94,
        bounds: { x: 10, y: 20, width: 30, height: 12 },
      }],
      knownLimits: ['ocr_limit'],
    })}\n`)
    writeFileSync(join(traceDir, 'action.json'), `${JSON.stringify({
      query: 'LangChain',
      clicked: {
        kind: 'ocr_text',
        text: 'LangChain',
        box: { x: 110, y: 220, width: 15, height: 6 },
        logicalPoint: { x: 117.5, y: 223 },
      },
      knownLimits: ['action_limit'],
    })}\n`)
    writeFileSync(join(traceDir, 'scroll-action.json'), `${JSON.stringify({
      direction: 'down',
      amount: 2,
      logical_point: { x: 500, y: 500 },
      scroll_boundary_before: {
        scrollTop: 0,
        canScrollDown: true,
        knownLimits: ['before_limit'],
      },
      scroll_boundary_after: {
        scrollTop: 300,
        canScrollDown: true,
        knownLimits: ['after_limit'],
      },
      scroll_progress: {
        changed: true,
        boundaryReached: false,
        knownLimits: ['progress_limit'],
      },
      knownLimits: ['scroll_limit'],
    })}\n`)
    writeFileSync(join(traceDir, 'artifacts.jsonl'), [
      JSON.stringify({
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'ocr_text_atomic_1',
        span_id: 'atomic_1_find_text',
        role: 'ocr-text',
        mime_type: 'application/json',
        path: 'ocr.json',
        attributes: {},
      }),
      JSON.stringify({
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'action_click_target_atomic_2',
        span_id: 'atomic_2_click_text',
        role: 'action-result',
        mime_type: 'application/json',
        path: 'action.json',
        attributes: {},
      }),
      JSON.stringify({
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'action_scroll_region_atomic_3',
        span_id: 'atomic_3_scroll_region',
        role: 'action-result',
        mime_type: 'application/json',
        path: 'scroll-action.json',
        attributes: {},
      }),
    ].join('\n'))

    const result = generateVisualTraceReport({ traceDir })
    const report = JSON.parse(readFileSync(result.jsonPath, 'utf-8')) as {
      recognitions: Array<{ bestText?: string, knownLimits: string[] }>
      actions: Array<{
        actionType?: string
        clickPoint?: { x: number, y: number }
        scrollProgress?: { changed?: boolean, boundaryReached?: boolean }
        knownLimits: string[]
      }>
      summary: { action_count: number, known_limit_count: number }
    }

    expect(report.recognitions).toHaveLength(1)
    expect(report.recognitions[0]).toMatchObject({
      bestText: 'LangChain',
      knownLimits: ['ocr_limit'],
    })
    expect(report.actions).toHaveLength(2)
    expect(report.actions[0]).toMatchObject({
      actionType: 'clickTarget',
      clickPoint: { x: 117.5, y: 223 },
      knownLimits: ['action_limit'],
    })
    expect(report.actions[1]).toMatchObject({
      actionType: 'scrollRegion',
      clickPoint: { x: 500, y: 500 },
      scrollProgress: { changed: true, boundaryReached: false },
      knownLimits: ['scroll_limit', 'progress_limit', 'before_limit', 'after_limit'],
    })
    expect(report.summary.action_count).toBe(2)
    expect(report.summary.known_limit_count).toBe(6)
  })
})
