/**
 * Per-field trust's names guard (Node): the mocks were drawn with an agent, a database prefix and record numbers from
 * a real tracker — none of them may appear in the trust code, its strings, specs, helpers, the shot script, the help
 * pages or the changelog entries. They are kept here only as SHA-256 digests (lower case); every group of files must
 * be found, so a moved folder cannot make the guard pass by scanning nothing.
 */
import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** sha256 of the mocks' agent / database prefix and of their record numbers. */
const DIGESTS = new Set([
  '15847f5bbdd236012d960fc1164fec897305a53dafe311ccedfaaa8c553286d6',
  '067ea1716caf605b5ba53949a46af0142ec2578bca0da293c2ac48b46d1bd2bd',
  'cb75a48046c21183cc0fc8e09657a712194966d7d21d2c9c21c52a09df0ffe82',
  'ff82f8369bf72d2b706a32e75b571ec3eb68550403147995cb858c8609837e32',
  'be9deda60cc4b7cfdc2f1e3396ebed5ad6d28937205db8ef46c6a0ed32cd5841',
  '44489ca1033a29251545e1c2219ac2642fae5a6dc6034f27df30e0b2a466c32b',
  '3a1e191db60edbc07691b12e85bd33d917a639b80046839420ccee886c5a7fa4',
  '1f9a1de3220e9c87eb44a903fcf6a6d4cfc73dad231067ad5eac317bcd504ace',
  '16a641c270b45a22f930546aa642a1f8a052790f50c4a7aa08e82b20ebb9ff22',
  '55c5de31ec754ba40fb1687ff4f4e0d95142f5ca2765c4839b618329190a434b',
  'daa1dbb904b938c75b0ba4f6b2a0e50e2286c38e000604866c039997ecb739d6',
  '5f5e771dcb7bd8b6f12bf438bfda25df01ab4cb808c995fdc2fea488709494d7',
  '9e2f46c99a2188ab0ea4f10469e8b1a5be763055bb3efdef7bd587b741d91359',
  'c838df5335c1eba2532f32090cd555d17c9e218289d99ecaf55525d7b199aa88',
  'b847856411aef26fd25bb2569b95a3538080ba0aaa4e9b35c53e3e70d31b0638',
  '815106adc7256d3f3e3c853e5c8e72fb1c3ae3a5e7ac126a90247ca78eb17a71',
])

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out
}
const inDir = (dir: string, re: RegExp) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((n) => re.test(n)).map((n) => join(ROOT, dir, n)) : [])
const one = (p: string) => (existsSync(join(ROOT, p)) ? [join(ROOT, p)] : [])

/** Every group the guard reads; each must hold at least one file. */
const GROUPS: Record<string, () => string[]> = {
  'features/agents/trust/**': () => filesUnder(join(ROOT, 'src/app/features/agents/trust')),
  'tests/e2e/agent-trust*.spec.ts': () => inDir('tests/e2e', /^agent-trust.*\.spec\.ts$/),
  'tests/e2e/helpers/trustStory.*': () => inDir('tests/e2e/helpers', /^trustStory\./),
  'scripts/trust-shots.mjs': () => one('scripts/trust-shots.mjs'),
  'help/articles/{en,de}/agent-trust.md': () => [...one('src/app/help/articles/en/agent-trust.md'), ...one('src/app/help/articles/de/agent-trust.md')],
  'help/changelog/{en,de}/*agent-trust*.md': () => [...inDir('src/app/help/changelog/en', /agent-trust/), ...inDir('src/app/help/changelog/de', /agent-trust/)],
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
const digest = (w: string) => createHash('sha256').update(w).digest('hex')

test('no name or record number from the mocks in the trust code, strings, specs, story, shots, help or changelog', () => {
  expect(DIGESTS.size).toBeGreaterThan(10)
  const hits: string[] = []
  let files = 0
  for (const [glob, list] of Object.entries(GROUPS)) {
    const found = list()
    expect(found.length, glob).toBeGreaterThan(0)
    for (const f of found) {
      files++
      for (const w of new Set(words(readFileSync(f, 'utf8')))) {
        if (DIGESTS.has(digest(w))) hits.push(`${relative(ROOT, f)}: ${digest(w).slice(0, 12)}`)
        // a hyphenated word is checked as its parts too
        if (w.includes('-')) for (const part of w.split('-')) if (DIGESTS.has(digest(part))) hits.push(`${relative(ROOT, f)}: ${digest(part).slice(0, 12)}`)
      }
    }
  }
  expect(files).toBeGreaterThan(15)
  expect(hits).toEqual([])
})

test('the guard itself sees a planted name', () => {
  const planted = [110, 114, 100].map((c) => String.fromCharCode(c)).join('')
  expect(DIGESTS.has(digest(planted))).toBe(true)
  expect(words(`x-${planted}-1`).flatMap((w) => w.split('-')).some((p) => DIGESTS.has(digest(p)))).toBe(true)
})
