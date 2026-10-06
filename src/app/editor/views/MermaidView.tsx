import { useEffect, useRef, useState, type RefObject } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Code, Eye, Maximize2, RotateCw } from 'lucide-react'
import { useT } from '../../i18n'
import { leaveNodeView } from '../lib/blocks'
import { useViewerAllowed, viewerAllowed } from '../../ui/viewer'
import { isChunkFailure, openMermaidViewer, renderMermaid } from '../lib/mermaid'

function useThemeKey(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'light'))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
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

/** How far the column shrinks the drawn diagram (1 = its own size), null while nothing is drawn. */
function useShownScale(ref: RefObject<HTMLDivElement | null>, drawn: number): number | null {
  const [scale, setScale] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const svg = el.querySelector<SVGSVGElement>(':scope > svg')
      const vb = svg?.viewBox?.baseVal
      const shown = svg?.getBoundingClientRect().width ?? 0
      setScale(svg && vb && vb.width > 0 && shown > 0 ? shown / vb.width : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, drawn])
  return scale
}

export function MermaidDiagram({ code, onOpen }: { code: string; onOpen?: (from: HTMLElement) => void }) {
  const t = useT()
  const theme = useThemeKey()
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null)
  const [busy, setBusy] = useState(true)
  const [drawn, setDrawn] = useState(0)
  const retry = useOnlineTick(unavailable === 'offline')
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(async () => {
      if (!code.trim()) {
        if (ref.current) ref.current.innerHTML = ''
        setBusy(false)
        setDrawn((n) => n + 1)
        return
      }
      try {
        const svg = await renderMermaid(code)
        if (!alive || !ref.current) return
        ref.current.innerHTML = svg
        setError(null)
        setUnavailable(null)
        setDrawn((n) => n + 1)
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
  const scale = useShownScale(ref, drawn)
  // the column shrinks it: say so, and offer the viewer
  const scaled = !failed && !busy && onOpen && scale !== null && scale < 0.95 ? Math.max(1, Math.round(scale * 100)) : null
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
      {scaled !== null && (
        <button type="button" className="mermaid-view__scaled label" data-testid="mermaid-scaled" onClick={(e) => onOpen?.(e.currentTarget)}>
          {t('editor.mermaid.scaled', { pct: scaled })}
        </button>
      )}
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
  const shown = editing ? draft : code
  // no viewer from a slide or a popover's preview
  const allowed = useViewerAllowed(() => (editor.isDestroyed ? null : editor.view.dom))
  const open = (from?: HTMLElement | null) => {
    if (shown.trim()) openMermaidViewer(shown, from)
  }

  return (
    <NodeViewWrapper className={`mermaid-view${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`} data-type="mermaid" contentEditable={false}>
      <div className="mermaid-view__bar">
        <span className="label">{t('editor.mermaid.label')}</span>
        <span className="mermaid-view__tools">
          {allowed && shown.trim() && (
            <button type="button" className="icon-btn icon-btn--sm mermaid-view__open" aria-label={t('ui.viewer.open')} title={t('ui.viewer.open')} aria-haspopup="dialog" data-testid="mermaid-open" onClick={(e) => open(e.currentTarget)}>
              <Maximize2 size={13} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {editor.isEditable && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? <Eye size={13} /> : <Code size={13} />}
              {editing ? t('editor.mermaid.preview') : t('editor.mermaid.edit')}
            </button>
          )}
        </span>
      </div>
      <div
        className="mermaid-view__body"
        onDoubleClick={(e) => {
          // the drawing (not the code field) opens large
          if (editing || (e.target as Element).closest('textarea, button, .mermaid-view__error') || !viewerAllowed(e.currentTarget)) return
          e.preventDefault()
          open()
        }}
      >
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
        <MermaidDiagram code={shown} onOpen={allowed ? open : undefined} />
      </div>
    </NodeViewWrapper>
  )
}
