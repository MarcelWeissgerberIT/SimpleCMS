/**
 * Mermaid for the editor: the lazily loaded module (themed with the app's tokens on every render, so a theme
 * switch draws in the new colours), one render → SVG markup, and the diagram viewer for a block's code.
 */
import { t } from '../../i18n'
import { openDiagramViewer } from '../../ui/viewer'

type MermaidApi = typeof import('mermaid').default
let mermaidPromise: Promise<MermaidApi> | null = null
let seq = 0

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
}

/** Thrown when the mermaid chunk itself can't be fetched (offline, or a redeploy renamed it). */
export class MermaidUnavailable extends Error {}

/** Does the offline service worker hold the mermaid chunk (so an offline import still works)? */
async function cachedForOffline(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    for (const key of await caches.keys()) {
      const reqs = await (await caches.open(key)).keys()
      if (reqs.some((r) => /\/mermaid\.core-[\w-]+\.js$/.test(new URL(r.url).pathname))) return true
    }
  } catch {
    /* no cache storage (private mode …) */
  }
  return false
}

async function loadMermaid(): Promise<MermaidApi> {
  // Browsers remember a failed module fetch for the rest of the session (a later import() of the
  // same chunk fails without touching the network). So while offline, don't even try unless the
  // service worker can serve it — then the first import after "online" still works.
  if (!mermaidPromise && navigator.onLine === false && !(await cachedForOffline())) throw new MermaidUnavailable('offline')
  // never cache a failed import: the next render retries
  mermaidPromise ??= import('mermaid')
    .then((m) => m.default)
    .catch((err) => {
      mermaidPromise = null
      throw new MermaidUnavailable(String((err as Error)?.message ?? err))
    })
  const mermaid = await mermaidPromise
  const ink = cssVar('--ink')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // mermaid 12 defaults to ELK (~450 kB gz + heavy CPU even for 5 nodes); dagre is bundled and fast
    layout: 'dagre',
    theme: 'base',
    fontFamily: 'Archivo Variable, Archivo, system-ui, sans-serif',
    themeVariables: {
      fontSize: '14px',
      background: cssVar('--surface'),
      primaryColor: cssVar('--surface'),
      primaryTextColor: ink,
      primaryBorderColor: ink,
      secondaryColor: cssVar('--surface-2'),
      tertiaryColor: cssVar('--surface-2'),
      lineColor: cssVar('--ink-2'),
      textColor: ink,
      mainBkg: cssVar('--surface'),
      nodeBorder: ink,
      clusterBkg: cssVar('--surface-2'),
      clusterBorder: cssVar('--ink-3'),
      edgeLabelBackground: cssVar('--surface'),
      noteBkgColor: cssVar('--c-yellow-bg'),
      noteTextColor: ink,
      noteBorderColor: cssVar('--ink-3'),
      actorBkg: cssVar('--surface'),
      actorBorder: ink,
      signalColor: ink,
      signalTextColor: ink,
      labelBoxBkgColor: cssVar('--surface-2'),
      activationBkgColor: cssVar('--signal-wash'),
      git0: cssVar('--signal'),
      pie1: cssVar('--signal'),
    },
  })
  return mermaid
}

/** A chunk that couldn't be fetched (mermaid itself or one of its lazily loaded diagram modules). */
export function isChunkFailure(err: unknown): boolean {
  if (err instanceof MermaidUnavailable) return true
  const msg = String((err as Error)?.message ?? err)
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|NetworkError/i.test(msg)
}

/** The diagram as SVG markup in the current theme's colours (the root <svg> carries a unique id). */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await loadMermaid()
  try {
    const { svg } = await mermaid.render(`one-mermaid-${++seq}`, code)
    return svg
  } catch (err) {
    // a failed render leaves its scratch elements in <body>; the blocks' and the viewer's own SVGs stay
    document.querySelectorAll('[id^="done-one-mermaid"], [id^="one-mermaid-"]').forEach((el) => {
      if (!el.closest('.mermaid-view, .dv')) el.remove()
    })
    throw err
  }
}

const KINDS: Record<string, string> = {
  flowchart: 'flowchart',
  'flowchart-elk': 'flowchart',
  graph: 'flowchart',
  sequencediagram: 'sequence',
  classdiagram: 'class',
  'classdiagram-v2': 'class',
  statediagram: 'state',
  'statediagram-v2': 'state',
  erdiagram: 'er',
  journey: 'journey',
  gantt: 'gantt',
  pie: 'pie',
  quadrantchart: 'quadrant',
  requirementdiagram: 'requirement',
  gitgraph: 'git',
  c4context: 'c4',
  c4container: 'c4',
  c4component: 'c4',
  c4dynamic: 'c4',
  c4deployment: 'c4',
  mindmap: 'mindmap',
  timeline: 'timeline',
  sankey: 'sankey',
  'sankey-beta': 'sankey',
  xychart: 'xy',
  'xychart-beta': 'xy',
  block: 'block',
  'block-beta': 'block',
  packet: 'packet',
  'packet-beta': 'packet',
  kanban: 'kanban',
  architecture: 'architecture',
  'architecture-beta': 'architecture',
  radar: 'radar',
  'radar-beta': 'radar',
  treemap: 'treemap',
  'treemap-beta': 'treemap',
}

/** The code without its front matter (--- … ---). */
function body(code: string): { head: string; rest: string } {
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(code)
  return m ? { head: m[1], rest: code.slice(m[0].length) } : { head: '', rest: code }
}

/** The diagram type by its first keyword ('flowchart', 'sequence' …), null when unknown. */
export function mermaidKind(code: string): string | null {
  const first = body(code)
    .rest.split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%'))
  const word = first?.split(/[\s:;{]+/)[0]?.toLowerCase() ?? ''
  return KINDS[word] ?? null
}

/** The diagram's own title: front matter `title:`, else a `title …` line (pie, gantt, timeline, xychart …). */
export function mermaidTitle(code: string): string {
  const { head, rest } = body(code)
  const front = /^\s*title\s*:\s*(.+?)\s*$/m.exec(head)?.[1]
  const line = /^\s*(?:pie\s+(?:showData\s+)?)?title\s+(.+?)\s*$/im.exec(rest)?.[1]
  return (front ?? line ?? '').replace(/^["']|["']$/g, '').slice(0, 120)
}

function fileBase(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase() || 'diagram'
  )
}

/** Open a Mermaid diagram in the viewer (vector, zoom, minimap, Download SVG). */
export function openMermaidViewer(code: string, from?: HTMLElement | null): void {
  const kind = mermaidKind(code)
  const title = mermaidTitle(code)
  openDiagramViewer(
    {
      kind: 'diagram',
      type: t(`editor.mermaid.kind.${kind ?? 'other'}`),
      title: title || undefined,
      themed: true,
      className: 'dv-svg--mermaid',
      fileName: `${fileBase(title || kind || 'diagram')}.svg`,
      render: () => renderMermaid(code),
    },
    { from },
  )
}
