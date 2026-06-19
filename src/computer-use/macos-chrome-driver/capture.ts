import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import type { Buffer } from 'node:buffer'
import type { ComputerUseConfig } from '../config.js'
import type { ScreenshotArtifact } from '../types.js'
import type { ChromeCaptureContract, ChromeWindowCapture, ChromeWindowRef } from './types.js'

import { runProcess } from '../process.js'

function readPngDimensions(buffer: Buffer): { width: number, height: number } {
  if (buffer.length < 24)
    throw new Error('Captured Chrome window screenshot is not a valid PNG.')
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a')
    throw new Error('Captured Chrome window screenshot is not a PNG image.')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function sanitize(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 80)
}

export async function captureChromeWindow(input: {
  config: ComputerUseConfig
  sessionId: string
  snapshotId: string
  window: ChromeWindowRef
}): Promise<ChromeWindowCapture> {
  if (process.platform !== 'darwin') {
    throw new Error('Chrome window capture is only supported on macOS.')
  }

  const { config, sessionId, snapshotId, window } = input
  await mkdir(config.screenshotsDir, { recursive: true })
  const fileName = `${Date.now()}-${sanitize(sessionId)}-${sanitize(snapshotId)}-chrome-window.png`
  // AUV-aligned: store absolute paths so artifact references resolve
  // correctly regardless of the consumer's working directory.
  const outputPath = resolve(config.screenshotsDir, fileName)

  await runProcess(
    config.binaries.screencapture,
    ['-x', '-o', `-l${window.windowNumber}`, outputPath],
    { timeoutMs: config.timeoutMs },
  )

  const buffer = await readFile(outputPath)
  const dimensions = readPngDimensions(buffer)
  const capturedAt = new Date().toISOString()

  const screenshot: ScreenshotArtifact = {
    dataBase64: buffer.toString('base64'),
    mimeType: 'image/png',
    path: outputPath,
    width: dimensions.width,
    height: dimensions.height,
    capturedAt,
  }

  const logicalWidth = Math.max(window.bounds.width, 1)
  const logicalHeight = Math.max(window.bounds.height, 1)
  const contract: ChromeCaptureContract = {
    coordinateContractVersion: 1,
    captureSource: {
      kind: 'window',
      windowNumber: window.windowNumber,
      ownerPid: window.ownerPid,
      ownerBundleId: window.ownerBundleId,
    },
    sourceGlobalLogicalBounds: window.bounds,
    screenshotPixelSize: {
      width: dimensions.width,
      height: dimensions.height,
    },
    pixelToLogicalScale: {
      x: logicalWidth / dimensions.width,
      y: logicalHeight / dimensions.height,
    },
    logicalToPixelScale: {
      x: dimensions.width / logicalWidth,
      y: dimensions.height / logicalHeight,
    },
    capturedAt,
  }

  return {
    snapshotId,
    screenshot,
    contract,
  }
}
