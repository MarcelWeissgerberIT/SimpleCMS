/**
 * Flight recorder — test data is fictional (design §10, B10): no word in the recorder's sources, messages, specs,
 * helpers, fixtures, the story generator or its help pages is one of the real names the product spec was written
 * with. Only SHA-256 digests of those names are here — the names themselves never enter the repository.
 * Node only (no browser).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

/** SHA-256 (hex) of the lower-cased real names. */
const REAL = new Set([
  '3b10f867fbedeceeb236b2a7cd215106db9e43f5622fc30585d5604d20a4e6cc',
  '42258bfc34d01f0078c5c25148b235ea9f7a67fbd6ab5ac4efdacaf310825022',
  '1f7d8737f70b022f518d7181ec439a24f09ca41df0b9a0cfc8b2622da537a10e',
])

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Every file under `dir` (recursive). */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** The recorder's own files: sources and messages, specs, helpers, fixtures, the story generator, help pages. */
function recorderFiles(): string[] {
  const inDir = (dir: string, re: RegExp) => readdirSync(join(ROOT, dir)).filter((n) => re.test(n)).map((n) => join(ROOT, dir, n))
  return [
    ...walk(join(ROOT, 'src/app/features/recorder')),
    ...inDir('tests/e2e', /^recorder-.*\.ts$/),
    ...inDir('tests/e2e-cloud', /^recorder-.*\.ts$/),
    ...inDir('tests/e2e/fixtures', /^recorder-/),
    join(ROOT, 'tests/e2e/helpers/recorder.ts'),
    join(ROOT, 'scripts/recorder-story.mjs'),
    ...['en', 'de'].map((l) => join(ROOT, `src/app/help/articles/${l}/flight-recorder.md`)),
  ].filter((p) => existsSync(p))
}

test('the recorder’s files hold no real name of the product spec (only fictional test data)', () => {
  const files = recorderFiles()
  expect(files.length).toBeGreaterThan(20)
  const hits: string[] = []
  for (const f of files) {
    const words = new Set(readFileSync(f, 'utf8').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
    for (const w of words) if (REAL.has(createHash('sha256').update(w).digest('hex'))) hits.push(`${f.slice(ROOT.length)}: a word of length ${w.length}`)
  }
  expect(hits).toEqual([])
})
