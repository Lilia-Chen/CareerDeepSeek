/**
 * Quadratic Bezier pointer trace generation.
 *
 * Generates a natural-looking mouse movement path from the current cursor
 * position to a target, using a quadratic Bezier curve with a control point
 * offset from the start position. The result is an array of {x, y, delayMs}
 * points suitable for the CGEvent move-and-click Swift script.
 */

import type { Bounds, PointerTracePoint } from './types.js'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampPoint(
  x: number,
  y: number,
  bounds?: Bounds,
): { x: number, y: number } {
  if (!bounds)
    return { x, y }
  return {
    x: clamp(x, bounds.x, bounds.x + bounds.width),
    y: clamp(y, bounds.y, bounds.y + bounds.height),
  }
}

export function buildPointerTrace(params: {
  from?: { x: number, y: number }
  to: { x: number, y: number }
  bounds?: Bounds
  steps?: number
}): PointerTracePoint[] {
  const steps = Math.max(params.steps ?? 14, 4)
  const fallbackStart = {
    x: params.to.x - 64,
    y: params.to.y - 48,
  }
  const start = clampPoint(
    params.from?.x ?? fallbackStart.x,
    params.from?.y ?? fallbackStart.y,
    params.bounds,
  )
  const end = clampPoint(params.to.x, params.to.y, params.bounds)

  if (start.x === end.x && start.y === end.y)
    return []

  // Control point offset creates a slight upward arc (human-like).
  const control = clampPoint(
    start.x + (end.x - start.x) * 0.55,
    start.y + (end.y - start.y) * 0.2 - 18,
    params.bounds,
  )

  const points: PointerTracePoint[] = []
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const inverse = 1 - t
    const x = (inverse * inverse * start.x) + (2 * inverse * t * control.x) + (t * t * end.x)
    const y = (inverse * inverse * start.y) + (2 * inverse * t * control.y) + (t * t * end.y)

    const nextPoint: PointerTracePoint = {
      x: Math.round(x),
      y: Math.round(y),
      delayMs: i === steps ? 16 : 10,
    }
    const prev = points.at(-1)
    if (prev && prev.x === nextPoint.x && prev.y === nextPoint.y)
      continue
    points.push(nextPoint)
  }

  // Ensure the last point is the exact target.
  const last = points.at(-1)
  if (!last || last.x !== end.x || last.y !== end.y) {
    points.push({ x: end.x, y: end.y, delayMs: 16 })
  }

  return points
}
