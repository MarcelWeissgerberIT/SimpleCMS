/**
 * Graph view (route #/graph): every live page as a node — databases as squares, rows optional —
 * hierarchy as hairlines, links & mentions in signal orange. Canvas + d3-force (see renderer.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Minus, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { Switch, Led, Kbd } from '../../ui/controls'
import { Tooltip } from '../../ui/Tooltip'
import { buildGraph, type GNode, type GraphOptions } from './model'
import { GraphRenderer } from './renderer'
import './graph.css'

const PREFS_KEY = 'one.graph.prefs'
const DEFAULTS: GraphOptions = { hierarchy: true, rows: false, orphans: true }

function loadPrefs(): GraphOptions {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function GraphView() {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const currentId = useWorkspace((s) => s.settings.lastPageId)
  const [opts, setOpts] = useState<GraphOptions>(loadPrefs)
  const untitled = t('common.untitled')
  const data = useMemo(() => buildGraph(pages, databases, opts, untitled), [pages, databases, opts, untitled])

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const engine = useRef<GraphRenderer | null>(null)
  const [state, setState] = useState({ settled: false, zoom: 1, alpha: 1 })
  const [hover, setHover] = useState<{ node: GNode; x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    const r = new GraphRenderer(canvasRef.current!, wrapRef.current!, {
      onHover: (node, x, y) => setHover(node ? { node, x, y } : null),
      onOpen: (node, ev) => {
        if (ev.shiftKey || ev.altKey) useUI.getState().openPane(node.id)
        else openPage(node.id)
      },
      onState: setState,
    })
    engine.current = r
    return () => {
      r.destroy()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.setData(data.nodes, data.edges)
  }, [data])

  useEffect(() => {
    if (!engine.current) return
    engine.current.currentId = currentId
    engine.current.invalidate()
  }, [currentId])

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(opts))
    } catch {
      /* ignore */
    }
  }, [opts])

  // keyboard: "/" search, F fit, +/- zoom, Esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')
      if (typing || e.metaKey || e.ctrlKey || e.altKey || useUI.getState().modal || useUI.getState().paletteOpen) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'f' || e.key === 'F') engine.current?.fit()
      else if (e.key === '+' || e.key === '=') engine.current?.zoomBy(1.3)
      else if (e.key === '-') engine.current?.zoomBy(1 / 1.3)
      else if (e.key === 'Escape' && focused) {
        engine.current?.clearFocus()
        setFocused(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return data.nodes
      .filter((n) => n.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) || b.degree - a.degree)
      .slice(0, 7)
  }, [query, data])

  useEffect(() => setActive(0), [query])

  const focusNode = (n: GNode) => {
    engine.current?.focusNode(n.id)
    setFocused(n.id)
    setQuery('')
    searchRef.current?.blur()
  }

  const linkCount = data.edges.filter((e) => e.kind === 'link').length
  const treeCount = data.edges.length - linkCount
  const toggle = (key: keyof GraphOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }))
  const focusedNode = focused ? data.nodes.find((n) => n.id === focused) : undefined

  return (
    <div className="graph" ref={wrapRef}>
      <canvas ref={canvasRef} className="graph__canvas" role="img" aria-label={t('features.graph.aria', { nodes: data.nodes.length, edges: data.edges.length })} />

      {/* ---------- top HUD ---------- */}
      <div className="graph-hud graph-hud--top">
        <div className="graph-plate">
          <span className="label graph-plate__n">§ 05</span>
          <span className="graph-plate__title">{t('features.graph.title')}</span>
        </div>

        <div className="graph-search" role="combobox" aria-expanded={results.length > 0} aria-haspopup="listbox">
          <Search size={14} className="graph-search__icon" />
          <input
            ref={searchRef}
            className="graph-search__input"
            value={query}
            placeholder={t('features.graph.search')}
            aria-label={t('features.graph.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(results.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && results[active]) {
                e.preventDefault()
                focusNode(results[active])
              } else if (e.key === 'Escape') {
                setQuery('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {!query && <Kbd>/</Kbd>}
          {results.length > 0 && (
            <ul className="graph-results" role="listbox">
              {results.map((n, i) => (
                <li key={n.id} role="option" aria-selected={i === active}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => focusNode(n)} onMouseEnter={() => setActive(i)}>
                    <span className={`graph-glyph graph-glyph--${n.kind}`} aria-hidden />
                    <span className="graph-results__title">{n.title}</span>
                    <span className="graph-results__deg mono">{String(n.degree).padStart(2, '0')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query && results.length === 0 && <div className="graph-results graph-results--empty mono">{t('features.graph.noMatch')}</div>}
        </div>

        <div className="graph-panel" role="group" aria-label={t('features.graph.layers')}>
          <label className="graph-toggle">
            <Switch checked={opts.hierarchy} onChange={() => toggle('hierarchy')} label={t('features.graph.hierarchy')} />
            <span>{t('features.graph.hierarchy')}</span>
          </label>
          <label className="graph-toggle">
            <Switch checked={opts.rows} onChange={() => toggle('rows')} label={t('features.graph.rows')} />
            <span>{t('features.graph.rows')}</span>
          </label>
          <label className="graph-toggle">
            <Switch checked={opts.orphans} onChange={() => toggle('orphans')} label={t('features.graph.orphans')} />
            <span>{t('features.graph.orphans')}</span>
          </label>
          <span className="graph-panel__sep" />
          <Tooltip label={t('features.graph.zoomOut')} shortcut="−">
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => engine.current?.zoomBy(1 / 1.3)}>
              <Minus size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.graph.zoomIn')} shortcut="+">
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => engine.current?.zoomBy(1.3)}>
              <Plus size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.graph.fit')} shortcut="F">
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => engine.current?.fit()}>
              <Crosshair size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('features.graph.reheat')}>
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => engine.current?.reheat()}>
              <RefreshCw size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {focusedNode && (
        <div className="graph-focus">
          <span className="label">{t('features.graph.focus')}</span>
          <button type="button" className="graph-focus__open" onClick={() => openPage(focusedNode.id)}>
            {focusedNode.title} ↗
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={t('common.close')}
            onClick={() => {
              engine.current?.clearFocus()
              setFocused(null)
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* ---------- hover tooltip ---------- */}
      {hover && (
        <div className="graph-tip" style={{ left: hover.x, top: hover.y }} role="tooltip">
          <div className="graph-tip__title">{hover.node.title}</div>
          <div className="graph-tip__meta mono">
            {t(`features.graph.kind.${hover.node.kind}`)} · {t('features.graph.nLinks', { n: hover.node.links })} · {t('features.graph.nChildren', { n: hover.node.children })}
          </div>
          <div className="graph-tip__hint">{t('features.graph.tipHint')}</div>
        </div>
      )}

      {/* ---------- bottom HUD ---------- */}
      <div className="graph-hud graph-hud--bottom">
        <div className="graph-legend" aria-label={t('features.graph.legend')}>
          <span className="graph-legend__item">
            <span className="graph-glyph graph-glyph--page" /> {t('features.graph.kind.page')}
          </span>
          <span className="graph-legend__item">
            <span className="graph-glyph graph-glyph--database" /> {t('features.graph.kind.database')}
          </span>
          {opts.rows && (
            <span className="graph-legend__item">
              <span className="graph-glyph graph-glyph--row" /> {t('features.graph.kind.row')}
            </span>
          )}
          <span className="graph-legend__item">
            <span className="graph-line graph-line--tree" /> {t('features.graph.edge.tree')}
          </span>
          <span className="graph-legend__item">
            <span className="graph-line graph-line--link" /> {t('features.graph.edge.link')}
          </span>
          <span className="graph-legend__item">
            <span className="graph-glyph graph-glyph--here" /> {t('features.graph.here')}
          </span>
        </div>
        <div className="graph-readout mono" aria-live="off">
          <span>
            <b>{String(data.nodes.length).padStart(3, '0')}</b> {t('features.graph.nodes')}
          </span>
          <span>
            <b>{String(linkCount).padStart(3, '0')}</b> {t('features.graph.links')}
          </span>
          <span>
            <b>{String(treeCount).padStart(3, '0')}</b> {t('features.graph.tree')}
          </span>
          <span>
            {t('features.graph.zoom')} <b>{Math.round(state.zoom * 100)}%</b>
          </span>
          <span className="graph-readout__sim">
            <Led state={state.settled ? 'ok' : 'on'} /> {state.settled ? t('features.graph.settled') : <span className="graph-readout__alpha">α {state.alpha.toFixed(3)}</span>}
          </span>
        </div>
      </div>

      {data.nodes.length === 0 && (
        <div className="graph-empty">
          <div className="label">{t('features.graph.emptyLabel')}</div>
          <p>{t('features.graph.empty')}</p>
        </div>
      )}
    </div>
  )
}
