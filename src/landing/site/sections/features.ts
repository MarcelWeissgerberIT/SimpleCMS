import type { Ctx } from '../context'
import type { FeatureGroup, FeatureKey } from '../messages'
import { asset, esc } from '../util'
import { sectionHead } from './head'

const GROUPS: Array<{ key: FeatureGroup; code: string }> = [
  { key: 'write', code: 'A' },
  { key: 'organise', code: 'B' },
  { key: 'calculate', code: 'C' },
  { key: 'automate', code: 'D' },
  { key: 'publish', code: 'E' },
]

const num = (n: number) => `F-${String(n).padStart(2, '0')}`

export function renderFeatures(ctx: Ctx): string {
  const { t, c } = ctx
  let n = 0
  const groups = GROUPS.map((g) => {
    const items = c.features.filter((f) => f.group === g.key)
    const first = n + 1
    const cells = items
      .map((f) => {
        n++
        return `
        <li class="plac" data-feature="${f.key}" data-reveal>
          <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
          <p class="lbl plac-idx"><span>${num(n)}</span><span class="plac-code-sm" aria-hidden="true">${esc(f.code)}</span></p>
          <div class="plac-art" aria-hidden="true"><span class="plac-code">${esc(f.code)}</span></div>
          <h4 class="plac-h">${esc(f.title)}</h4>
          <p class="plac-p">${esc(f.text)}</p>
        </li>`
      })
      .join('')
    return `
    <div class="pgroup" role="group" aria-labelledby="pg-${g.key}">
      <h3 id="pg-${g.key}" class="lbl pgroup-h"><span class="pgroup-code" aria-hidden="true">${g.code}</span><span class="pgroup-name">${esc(t(`features.g.${g.key}`))}</span><span class="pgroup-range" aria-hidden="true">${num(first)} — ${num(n)}</span></h3>
      <ul class="placards">${cells}</ul>
    </div>`
  }).join('')
  const extras = c.extras.map((x) => `<li>${esc(x)}</li>`).join('')
  return `
<section id="features" class="sec sec-features" data-tone="paper" aria-labelledby="features-h">
  <div class="wrap">
    ${sectionHead('features', t('features.label'), t('features.title'), t('features.lead'))}
    <div class="pgroups">${groups}</div>
    <div class="extras" data-reveal>
      <h3 class="lbl extras-h"><span class="led" aria-hidden="true"></span>${esc(t('features.extras'))}</h3>
      <ul class="extras-list">${extras}</ul>
    </div>
  </div>
</section>`
}

/* ------------------------------------------------------------------ */
/* Generated 3D icons (public/assets/icons/manifest.json)               */
/* ------------------------------------------------------------------ */

const KEYWORDS: Record<FeatureKey, string[]> = {
  editor: ['editor', 'block', 'blocks', 'write', 'text', 'pen', 'doc', 'page'],
  ai: ['ai', 'claude', 'assistant', 'brain', 'llm'],
  history: ['history', 'version', 'versions', 'clock', 'time', 'rewind'],
  graph: ['graph', 'network', 'map', 'node', 'nodes'],
  databases: ['database', 'databases', 'db', 'table', 'data'],
  structure: ['kanban', 'board', 'grid', 'tree', 'nest'],
  agenda: ['calendar', 'agenda', 'date', 'schedule'],
  palette: ['search', 'command', 'palette', 'find', 'magnifier'],
  automations: ['automation', 'automations', 'webhook', 'gear', 'gears', 'workflow'],
  forms: ['form', 'forms', 'template', 'templates', 'sheet'],
  buttons: ['button', 'buttons', 'key', 'keycap', 'command'],
  autofill: ['code', 'formula', 'formulas', 'calculator', 'fill'],
  website: ['publish', 'website', 'site', 'web', 'send'],
  share: ['lock', 'password', 'private', 'secure', 'padlock'],
  import: ['import', 'migrate', 'inbox', 'upload', 'box'],
  clipper: ['sync', 'link', 'links', 'chain', 'clip'],
  sheets: ['sheet', 'spreadsheet', 'grid', 'cells'],
  functions: ['fx', 'function', 'tree', 'keys'],
  charts: ['chart', 'bars', 'graph', 'plot'],
  formulas: ['adder', 'sum', 'rollup', 'calculator'],
}

/** Hand-picked art per feature (manifest `name`); keyword matching is only the fallback. */
const PREFERRED: Partial<Record<FeatureKey, string>> = {
  editor: 'blocks',
  ai: 'ai',
  history: 'history', // a cassette: rewind
  graph: 'graph',
  databases: 'database',
  structure: 'kanban', // cards on a grid: nested rows
  agenda: 'calendar',
  palette: 'search',
  automations: 'automation',
  forms: 'templates', // a sheet with an orange field: a form
  buttons: 'command', // a keycap: one press
  autofill: 'code', // a calculator: it fills in the numbers
  website: 'publish', // a paper plane: send it out
  share: 'lock',
  import: 'import',
  clipper: 'sync', // two chain links: save a link
  sheets: 'sheet', // a slab of cells with one orange cell
  functions: 'fx', // a tree of keys: a formula built by clicking
  charts: 'chart',
  formulas: 'adder', // a mechanical adding machine
}

interface IconRef {
  name: string
  src: string
  words: Set<string>
}

function toRef(raw: unknown, keyHint = ''): IconRef | null {
  let src = ''
  const words: string[] = [keyHint]
  if (typeof raw === 'string') src = raw
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    src = String(o.webp ?? o.file ?? o.src ?? o.path ?? o.url ?? o.image ?? o.png ?? '')
    for (const k of ['key', 'id', 'name', 'slug', 'title', 'label', 'feature', 'use', 'usage', 'category']) {
      if (typeof o[k] === 'string') words.push(o[k] as string)
    }
    for (const k of ['tags', 'keywords', 'features']) {
      if (Array.isArray(o[k])) words.push(...(o[k] as unknown[]).filter((x): x is string => typeof x === 'string'))
    }
  }
  if (!src || !/\.(webp|png|jpe?g|avif|svg)(\?|$)/i.test(src)) return null
  words.push(src.split('/').pop() ?? '')
  const set = new Set<string>()
  for (const w of words) for (const p of w.toLowerCase().split(/[^a-z0-9]+/)) if (p) set.add(p)
  let url = src
  if (!/^(https?:|data:|\/)/.test(src)) url = src.includes('assets/') ? asset(src.slice(src.indexOf('assets/'))) : asset(`assets/icons/${src}`)
  const name = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).name === 'string' ? String((raw as Record<string, unknown>).name) : keyHint
  return { name, src: url, words: set }
}

function parseManifest(json: unknown): IconRef[] {
  const out: IconRef[] = []
  const take = (list: unknown[]) => list.forEach((e) => { const r = toRef(e); if (r) out.push(r) })
  if (Array.isArray(json)) take(json)
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    const list = o.icons ?? o.items ?? o.assets ?? o.files
    if (Array.isArray(list)) take(list)
    else {
      const map = (list && typeof list === 'object' ? list : o) as Record<string, unknown>
      for (const [k, v] of Object.entries(map)) {
        const r = toRef(v, k)
        if (r) out.push(r)
      }
    }
  }
  return out
}

/** Fetch the icon manifest and swap the "element code" art for real icons where one matches. */
export async function loadFeatureIcons(root: HTMLElement): Promise<void> {
  let refs: IconRef[] = []
  try {
    const res = await fetch(asset('assets/icons/manifest.json'), { cache: 'force-cache' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return
    refs = parseManifest(await res.json())
  } catch {
    return
  }
  if (!refs.length) return
  const used = new Set<IconRef>()
  root.querySelectorAll<HTMLElement>('.plac[data-feature]').forEach((cell) => {
    const key = cell.dataset.feature as FeatureKey
    const want = PREFERRED[key]
    let best: IconRef | null = (want && refs.find((r) => r.name === want && !used.has(r))) || null
    let bestScore = best ? Infinity : 0
    for (const r of best ? [] : refs) {
      if (used.has(r)) continue
      let score = r.words.has(key) ? 3 : 0
      for (const k of KEYWORDS[key] ?? []) if (r.words.has(k)) score += 1
      if (score > bestScore) {
        best = r
        bestScore = score
      }
    }
    if (!best) return
    used.add(best)
    const art = cell.querySelector<HTMLElement>('.plac-art')
    if (!art) return
    const img = new Image()
    img.className = 'plac-icon'
    img.alt = ''
    img.width = 112
    img.height = 112
    img.decoding = 'async'
    img.loading = 'lazy'
    img.onload = () => art.classList.add('has-icon')
    img.onerror = () => img.remove()
    img.src = best.src
    art.appendChild(img)
  })
}
