import { readJson } from '../io/readJson.js'
import type { Rubric, RubricDimension } from '../types.js'

export async function loadRubric(path: string | URL = new URL('../../config/scoring-rubric.json', import.meta.url)): Promise<Rubric> {
  return readJson<Rubric>(path)
}

export function getDimension(rubric: Rubric, id: string): RubricDimension | undefined {
  return rubric.dimensions.find(dimension => dimension.id === id)
}
