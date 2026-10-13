#!/usr/bin/env node
/**
 * Jev calibration (slice SJ, SP-J3 — jev-design.md § 7.2): the owner's one command
 *
 *   OPENROUTER_API_KEY=… node scripts/jev-calibrate.mjs --real [--repeats 4] [--only en|de] [--limit n]
 *
 * reads the labelled, fictional proposals of tests/fixtures/ai/jev/calibration/{en,de}.json (≥ 120), builds each state
 * with the SAME state builder and question set a real agent run uses (features/ai/decide: proposalState + QSET, loaded
 * through Vite so the app's own code runs), sends each `--repeats` times (default 4, ≤ 3 in flight) to OpenRouter's
 * decisions surface, and writes
 *   - tests/fixtures/ai/openrouter/recorded/SP-J3-<lang>.json — the exchanges, scrubbed (no key, no header, the state as
 *     sent, the answers, the served model, operator and usage);
 *   - tests/fixtures/ai/openrouter/recorded/SP-J3-summary.json — per threshold 0,60 … 0,95: good proposals marked,
 *     bad ones not marked, bad ones the write gate would let through; per question the noise between identical calls.
 * It never suggests a threshold: the owner sets JEV_DEFAULTS / JEV_CALIBRATED (src/shared/ai/jev.ts) from the summary in one
 * follow-up commit. Expected: < $0.10, about 3 minutes.
 *
 * Refuses (exit 2, nothing sent) without `--real`, without OPENROUTER_API_KEY in the environment, and in CI. The model is
 * the newest pinned Jev version of OpenRouter's public decisions list — no model id lives in this script.
 * `--check` sends nothing: it loads the app's code and builds every state (a quick look that the fixtures still build).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

function refuse(why) {
  process.stderr.write(`jev-calibrate: ${why} — nothing was sent.\n`)
  process.exit(2)
}

const check = args.includes('--check')
if (process.env.CI && !check) refuse('never runs in CI')
if (check) {
  const { createServer } = await import('vite')
  const vite = await createServer({ root: ROOT, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const cal = await vite.ssrLoadModule('/src/app/features/ai/decide/calibration.ts')
    let built = 0
    let total = 0
    for (const lang of ['en', 'de']) {
      const file = JSON.parse(readFileSync(join(ROOT, `tests/fixtures/ai/jev/calibration/${lang}.json`), 'utf8'))
      for (const item of file.items) {
        total++
        if (cal.calibState(item)) built++
      }
    }
    process.stdout.write(`jev-calibrate --check: ${built} of ${total} states built — nothing was sent.\n`)
    process.exitCode = built === total ? 0 : 1
  } finally {
    await vite.close()
  }
  process.exit()
}
if (!args.includes('--real')) refuse('add --real to send the calibration proposals to OpenRouter (it costs a few cents on your key)')
const KEY = process.env.OPENROUTER_API_KEY ?? ''
if (!KEY.trim()) refuse('set OPENROUTER_API_KEY in the environment (never on the command line)')

const repeats = Math.max(1, Math.min(8, Number(arg('repeats', '4')) || 4))
const only = arg('only', '')
const limit = Number(arg('limit', '0')) || 0

// the app's own code (aliases and TypeScript as the app builds them)
const { createServer } = await import('vite')
const vite = await createServer({ root: ROOT, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
let failed = false
try {
  const cal = await vite.ssrLoadModule('/src/app/features/ai/decide/calibration.ts')
  const wire = await vite.ssrLoadModule('/src/shared/ai/wire/decisions.ts')
  const jev = await vite.ssrLoadModule('/src/shared/ai/jev.ts')
  const catalog = await vite.ssrLoadModule('/src/shared/ai/catalog.ts')
  const keys = await vite.ssrLoadModule('/src/shared/ai/keys.ts')

  // the newest pinned Jev version and its endpoints (public, no key)
  const list = await (await fetch('https://openrouter.ai/api/v1/models?output_modalities=decisions')).json()
  const row = jev.newestJev(catalog.readDecisionRows(list).filter((r) => !r.refused))
  if (!row) refuse('no Jev version in OpenRouter’s decisions list')
  const eps = await (await fetch(`https://openrouter.ai/api/v1/models/${row.id}/endpoints`)).json()
  const pins = cal.endpointTags(eps)
  if (!pins.length) refuse(`no endpoint listed for ${row.id}`)

  const files = ['en', 'de'].filter((l) => !only || l === only)
  const exchanges = Object.fromEntries(files.map((l) => [l, []]))
  const results = []
  for (const lang of files) {
    const file = JSON.parse(readFileSync(join(ROOT, `tests/fixtures/ai/jev/calibration/${lang}.json`), 'utf8'))
    const items = limit ? file.items.slice(0, limit) : file.items
    process.stdout.write(`${lang}: ${items.length} proposals × ${repeats} → ${row.id} (${pins.join(', ')})\n`)
    const send = async (state, questions) => {
      const built = wire.buildDecide({ kind: 'decide', route: { p: 'openrouter', m: row.id }, state, questions }, { pins, upstream: { deny: [], noCollect: true, zdr: false }, referer: 'https://one.invalid/calibration' })
      const res = await fetch(built.url, { method: 'POST', headers: { ...built.headers, Authorization: `Bearer ${KEY}` }, body: JSON.stringify(built.body) })
      const json = await res.json().catch(() => null)
      exchanges[lang].push(JSON.parse(keys.scrubSecrets(JSON.stringify({ status: res.status, state, answers: json?.answers ?? null, model: json?.model ?? null, provider: json?.provider ?? null, usage: json?.usage ?? null, error: res.ok ? null : (json?.error ?? null) }))))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return wire.parseDecide(json, questions)
    }
    results.push(...(await cal.runCalibration(items, send, { repeats, inFlight: 3, onDone: (n) => n % 20 === 0 && process.stdout.write(`  ${n} answered\n`) })))
  }

  const summary = { at: new Date().toISOString(), model: row.id, canonical: row.canonical, repeats, ...cal.summarize(results) }
  const usd = Object.values(exchanges).flat().reduce((n, e) => n + (typeof e.usage?.cost === 'number' ? e.usage.cost : 0), 0)
  const out = join(ROOT, 'tests/fixtures/ai/openrouter/recorded')
  mkdirSync(out, { recursive: true })
  for (const lang of files) writeFileSync(join(out, `SP-J3-${lang}.json`), `${JSON.stringify({ spike: 'SP-J3', lang, model: row.id, exchanges: exchanges[lang] }, null, 1)}\n`)
  writeFileSync(join(out, 'SP-J3-summary.json'), `${JSON.stringify({ spike: 'SP-J3', ...summary, usd }, null, 2)}\n`)
  process.stdout.write(`\n${JSON.stringify({ ...summary, usd }, null, 2)}\n\nWritten: tests/fixtures/ai/openrouter/recorded/SP-J3-*.json\n`)
} catch (e) {
  failed = true
  process.stderr.write(`jev-calibrate: ${e instanceof Error ? e.message : String(e)}\n`)
} finally {
  await vite.close()
}
process.exit(failed ? 1 : 0)
