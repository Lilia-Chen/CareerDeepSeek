import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

type Namespace = 'observe' | 'verify' | 'prepare' | 'action' | 'test'
type DisturbanceClass = 'none' | 'focus' | 'foreground_app' | 'keyboard' | 'pointer'

interface CommandSpecLike {
  id: string
  summary: string
  namespace: Namespace
  driverId: 'macos.chrome'
  operation: string
  mutatesPage: boolean
  deliversInput: boolean
  mayActivateChrome: boolean
  disturbanceClasses: readonly DisturbanceClass[]
  maxDisturbance: DisturbanceClass
}

interface InvokeResultLike {
  commandId: string
  status: 'completed' | 'failed' | 'refused'
  summary: string
  output?: unknown
  signals: string[]
  artifacts: unknown[]
  failure?: {
    class: string
    code: string
    message: string
  }
  knownLimits: string[]
}

interface CatalogModuleLike {
  COMPUTER_USE_COMMAND_SPECS: readonly CommandSpecLike[]
  ComputerUseCommandResolutionError: new (commandId: string) => Error & {
    commandId: string
    failureClass: string
    code: string
  }
  resolveComputerUseCommandSpec: (commandId: string) => CommandSpecLike
  dryRunComputerUseCommand: (request: { commandId: string, dryRun?: boolean }) => InvokeResultLike
}

const expectedSpecs = {
  'chrome.observe': {
    namespace: 'observe',
    operation: 'observe',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: true,
    disturbanceClasses: ['foreground_app'],
    maxDisturbance: 'foreground_app',
  },
  'chrome.recognize': {
    namespace: 'observe',
    operation: 'recognizeFromCapture',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  'chrome.checkSafetyGate': {
    namespace: 'verify',
    operation: 'checkSafetyGate',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  'chrome.promote': {
    namespace: 'prepare',
    operation: 'promoteCandidate',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  'chrome.clickCandidate': {
    namespace: 'action',
    operation: 'click',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  'chrome.focusTextInput': {
    namespace: 'action',
    operation: 'focusTextInput',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['focus'],
    maxDisturbance: 'focus',
  },
  'chrome.typeText': {
    namespace: 'action',
    operation: 'typeText',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  'chrome.pressKey': {
    namespace: 'action',
    operation: 'pressKey',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  'chrome.scroll': {
    namespace: 'action',
    operation: 'scroll',
    mutatesPage: false,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
} as const

const deferredCommandIds = [
  'chrome.detectWebPageOverlayNodes',
  'chrome.dismissPageInterruption',
  'chrome.tabs.snapshot',
  'chrome.navigation.diff',
  'chrome.browser.back',
  'chrome.browser.closeTab',
]

async function loadCatalog(): Promise<CatalogModuleLike> {
  const module = await import('../../src/computer-use/macos-chrome-driver/invoke-catalog.js') as Record<string, unknown>
  assert.equal(Array.isArray(module.COMPUTER_USE_COMMAND_SPECS), true)
  assert.equal(typeof module.ComputerUseCommandResolutionError, 'function')
  assert.equal(typeof module.resolveComputerUseCommandSpec, 'function')
  assert.equal(typeof module.dryRunComputerUseCommand, 'function')
  return module as unknown as CatalogModuleLike
}

function commandIds(specs: readonly CommandSpecLike[]): string[] {
  return specs.map(spec => spec.id).sort()
}

describe('invoke command catalog', () => {
  it('contains exactly the first P1.5.1 command specs', async () => {
    const catalog = await loadCatalog()

    assert.deepEqual(commandIds(catalog.COMPUTER_USE_COMMAND_SPECS), Object.keys(expectedSpecs).sort())
  })

  it('does not include commands deferred out of P1.5.1', async () => {
    const catalog = await loadCatalog()
    const ids = new Set(commandIds(catalog.COMPUTER_USE_COMMAND_SPECS))

    for (const commandId of deferredCommandIds) {
      assert.equal(ids.has(commandId), false, `${commandId} must remain deferred`)
    }
  })

  it('records namespace, operation, mutation, input, activation, and disturbance metadata', async () => {
    const catalog = await loadCatalog()

    for (const [commandId, expected] of Object.entries(expectedSpecs)) {
      const spec = catalog.resolveComputerUseCommandSpec(commandId)

      assert.equal(spec.id, commandId)
      assert.equal(typeof spec.summary, 'string')
      assert.notEqual(spec.summary.trim(), '')
      assert.equal(spec.driverId, 'macos.chrome')
      assert.equal(spec.namespace, expected.namespace)
      assert.equal(spec.operation, expected.operation)
      assert.equal(spec.mutatesPage, expected.mutatesPage)
      assert.equal(spec.deliversInput, expected.deliversInput)
      assert.equal(spec.mayActivateChrome, expected.mayActivateChrome)
      assert.deepEqual(spec.disturbanceClasses, expected.disturbanceClasses)
      assert.equal(spec.maxDisturbance, expected.maxDisturbance)
    }
  })

  it('resolves a known command to a readonly command spec', async () => {
    const catalog = await loadCatalog()
    const spec = catalog.resolveComputerUseCommandSpec('chrome.observe')

    assert.equal(spec.id, 'chrome.observe')
    assert.equal(spec.namespace, 'observe')
    assert.equal(Object.isFrozen(spec), true)
    assert.equal(Object.isFrozen(spec.disturbanceClasses), true)
  })

  it('throws a typed command_resolution error for unknown command resolution', async () => {
    const catalog = await loadCatalog()

    assert.throws(
      () => catalog.resolveComputerUseCommandSpec('chrome.unknown'),
      (error) => {
        assert.equal(error instanceof catalog.ComputerUseCommandResolutionError, true)
        assert.equal((error as { commandId: string }).commandId, 'chrome.unknown')
        assert.equal((error as { failureClass: string }).failureClass, 'command_resolution')
        assert.equal((error as { code: string }).code, 'unknown_command')
        return true
      },
    )
  })

  it('returns a command_resolution dry-run failure for unknown commands', async () => {
    const catalog = await loadCatalog()

    const result = catalog.dryRunComputerUseCommand({
      commandId: 'chrome.unknown',
      dryRun: true,
    })

    assert.equal(result.commandId, 'chrome.unknown')
    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'command_resolution')
    assert.equal(result.failure?.code, 'unknown_command')
    assert.deepEqual(result.artifacts, [])
  })

  it('dry-runs a known command at catalog level and returns its spec', async () => {
    const catalog = await loadCatalog()

    const result = catalog.dryRunComputerUseCommand({
      commandId: 'chrome.clickCandidate',
      dryRun: true,
    })

    assert.equal(result.commandId, 'chrome.clickCandidate')
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, catalog.resolveComputerUseCommandSpec('chrome.clickCandidate'))
    assert.deepEqual(result.artifacts, [])
    assert.ok(result.signals.includes('catalog_resolved'))
    assert.ok(result.signals.includes('dry_run'))
    assert.ok(result.knownLimits.includes('catalog_only_no_live_driver'))
  })
})
