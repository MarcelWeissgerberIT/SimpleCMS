/**
 * Icon picker panel (inside the /icon popover and the change popover of an inline icon):
 * tab "Objects" = the generated ceramic set, tab "Glyphs" = lucide glyphs with an optional colour.
 * Keyboard first: the search field keeps focus, arrows move through the grid, ↵ picks, Tab reaches
 * the tabs and the colour row (arrows inside each).
 */
import { createElement, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { LucideIconNode } from 'lucide-react'
import { COLOR_NAMES, type ColorName } from '../../store/types'
import { resolveAssetUrl } from '../../lib/files'
import { loadIconManifest, type IconManifestEntry } from '../../ui/IconPicker'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useLang, useT } from '../../i18n'
import { iconAssetPath, type IconAttrs, type IconKind } from '../schema/icon'
import { loadGlyphs, loadedGlyphs, subscribeGlyphs, svgAttrs } from './glyphs'
import { objectLabel, objectSearchText } from './objects'

const TAB_KEY = 'one.inlineIconTab'
const COLS: Record<IconKind, number> = { asset: 6, lucide: 8 }
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** The glyph registry, loaded on first use. */
function useGlyphs() {
  return useSyncExternalStore(
    (cb) => {
      const off = subscribeGlyphs(cb)
      if (!loadedGlyphs()) void loadGlyphs().catch(() => {})
      return off
    },
    loadedGlyphs,
    loadedGlyphs,
  )
}

function useManifest(): IconManifestEntry[] | null {
  const [list, setList] = useState<IconManifestEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadIconManifest().then((l) => alive && setList(l))
    return () => {
      alive = false
    }
  }, [])
  return list
}

/** A lucide glyph drawn from its raw nodes (the picker's grid and preview). */
export function Glyph({ node, size = 18 }: { node: LucideIconNode[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...svgAttrs(attrs) }))}
    </svg>
  )
}

interface Item {
  key: string
  attrs: IconAttrs
  label: string
  code: string
  /** normalised search text */
  text: string
}

/** Rank: exact name → name prefix → word prefix → anywhere; every query word must match. */
function search(items: Item[], query: string): Item[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return items
  const scored: Array<{ item: Item; score: number; i: number }> = []
  items.forEach((item, i) => {
    if (!words.every((w) => item.text.includes(w))) return
    const q = words[0]
    const name = item.attrs.name
    const score = name === q ? 0 : name.startsWith(q) ? 1 : item.text.split(' ').some((w) => w.startsWith(q)) ? 2 : 3
    scored.push({ item, score, i })
  })
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.item)
}

export interface IconPanelProps {
  /** The icon being changed (edit mode) — its tab and colour are preselected. */
  current?: IconAttrs | null
  onPick: (attrs: IconAttrs) => void
  /** Edit mode: a new colour applies right away. */
  onColor?: (color: ColorName | null) => void
  onRemove?: () => void
}

export function IconPanel({ current, onPick, onColor, onRemove }: IconPanelProps) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const [tab, setTabState] = useState<IconKind>(() => current?.kind ?? (safeLocalGet(TAB_KEY) === 'lucide' ? 'lucide' : 'asset'))
  const [query, setQuery] = useState('')
  const [color, setColorState] = useState<ColorName | null>(current?.kind === 'lucide' ? current.color : null)
  const [active, setActive] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const manifest = useManifest()
  const glyphs = useGlyphs()

  const setTab = (next: IconKind) => {
    setTabState(next)
    setActive(0)
    if (!current) safeLocalSet(TAB_KEY, next)
  }
  const setColor = (c: ColorName | null) => {
    setColorState(c)
    onColor?.(c)
  }

  const objects = useMemo<Item[]>(
    () =>
      (manifest ?? []).map((m) => ({
        key: `asset:${m.name}`,
        attrs: { kind: 'asset', name: m.name, color: null },
        label: objectLabel(m.name, lang),
        code: `${m.name}.webp`,
        text: norm(objectSearchText(m.name, `${m.label} ${m.label_de ?? ''}`)),
      })),
    [manifest, lang],
  )
  const glyphItems = useMemo<Item[]>(
    () =>
      (glyphs?.GLYPHS ?? []).map((g) => ({
        key: `lucide:${g.name}`,
        attrs: { kind: 'lucide', name: g.name, color: null },
        label: g.name.replace(/-/g, ' '),
        code: `:${g.name}:`,
        text: norm(g.words),
      })),
    [glyphs],
  )
  const all = tab === 'asset' ? objects : glyphItems
  const shown = useMemo(() => search(all, query), [all, query])
  const loading = tab === 'asset' ? !manifest : !glyphs
  const cols = COLS[tab]

  // start on the current icon (edit mode) once the list is there; else on the first match
  useEffect(() => {
    const i = current && current.kind === tab && !query ? shown.findIndex((s) => s.attrs.name === current.name) : -1
    setActive(Math.max(0, i))
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (item: Item | undefined) => {
    if (!item) return
    onPick(item.attrs.kind === 'lucide' ? { ...item.attrs, color } : item.attrs)
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const n = shown.length
    const move = (d: number) => {
      e.preventDefault()
      if (n) setActive((a) => Math.min(n - 1, Math.max(0, a + d)))
    }
    // the arrows belong to the grid (like the emoji picker); the query is short enough to retype
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(cols)
    else if (e.key === 'ArrowUp') move(-cols)
    else if (e.key === 'Enter') {
      e.preventDefault()
      pick(shown[active])
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next: IconKind = tab === 'asset' ? 'lucide' : 'asset'
    setTab(next)
    e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }

  const onColorKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = COLOR_NAMES.indexOf(color ?? 'default')
    const next = COLOR_NAMES[(i + (e.key === 'ArrowRight' ? 1 : -1) + COLOR_NAMES.length) % COLOR_NAMES.length]
    setColor(next === 'default' ? null : next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)?.focus()
  }

  const cur = shown[active]
  const tabs: Array<[IconKind, string]> = [
    ['asset', t('editor.iconPicker.objects')],
    ['lucide', t('editor.iconPicker.glyphs')],
  ]
  const listId = `${uid}-grid`
  return (
    <div className="ipk" data-tab={tab}>
      <div className="ipk__head">
        <div className="ipk__tabs" role="tablist" aria-label={t(current ? 'editor.iconPicker.change' : 'editor.iconPicker.title')}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-tab={id}
              className="ipk__tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => {
                setTab(id)
                searchRef.current?.focus()
              }}
              onKeyDown={onTabKey}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ipk__count label">{loading ? '' : t(tab === 'asset' ? 'editor.iconPicker.countObjects' : 'editor.iconPicker.countGlyphs', { count: shown.length })}</span>
        {onRemove && (
          <button type="button" className="icon-btn icon-btn--sm" title={t('editor.iconPicker.remove')} aria-label={t('editor.iconPicker.remove')} onClick={onRemove}>
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div className="ipk__search">
        <input
          ref={searchRef}
          className="input"
          type="search"
          value={query}
          placeholder={t('editor.iconPicker.search')}
          aria-label={t('editor.iconPicker.search')}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={cur ? `${uid}-${cur.key}` : undefined}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      {tab === 'lucide' && (
        <div className="ipk__colors" role="radiogroup" aria-label={t('editor.iconPicker.color')} onKeyDown={onColorKey}>
          <span className="label">{t('editor.iconPicker.color')}</span>
          {COLOR_NAMES.map((c) => {
            const on = (color ?? 'default') === c
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-color={c}
                className="ipk__swatch"
                title={c === 'default' ? t('editor.iconPicker.mono') : t(`color.${c}`)}
                aria-label={c === 'default' ? t('editor.iconPicker.mono') : t(`color.${c}`)}
                style={{ color: `var(--c-${c}-text)` }}
                onClick={() => setColor(c === 'default' ? null : c)}
              />
            )
          })}
        </div>
      )}
      <div
        ref={gridRef}
        id={listId}
        role="listbox"
        aria-label={tab === 'asset' ? t('editor.iconPicker.objects') : t('editor.iconPicker.glyphs')}
        className={`ipk__grid ipk__grid--${tab}`}
        style={tab === 'lucide' && color ? { color: `var(--c-${color}-text)` } : undefined}
        onMouseDown={(e) => e.preventDefault()}
      >
        {shown.map((item, i) => (
          <div
            key={item.key}
            id={`${uid}-${item.key}`}
            role="option"
            aria-selected={i === active}
            aria-label={item.label}
            title={item.label}
            data-index={i}
            data-name={item.attrs.name}
            className="ipk__cell"
            onMouseMove={() => i !== active && setActive(i)}
            onClick={() => pick(item)}
          >
            {item.attrs.kind === 'asset' ? (
              <img src={resolveAssetUrl(iconAssetPath(item.attrs.name))} alt="" width={32} height={32} draggable={false} loading="lazy" decoding="async" />
            ) : (
              <Glyph node={glyphs!.GLYPH_BY_NAME.get(item.attrs.name)!.node} />
            )}
          </div>
        ))}
        {loading && <div className="ipk__msg">{t('common.loading')}</div>}
        {!loading && shown.length === 0 && <div className="ipk__msg">{t('editor.iconPicker.empty')}</div>}
      </div>
      <div className="ipk__foot" aria-live="polite">
        {cur ? (
          <>
            <span className="ipk__preview" style={cur.attrs.kind === 'lucide' && color ? { color: `var(--c-${color}-text)` } : undefined}>
              {cur.attrs.kind === 'asset' ? <img src={resolveAssetUrl(iconAssetPath(cur.attrs.name))} alt="" width={22} height={22} /> : <Glyph node={glyphs!.GLYPH_BY_NAME.get(cur.attrs.name)!.node} size={18} />}
            </span>
            <span className="ipk__name">{cur.label}</span>
            <span className="ipk__code mono">{cur.code}</span>
          </>
        ) : (
          <span className="ipk__name faint">—</span>
        )}
        <kbd className="kbd">↵</kbd>
      </div>
    </div>
  )
}
