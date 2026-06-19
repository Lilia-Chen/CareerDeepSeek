export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

interface PointLike {
  x: number
  y: number
}

interface BoxLike extends PointLike {
  width: number
  height: number
}

export interface ArtifactRefLike {
  run_id: string
  artifact_id: string
  span_id: string
  captured_event_id?: string
}

export function isObjectLikeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function stringifyThrownValue(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return 'unknown error'
}

export function sanitizeArtifactId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 120)
}

export function pointInsideBounds(point: PointLike, bounds: BoxLike): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

export function validConfidence(confidence: number | undefined): boolean {
  return Number.isFinite(confidence) && confidence! >= 0 && confidence! <= 1
}

export function boxesMatch(a: BoxLike, b: BoxLike, tolerance = 0.5): boolean {
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance
}

export function centerOf(box: BoxLike): { x: number, y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

export function isCoreArtifactRef(value: unknown): value is ArtifactRefLike {
  return isObjectLikeRecord(value)
    && typeof value.run_id === 'string'
    && typeof value.artifact_id === 'string'
    && typeof value.span_id === 'string'
}

export function isCapturedEventArtifactRef(value: unknown): value is ArtifactRefLike {
  return isCoreArtifactRef(value)
    && (
      value.captured_event_id === undefined
      || typeof value.captured_event_id === 'string'
    )
}

export function artifactRefKey(ref: ArtifactRefLike): string {
  return JSON.stringify([
    ref.run_id,
    ref.artifact_id,
    ref.span_id,
    ref.captured_event_id ?? null,
  ])
}

export function uniqueArtifactRefs<T extends ArtifactRefLike>(refs: readonly T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const ref of refs) {
    const key = artifactRefKey(ref)
    if (seen.has(key))
      continue
    seen.add(key)
    unique.push(ref)
  }
  return unique
}

export function hasProjectedBoundsShape(value: unknown): boolean {
  return isObjectLikeRecord(value)
    && isObjectLikeRecord(value.capture_pixel)
    && isObjectLikeRecord(value.source_global_logical)
}

export function hasCaptureAndProjectedBoundsMatchingBox(value: unknown, expectedBox: BoxLike): boolean {
  return isObjectLikeRecord(value)
    && validBoxLike(value.capture_pixel)
    && validBoxLike(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

export function hasProjectedLogicalBoundsMatchingBox(value: unknown, expectedBox: BoxLike): boolean {
  return isObjectLikeRecord(value)
    && validBoxLike(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

function validBoxLike(value: unknown): value is BoxLike {
  return isObjectLikeRecord(value)
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0
}
