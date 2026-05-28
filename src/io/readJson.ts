import { readFile } from 'node:fs/promises'

export async function readJson<T = unknown>(path: string | URL): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}
