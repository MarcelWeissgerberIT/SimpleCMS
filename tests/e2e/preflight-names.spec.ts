/**
 * Preflight's names guard (T-P1-10, Node): the mocks were drawn on the person's real workspace — no word of Preflight's
 * code, the Outbox's lamp, their strings, the Preflight specs and helpers, the shot script, help pages or changelog
 * entries may be one of those real names. The names are kept here only as SHA-256 digests.
 */
import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** sha256 of the lower-cased real names (a workspace, a profile code, a server, a person, ticket numbers, page titles). */
const DIGESTS = new Set([
  '3b10f867fbedeceeb236b2a7cd215106db9e43f5622fc30585d5604d20a4e6cc',
  'da1190107365d1531400d32ed17cd1cbc7765b0d0990a746981409a8b71ad8c2',
  '7ae4495c83dd7323b71c94739ddc7a45dfe3cb6a851c31fc1d040cdd47ced985',
  '42258bfc34d01f0078c5c25148b235ea9f7a67fbd6ab5ac4efdacaf310825022',
  'bcc4c764b525996be1dd8fc481ce1da83b34d17543ee76ecd378e0ae10292457',
  '4ea5ee68fea05586106890ded5733820bb77d919cda27bc4b8139b7cd33b8889',
  '92aded40fbb9c79e9265343b9f2e2fdd0528691839ddabc2fccdf5967cebf16c',
  '04e48ac7521e8b8d522479979ebeaa5c972633d5b282106824320d0fd71d949f',
  '2bb0406e8c10376d205bb137389f88b6125cc78081d3f4eecdccc12ed0794ed5',
  'c9efd028be5f39b3a9178ec992f8e55e0a0f40f277101d4b30ba541547620848',
  'e9c80a40f4a06237d79bbd8844c21911bc98b3d182abae69281d779b4bba2ef9',
  '3ab2122e52aa812003d76e2487f561f33b5e39f614d2b9084b59f20be9e52bde',
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

const sources = (): string[] => {
  const list = [
    ...filesUnder(join(ROOT, 'src/app/features/preflight')),
    join(ROOT, 'src/app/features/outbox/lamp.ts'),
    ...readdirSync(join(ROOT, 'tests/e2e')).filter((n) => n.startsWith('preflight')).map((n) => join(ROOT, 'tests/e2e', n)),
    join(ROOT, 'tests/e2e/helpers/preflightStory.mjs'),
    join(ROOT, 'scripts/preflight-shots.mjs'),
    join(ROOT, 'src/app/help/articles/en/preflight.md'),
    join(ROOT, 'src/app/help/articles/de/preflight.md'),
    ...filesUnder(join(ROOT, 'src/app/help/changelog')).filter((f) => /preflight/.test(relative(ROOT, f))),
  ]
  return list.filter((f) => existsSync(f))
}

/** The outbox messages' Preflight lamp strings. */
const outboxLampStrings = (): string =>
  readFileSync(join(ROOT, 'src/app/features/outbox/messages.ts'), 'utf8')
    .split('\n')
    .filter((l) => l.includes("'features.outbox.lamp."))
    .join('\n')

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
const digest = (w: string) => createHash('sha256').update(w).digest('hex')

test('no real name from the mocks in Preflight’s code, strings, specs, helpers, shots, help or changelog', () => {
  const files = sources()
  expect(files.length).toBeGreaterThan(25)
  const hits: string[] = []
  const check = (where: string, text: string) => {
    for (const w of new Set(words(text))) {
      if (DIGESTS.has(digest(w))) hits.push(`${where}: ${digest(w).slice(0, 12)}`)
      // a hyphenated word is checked as its parts too ("x-real" hides nothing)
      if (w.includes('-')) for (const part of w.split('-')) if (DIGESTS.has(digest(part))) hits.push(`${where}: ${digest(part).slice(0, 12)}`)
    }
  }
  for (const f of files) check(relative(ROOT, f), readFileSync(f, 'utf8'))
  check('features/outbox/messages.ts (lamp strings)', outboxLampStrings())
  expect(hits).toEqual([])
})

test('the guard itself sees a planted name', () => {
  const planted = ['b', 'a'].reverse().join('') === 'ab' ? String.fromCharCode(99, 110, 115, 120) : ''
  expect(DIGESTS.has(digest(planted))).toBe(true)
})
