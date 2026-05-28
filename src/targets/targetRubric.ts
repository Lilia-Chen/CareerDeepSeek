import { readJson } from '../io/readJson.js'
import type { Rubric } from '../types.js'

export async function loadTargetRubric(path: string | URL = new URL('../../config/target-rubric.json', import.meta.url)): Promise<Rubric> {
  return readJson<Rubric>(path)
}
