import type { Ctx } from '../context'
import type { FeatureKey } from '../messages'
import { asset, esc } from '../util'
import { sectionHead } from './head'

export function renderFeatures(ctx: Ctx): string {
  const { t, c } = ctx
  const cells = c.features
    .map(
      (f, i) => `
      <li class="plac" data-feature="${f.key}" data-reveal>
        <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
        <p class="lbl plac-idx"><span>F-${String(i + 1).padStart(2, '0')}</span><span class="plac-code-sm" aria-hidden="true">${esc(f.code)}</span></p>
        <div class="plac-art ${f.key === 'i18n' ? 'has-icon' : ''}" aria-hidden="true">${
          f.key === 'i18n'
            ? '<span class="plac-keys tone-print"><span>EN</span><span>DE</span></span>'
            : `<span class="plac-code">${esc(f.code)}</span>`
        }</div>
        <h3 class="plac-h">${esc(f.title)}</h3>
        <p class="plac-p">${esc(f.text)}</p>
      </li>`,
    )
    .join('')
  return `
<section id="features" class="sec sec-features" data-tone="paper" aria-labelledby="features-h">
  <div class="wrap">
    ${sectionHead('features', t('features.label'), t('features.title'), t('features.lead'))}
    <ul class="placards">${cells}</ul>
  </div>
</section>`
}

/* ------------------------------------------------------------------ */
/* Generated 3D icons (public/assets/icons/manifest.json)               */
/* ------------------------------------------------------------------ */

const KEYWORDS: Record<FeatureKey, string[]> = {
  editor: ['editor', 'block', 'write', 'text', 'pen', 'pencil', 'doc', 'page'],
  databases: ['database', 'databases', 'db', 'table', 'data', 'grid'],
  ai: ['ai', 'claude', 'assistant', 'brain', 'robot', 'llm'],
  automations: ['automation', 'automations', 'webhook', 'gear', 'gears', 'bolt', 'zap', 'flow', 'workflow'],
  import: ['import', 'notion', 'migrate', 'migration', 'box', 'inbox', 'upload'],
  graph: ['graph', 'network', 'map', 'node', 'nodes', 'constellation'],
  history: ['history', 'version', 'versions', 'clock', 'time', 'rewind', 'hourglass'],
  share: ['share', 'link', 'links', 'send', 'chain'],
  present: ['present', 'presentation', 'slide', 'slides', 'projector', 'screen'],
  palette: ['command', 'palette', 'keyboard', 'search', 'key', 'cmd', 'keycap'],
  private: ['local', 'private', 'privacy', 'lock', 'padlock', 'shield', 'secure', 'safe', 'vault'],
  templates: ['template', 'templates', 'stencil', 'blueprint', 'layout'],
  panes: ['pane', 'panes', 'stack', 'stacked', 'layers', 'window', 'windows'],
  focus: ['focus', 'target', 'zen', 'lens', 'eye'],
  offline: ['offline', 'plug', 'unplugged', 'airplane', 'wifi', 'signal', 'battery'],
  i18n: ['language', 'languages', 'lang', 'globe', 'i18n', 'translate', 'world', 'bilingual'],
}

/** Hand-picked art per feature (manifest `name`); keyword matching is only the fallback. */
const PREFERRED: Partial<Record<FeatureKey, string>> = {
  editor: 'blocks',
  databases: 'database',
  ai: 'ai',
  automations: 'automation',
  import: 'import',
  graph: 'graph',
  history: 'history', // a cassette: rewind
  share: 'sync', // two chain links: a link
  present: 'present',
  palette: 'command',
  private: 'lock',
  templates: 'templates',
  panes: 'split',
  focus: 'focus',
  offline: 'publish', // a paper plane: airplane mode
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
