import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Code, Eye } from 'lucide-react'
import { useT } from '../../i18n'

type MermaidApi = typeof import('mermaid').default
let mermaidPromise: Promise<MermaidApi> | null = null
let seq = 0

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
}

async function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  const mermaid = await mermaidPromise
  const ink = cssVar('--ink')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
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

export function MermaidDiagram({ code }: { code: string }) {
  const t = useT()
  const theme = useThemeKey()
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
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
      } catch (err) {
        if (!alive) return
        setError(String((err as Error)?.message ?? err).split('\n').slice(0, 3).join('\n'))
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
  }, [code, theme])
  return (
    <div className="mermaid-view__canvas" aria-busy={busy}>
      <div ref={ref} className="mermaid-view__svg" style={{ display: error ? 'none' : undefined }} />
      {busy && !error && <span className="label faint">{t('common.loading')}</span>}
      {error && <pre className="mermaid-view__error">{error}</pre>}
    </div>
  )
}

export function MermaidView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
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
                editor.commands.focus()
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
