import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TraceStore } from '../../src/computer-use/macos-chrome-driver/trace-store.js'
import { ARTIFACT_API_VERSION, EVENT_API_VERSION, RUN_API_VERSION, SPAN_API_VERSION } from '../../src/computer-use/macos-chrome-driver/types.js'

const testRoot = join('.computer-use', `trace-store-test-${process.pid}`)
const testDir = join(testRoot, 'traces', 'trace-store-test')

describe('traceStore', () => {
  afterEach(() => {
    if (existsSync(testDir))
      rmSync(testDir, { recursive: true, force: true })
  })

  it('creates trace directory on construction', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    assert.equal(existsSync(store.traceDir), true)
  })

  it('writes run.json on startRun', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', { intent: 'test' })
    const run = JSON.parse(readFileSync(join(store.traceDir, 'run.json'), 'utf-8'))
    assert.equal(run.api_version, RUN_API_VERSION)
    assert.equal(run.run_id, 'run_1')
    assert.equal(run.state, 'running')
  })

  it('appends to spans.jsonl on startSpan', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test_span')
    const lines = readFileSync(join(store.traceDir, 'spans.jsonl'), 'utf-8').trim().split('\n')
    assert.equal(lines.length, 1)
    const span = JSON.parse(lines[0]!)
    assert.equal(span.api_version, SPAN_API_VERSION)
    assert.equal(span.name, 'test_span')
  })

  it('appends to events.jsonl on recordEvent', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    store.recordEvent({ event_id: 'evt_1', span_id: 'span_1', name: 'capture_completed', timestamp_millis: Date.now(), attributes: {}, artifact_ids: ['art_1'] })
    const line = JSON.parse(readFileSync(join(store.traceDir, 'events.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, EVENT_API_VERSION)
    assert.equal(line.name, 'capture_completed')
  })

  it('appends to artifacts.jsonl on recordArtifact', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    store.recordArtifact({ artifact_id: 'art_1', span_id: 'span_1', role: 'screenshot', mime_type: 'image/png', path: '/tmp/screen.png', attributes: {} })
    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.role, 'screenshot')
  })

  it('writes JSON artifact payload and records a parseable artifact path', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')

    const record = store.writeJsonArtifact({
      artifact_id: 'capture_contract_mco_1',
      span_id: 'span_1',
      role: 'capture-contract',
      payload: {
        coordinateContractVersion: 1,
        captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123 },
      },
      attributes: { coordinate_contract_version: 1 },
    })

    assert.equal(existsSync(record.path), true)
    const payload = JSON.parse(readFileSync(record.path, 'utf-8'))
    assert.equal(payload.captureSource.kind, 'window')

    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.role, 'capture-contract')
    assert.equal(line.path, record.path)
    assert.deepEqual(JSON.parse(readFileSync(line.path, 'utf-8')), payload)
  })

  it('updates run.json on endRun', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.endRun('run_1', 'ok', 'completed')
    const run = JSON.parse(readFileSync(join(store.traceDir, 'run.json'), 'utf-8'))
    assert.equal(run.status_code, 'ok')
    assert.equal(run.summary, 'completed')
    assert.ok(run.finished_at_millis !== undefined)
  })
})
