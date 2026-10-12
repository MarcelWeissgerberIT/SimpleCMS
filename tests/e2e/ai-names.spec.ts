/**
 * Multi-provider S2, the names guard (Node, no browser): provider names, hosts, key prefixes and model slugs live only
 * where they belong.
 *
 *  - the Jev Router's slug (any `typesafe/` slug) only in src/shared/ai/jev.ts — a planted copy is found (positive control)
 *  - no OpenRouter model slug (the catalogue fixture's maker prefixes) anywhere in the app, the help, the landing, the
 *    server or the worker — except jev.ts
 *  - provider hosts and key prefixes (openrouter.ai, api.openai.com, sk-or-v1, sk-proj) only in the shared registry, the AI
 *    core / providers / setup / routing, the help articles and the landing — plus the frozen list of files that hold them
 *  - `@anthropic-ai/sdk` loaded at runtime only by providers/anthropic.ts; type imports only in the files that have them
 *  - the provider-exclusive phrases ("Anthropic API key", "straight to Anthropic" …) only in src/shared/ai/providers.ts
 *  - the privacy article quotes the registry's privacy sentences word for word (EN + DE)
 *  - the fake adapter's marker never reaches a build
 * Reads files only (helpers/noNet: no request leaves).
 */
import './helpers/noNet'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { PROVIDERS } from '../../src/shared/ai/providers'
import { FAKE_MARKER } from './helpers/fakeAdapter'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCANNED = ['src', 'server/src', 'mcp/src']
const EXT = /\.(ts|tsx|mjs|js|css|html|md|json)$/

/** Every source file under `dirs` (relative to `root`), node_modules left out. */
function filesUnder(root: string, dirs: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (EXT.test(e.name)) out.push(p)
    }
  }
  for (const d of dirs) walk(join(root, d))
  return out
}

/** Files (relative paths) whose text matches `re`. */
function holding(root: string, dirs: string[], re: RegExp): string[] {
  return filesUnder(root, dirs)
    .filter((f) => re.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f).split('\\').join('/'))
    .sort()
}

const JEV_FILE = 'src/shared/ai/jev.ts'
const TYPESAFE_SLUG = /\btypesafe\/[a-z0-9]/i

/** The makers of the trimmed public catalogue (its slugs' prefixes) — the probe for model slugs. */
const MAKERS = [
  ...new Set(
    (JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/openrouter-models.json'), 'utf8')) as { data: Array<{ id: string }> }).data.map((r) => r.id.split('/')[0]!.replace(/^~/, '')),
  ),
]
const SLUG = new RegExp(`(?:^|[^\\w.-])~?(?:${MAKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})/[a-z0-9][\\w.:-]*`, 'i')

const ALLOWED_DIRS = ['src/shared/ai/', 'src/app/features/ai/core/', 'src/app/features/ai/providers/', 'src/app/features/ai/setup/', 'src/app/features/ai/routing/', 'src/app/help/articles/', 'src/landing/']
/** files outside those places that hold a host or key prefix today, each for a reason (frozen: a new one fails) */
const HOSTS_FROZEN = [
  'src/app/store/secrets.ts', // the vault's key-shape check per provider
]

/** the app loads the SDK in its Claude adapter only; the team server's agent runner is its own program (Claude only) */
const SDK_RUNTIME = ['server/src/agents/runner.ts', 'src/app/features/ai/providers/anthropic.ts']
/** files with type-only imports of the SDK today (frozen) */
const SDK_TYPES = [
  'server/src/agents/runner.ts',
  'server/src/agents/tools.ts',
  'src/app/features/ai/agent/run.ts',
  'src/app/features/ai/agent/session.ts',
  'src/app/features/ai/file/request.ts',
  'src/app/features/ai/file/terminal.ts',
  'src/app/features/ai/image/request.ts',
  'src/app/features/ai/image/terminal.ts',
  'src/app/features/ai/mcp-servers/activity.ts',
  'src/app/features/ai/mcp-servers/config.ts',
  'src/app/features/ai/mcp-servers/generate.ts',
  'src/app/features/ai/mcp-servers/lock.ts',
  'src/app/features/ai/providers/anthropic.ts',
]

const EXCLUSIVE = ['Anthropic API key', 'Pay Anthropic', 'straight to Anthropic', 'direkt zu Anthropic', 'zahlst Anthropic', 'Anthropic-API-Key', 'Anthropic-API-Schlüssel']

test.describe('provider names stay where they belong', () => {
  test('the Jev Router slug only in jev.ts; a planted copy is found', () => {
    expect(holding(ROOT, SCANNED, TYPESAFE_SLUG)).toEqual([JEV_FILE])
    // positive control: the same scan finds a slug planted in a temporary file
    const dir = mkdtempSync(join(tmpdir(), 'one-names-'))
    try {
      writeFileSync(join(dir, 'planted.ts'), `export const route = 'typesafe/jev-router'\n`)
      expect(holding(dir, ['.'], TYPESAFE_SLUG)).toEqual(['planted.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('no OpenRouter model slug in the app, the help, the landing, the server or the worker (jev.ts aside)', () => {
    expect(MAKERS.length).toBeGreaterThan(10)
    expect(holding(ROOT, SCANNED, SLUG).filter((f) => f !== JEV_FILE)).toEqual([])
    // positive control: the probe matches a catalogue slug and an alias, not a host or a path
    expect(SLUG.test(`model: 'deepseek/deepseek-v4-flash'`)).toBe(true)
    expect(SLUG.test(`'~anthropic/claude-sonnet-latest'`)).toBe(true)
    expect(SLUG.test('https://api.openai.com/v1/chat')).toBe(false)
    expect(SLUG.test('https://accounts.google.com/o/oauth2')).toBe(false)
  })

  test('hosts and key prefixes only in the registry, the AI core / providers / setup / routing, the help and the landing', () => {
    const found = holding(ROOT, SCANNED, /openrouter\.ai|api\.openai\.com|sk-or-v1|sk-proj/)
    const outside = found.filter((f) => !ALLOWED_DIRS.some((d) => f.startsWith(d)))
    expect(outside).toEqual(HOSTS_FROZEN)
    // the registry itself holds them
    expect(found).toContain('src/shared/ai/providers.ts')
  })

  test('@anthropic-ai/sdk: loaded at runtime by the Claude adapter only; type imports only where they are today', () => {
    const files = filesUnder(ROOT, SCANNED).filter((f) => /\.(ts|tsx)$/.test(f))
    const runtime: string[] = []
    const types: string[] = []
    for (const f of files) {
      const s = readFileSync(f, 'utf8')
      const rel = relative(ROOT, f).split('\\').join('/')
      // static imports: `import type …` is types only; anything else loads the SDK
      for (const m of s.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+'@anthropic-ai\/sdk[^']*'/gm)) (m[1] ? types : runtime).push(rel)
      // a dynamic import(), unless it is `typeof import(…)`
      for (const m of s.matchAll(/(typeof\s+)?import\(\s*'@anthropic-ai\/sdk[^']*'\s*\)/g)) if (!m[1]) runtime.push(rel)
    }
    expect([...new Set(runtime)].sort()).toEqual(SDK_RUNTIME)
    expect([...new Set(types)].sort()).toEqual([...SDK_TYPES].sort())
  })

  test('the provider-exclusive phrases only in the registry (a word-for-word quote of its sentences aside)', () => {
    const quotes = (['anthropic', 'openai', 'openrouter'] as const).flatMap((p) => [PROVIDERS[p].privacy.en, PROVIDERS[p].privacy.de])
    quotes.push(PROVIDERS.openrouter.routerPrivacy.en, PROVIDERS.openrouter.routerPrivacy.de)
    const offenders: string[] = []
    for (const f of filesUnder(ROOT, SCANNED)) {
      const rel = relative(ROOT, f).split('\\').join('/')
      if (rel === 'src/shared/ai/providers.ts') continue
      let text = readFileSync(f, 'utf8')
      for (const q of quotes) text = text.split(q).join('')
      for (const p of EXCLUSIVE) if (text.includes(p)) offenders.push(`${rel}: ${p}`)
    }
    expect(offenders).toEqual([])
    // positive control: the phrase is found in a text that is not a quote
    expect(EXCLUSIVE.some((p) => 'Paste your Anthropic API key here'.includes(p))).toBe(true)
  })

  test('the privacy article quotes the registry\'s privacy sentences word for word (EN + DE)', () => {
    for (const lang of ['en', 'de'] as const) {
      const text = readFileSync(join(ROOT, `src/app/help/articles/${lang}/privacy.md`), 'utf8')
      for (const p of ['anthropic', 'openrouter'] as const) expect(text, `${lang} ${p}`).toContain(PROVIDERS[p].privacy[lang])
      expect(text, `${lang} router`).toContain(PROVIDERS.openrouter.routerPrivacy[lang])
    }
  })

  test('the fake adapter\'s marker never reaches a build', () => {
    const port = process.env.E2E_PORT ?? '5173'
    const builds = ['dist', `node_modules/.cache/e2e-dist-${port}`].map((d) => join(ROOT, d)).filter((d) => existsSync(d))
    test.skip(!builds.length, 'no build here (dist / the e2e build) — the batch that builds checks it')
    for (const b of builds) {
      const js = filesUnder(b, ['.']).filter((f) => f.endsWith('.js'))
      expect(js.length).toBeGreaterThan(0)
      expect(js.filter((f) => readFileSync(f, 'utf8').includes(FAKE_MARKER)).map((f) => relative(b, f))).toEqual([])
    }
  })
})
