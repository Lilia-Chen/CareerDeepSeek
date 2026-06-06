/**
 * Screenshot capture via `screencapture -x` (no sound, no flash).
 *
 * The `-x` flag suppresses the camera shutter sound and screen flash
 * effect, making each capture silent and invisible.
 */

import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import type { ComputerUseConfig } from './config.js'
import type { ScreenshotArtifact } from './types.js'

import { runProcess } from './process.js'

const PLACEHOLDER_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pP8WwAAAABJRU5ErkJggg=='

function readPngDimensions(buffer: Buffer): { width?: number, height?: number } {
  if (buffer.length < 24)
    return {}
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a')
    return {}
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function sanitize(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 64)
}

export async function captureScreenshot(
  config: ComputerUseConfig,
  label = 'desktop',
): Promise<ScreenshotArtifact> {
  await mkdir(config.screenshotsDir, { recursive: true })

  const fileName = `${Date.now()}-${sanitize(label)}.png`
  const outputPath = join(config.screenshotsDir, fileName)

  try {
    if (process.platform !== 'darwin') {
      throw new Error('Screenshot capture is only implemented for macOS')
    }

    await runProcess(config.binaries.screencapture, ['-x', outputPath], {
      timeoutMs: config.timeoutMs,
    })

    const buffer = await readFile(outputPath)
    const dimensions = readPngDimensions(buffer)

    return {
      dataBase64: buffer.toString('base64'),
      mimeType: 'image/png',
      path: outputPath,
      width: dimensions.width,
      height: dimensions.height,
      capturedAt: new Date().toISOString(),
    }
  }
  catch (error) {
    // Return a 1x1 transparent placeholder on failure so the pipeline
    // doesn't crash — the staleness flag will mark this as degraded.
    const buffer = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64')
    const placeholderPath = join(config.screenshotsDir, `${fileName}.placeholder.png`)
    await writeFile(placeholderPath, buffer)

    return {
      dataBase64: PLACEHOLDER_PNG_BASE64,
      mimeType: 'image/png',
      path: placeholderPath,
      width: 1,
      height: 1,
      capturedAt: new Date().toISOString(),
      placeholder: true,
      note: error instanceof Error ? error.message : String(error),
    }
  }
}
