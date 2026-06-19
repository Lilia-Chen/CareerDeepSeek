import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('endSpan rewrites a complete ended span record', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', 'parent_1', 'test_span')
    store.endSpan('span_1', 'ok', 'done')

    const lines = readFileSync(join(store.traceDir, 'spans.jsonl'), 'utf-8').trim().split('\n')
    assert.equal(lines.length, 1)

    const span = JSON.parse(lines[0]!)
    assert.equal(span.api_version, SPAN_API_VERSION)
    assert.equal(span.span_id, 'span_1')
    assert.equal(span.parent_span_id, 'parent_1')
    assert.equal(span.name, 'test_span')
    assert.equal(span.state, 'ended')
    assert.equal(span.status_code, 'ok')
    assert.equal(typeof span.started_at_millis, 'number')
    assert.equal(typeof span.finished_at_millis, 'number')
    assert.equal(span.summary, 'done')
  })

  it('endRun closes running spans', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'one')
    store.startSpan('span_2', undefined, 'two')
    store.endSpan('span_1', 'ok')
    store.endRun('run_1', 'error', 'failed')

    const spans = readFileSync(join(store.traceDir, 'spans.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))

    assert.equal(spans.length, 2)
    assert.equal(spans.every(span => span.state === 'ended'), true)
    assert.equal(spans.every(span => span.finished_at_millis !== undefined), true)
    assert.equal(spans[0].status_code, 'ok')
    assert.equal(spans[1].status_code, 'error')
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

  it('records staged artifacts in artifacts.jsonl', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    mkdirSync(join(testRoot, 'external'), { recursive: true })
    const externalPath = join(testRoot, 'external', 'screen.png')
    writeFileSync(externalPath, Buffer.from('89504e470d0a1a0a', 'hex'))

    store.recordArtifact({ artifact_id: 'art_1', span_id: 'span_1', role: 'screenshot', mime_type: 'image/png', path: externalPath, attributes: {} })

    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.role, 'screenshot')
    assert.equal(line.path, 'artifacts/art_1.png')
  })

  it('rejects artifact records whose source file cannot be staged', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')

    assert.throws(
      () => store.recordArtifact({ artifact_id: 'missing', span_id: 'span_1', role: 'screenshot', mime_type: 'image/png', path: join(testRoot, 'missing.png'), attributes: {} }),
      /Cannot stage missing trace artifact source/,
    )
    assert.equal(existsSync(join(store.traceDir, 'artifacts.jsonl')), false)
  })

  it('writeJsonArtifact stages JSON under artifacts with relative path', () => {
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

    assert.equal(record.path, 'artifacts/capture_contract_mco_1.json')
    const stagedPath = join(store.traceDir, record.path)
    assert.equal(existsSync(stagedPath), true)
    const payload = JSON.parse(readFileSync(stagedPath, 'utf-8'))
    assert.equal(payload.captureSource.kind, 'window')
    assert.equal(record.sha256, createHash('sha256').update(readFileSync(stagedPath)).digest('hex'))

    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.role, 'capture-contract')
    assert.equal(line.path, record.path)
    assert.deepEqual(JSON.parse(readFileSync(join(store.traceDir, line.path), 'utf-8')), payload)
  })

  it('recordArtifact stages external file under artifacts', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    mkdirSync(join(testRoot, 'external'), { recursive: true })
    const externalPath = join(testRoot, 'external', 'screen.png')
    writeFileSync(externalPath, Buffer.from('89504e470d0a1a0a', 'hex'))

    store.recordArtifact({
      artifact_id: 'screenshot_mco_1',
      span_id: 'span_1',
      role: 'screenshot',
      mime_type: 'image/png',
      path: externalPath,
      attributes: {},
    })

    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.path, 'artifacts/screenshot_mco_1.png')
    const stagedPath = join(store.traceDir, line.path)
    assert.equal(existsSync(stagedPath), true)
    assert.equal(readFileSync(stagedPath).toString('hex'), '89504e470d0a1a0a')
    assert.equal(line.sha256, createHash('sha256').update(readFileSync(stagedPath)).digest('hex'))
  })

  it('recordArtifact canonicalizes files already under artifacts without copying', () => {
    const store = new TraceStore(testRoot, 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    const existingDir = join(store.traceDir, 'artifacts', 'nested')
    mkdirSync(existingDir, { recursive: true })
    const existingPath = join(existingDir, 'existing.png')
    writeFileSync(existingPath, Buffer.from('89504e470d0a1a0a', 'hex'))

    store.recordArtifact({
      artifact_id: 'screenshot_mco_1',
      span_id: 'span_1',
      role: 'screenshot',
      mime_type: 'image/png',
      path: existingPath,
      attributes: {},
    })

    const line = JSON.parse(readFileSync(join(store.traceDir, 'artifacts.jsonl'), 'utf-8').trim())
    assert.equal(line.path, 'artifacts/nested/existing.png')
    assert.equal(existsSync(join(store.traceDir, 'artifacts', 'screenshot_mco_1.png')), false)
    assert.equal(readFileSync(join(store.traceDir, line.path)).toString('hex'), '89504e470d0a1a0a')
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
