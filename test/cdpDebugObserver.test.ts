import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'

import { it } from 'vitest'

import { captureCdpDebugObservation, sendAllowedCdpCommand } from '../src/observation/cdpDebugObserver.js'
import type { CdpSessionLike } from '../src/observation/cdpDebugObserver.js'

it('captures compact native AX debug data through read-only allowlisted CDP commands', async () => {
  const calls: Array<{ method: string, params?: Record<string, unknown> }> = []
  const session: CdpSessionLike = {
    async send(method, params) {
      calls.push({ method, params })

      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              nodeId: '1',
              role: { value: 'RootWebArea' },
              name: { value: 'Fixture' },
              ignored: false,
              childIds: ['2'],
            },
            {
              nodeId: '2',
              role: { value: 'button' },
              name: { value: 'Search jobs' },
              ignored: false,
              backendDOMNodeId: 42,
            },
          ],
        }
      }

      if (method === 'DOMSnapshot.captureSnapshot') {
        return {
          documents: [
            {
              nodes: {
                nodeName: ['HTML', 'BODY', 'BUTTON'],
              },
              layout: {
                nodeIndex: [0, 1, 2],
              },
            },
          ],
        }
      }

      if (method === 'Page.captureScreenshot') {
        return {
          data: Buffer.from('synthetic-png').toString('base64'),
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    },
  }

  const observation = await captureCdpDebugObservation({ session })

  assert.deepEqual(calls.map(call => call.method), [
    'Accessibility.getFullAXTree',
    'DOMSnapshot.captureSnapshot',
    'Page.captureScreenshot',
  ])
  assert.equal(observation.source, 'cdp_debug')
  assert.equal(observation.axTree.native, true)
  assert.equal(observation.axTree.nodes[1].role, 'button')
  assert.equal(observation.axTree.nodes[1].name, 'Search jobs')
  assert.equal(observation.domSnapshot.nodeCount, 3)
  assert.equal(observation.screenshot?.source, 'cdp_Page.captureScreenshot')
})

it('rejects CDP commands outside the debug observer allowlist', async () => {
  const session: CdpSessionLike = {
    async send() {
      throw new Error('send should not be called')
    },
  }

  await assert.rejects(
    () => sendAllowedCdpCommand(session, 'Runtime.evaluate' as never, { expression: 'document.title' }),
    /not allowed/,
  )
})
