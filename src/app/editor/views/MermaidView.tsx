import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Code, Eye, RotateCw } from 'lucide-react'
import { useT } from '../../i18n'
import { leaveNodeView } from '../lib/blocks'

type MermaidApi = typeof import('mermaid').default
let mermaidPromise: Promise<MermaidApi> | null = null
let seq = 0

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
}

/** Thrown when the mermaid chunk itself can't be fetched (offline, or a redeploy renamed it). */
class MermaidUnavailable extends Error {}

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

function useThemeKey(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'light'))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

/** A chunk that couldn't be fetched (mermaid itself or one of its lazily loaded diagram modules). */
function isChunkFailure(err: unknown): boolean {
  if (err instanceof MermaidUnavailable) return true
  const msg = String((err as Error)?.message ?? err)
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|NetworkError/i.test(msg)
}

type Unavailable = 'offline' | 'failed'

/** Bumps when the browser comes back online — the cue to retry a failed load. */
function useOnlineTick(active: boolean): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const on = () => setTick((n) => n + 1)
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [active])
  return tick
}

export function MermaidDiagram({ code }: { code: string }) {
  const t = useT()
  const theme = useThemeKey()
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null)
  const [busy, setBusy] = useState(true)
  const retry = useOnlineTick(unavailable === 'offline')
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(async () => {
      if (!code.trim()) {
        if (ref.current) ref.current.innerHTML = ''
        setBusy(false)
        return
      }
      try {
        const mermaid = await loadMermaid()
        const { svg } = await mermaid.render(`one-mermaid-${++seq}`, code)
        if (!alive || !ref.current) return
        ref.current.innerHTML = svg
        setError(null)
        setUnavailable(null)
      } catch (err) {
        if (!alive) return
        if (isChunkFailure(err)) {
          // offline: wait for the connection; online and still failing (flaky network, or a
          // redeploy renamed the chunk): only a reload can fetch it again
          setUnavailable(navigator.onLine === false ? 'offline' : 'failed')
          setError(null)
        } else {
          setUnavailable(null)
          setError(String((err as Error)?.message ?? err).split('\n').slice(0, 3).join('\n'))
        }
        document.querySelectorAll('[id^="done-one-mermaid"], [id^="one-mermaid-"]').forEach((el) => {
          if (!el.closest('.mermaid-view')) el.remove()
        })
      } finally {
        if (alive) setBusy(false)
      }
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [code, theme, retry])
  const failed = !!error || unavailable
  return (
    <div className="mermaid-view__canvas" aria-busy={busy}>
      <div ref={ref} className="mermaid-view__svg" style={{ display: failed ? 'none' : undefined }} />
      {busy && !failed && <span className="label faint">{t('common.loading')}</span>}
      {unavailable && (
        <div className="mermaid-view__offline" role="status">
          <span className="label">
            <span className="led" aria-hidden /> {t(unavailable === 'offline' ? 'editor.mermaid.unavailable' : 'editor.mermaid.failed')}
          </span>
          <span className="mermaid-view__offline-hint">{t(unavailable === 'offline' ? 'editor.mermaid.unavailableHint' : 'editor.mermaid.failedHint')}</span>
          {unavailable === 'failed' && (
            <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
              <RotateCw size={13} /> {t('editor.mermaid.reload')}
            </button>
          )}
        </div>
      )}
      {error && <pre className="mermaid-view__error">{error}</pre>}
    </div>
  )
}

export function MermaidView({ node, updateAttributes, selected, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const code = String(node.attrs.code ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  useEffect(() => setDraft(code), [code])
  useEffect(() => {
    if (!editing || draft === code) return
    const id = window.setTimeout(() => updateAttributes({ code: draft }), 350)
    return () => window.clearTimeout(id)
  }, [draft, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NodeViewWrapper className={`mermaid-view${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`} data-type="mermaid" contentEditable={false}>
      <div className="mermaid-view__bar">
        <span className="label">{t('editor.mermaid.label')}</span>
        {editor.isEditable && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? <Eye size={13} /> : <Code size={13} />}
            {editing ? t('editor.mermaid.preview') : t('editor.mermaid.edit')}
          </button>
        )}
      </div>
      <div className="mermaid-view__body">
        {editing && (
          <textarea
            className="mermaid-view__code"
            value={draft}
            spellCheck={false}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault()
                updateAttributes({ code: draft })
                setEditing(false)
                // back to the document (focus() alone would restore a stale caret)
                leaveNodeView(editor, getPos(), e.key === 'Escape' ? 'escape' : 'enter')
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: s, selectionEnd: en } = el
                setDraft(draft.slice(0, s) + '  ' + draft.slice(en))
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
              }
            }}
          />
        )}
        <MermaidDiagram code={editing ? draft : code} />
      </div>
    </NodeViewWrapper>
  )
}
