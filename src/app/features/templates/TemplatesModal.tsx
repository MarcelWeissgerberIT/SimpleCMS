/**
 * Template gallery: the built-in parts catalogue (T-01 … T-11) and the workspace's own templates
 * (U-01 …), with search, a category filter and a schematic preview of the selected one.
 *  - built-in: Use · Customise (once customised: Use · Edit · Reset to original — "Use" takes the edit)
 *  - own: Use · Edit · Duplicate · Delete; "New template" starts a blank one
 * "Use" makes real pages/databases under parentId (or the top level) and opens the result.
 * Keyboard: arrows move through the cards, Enter uses, E edits / customises.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Copy, Lock, PencilRuler, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { usePage } from '../../store/selectors'
import { toast } from '../../store/ui'
import { flushSave } from '../../store/persistence'
import { resolveAssetUrl } from '../../lib/files'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import type { ID, Page, PageIcon as PageIconT, TemplateCategory } from '../../store/types'
import { pauseAutomations } from '../automations/engine'
import { countOf } from '../io/count'
import { TEMPLATES, outlineStats, translator, type OutlineKind, type OutlineLine, type TemplateDef } from './catalog'
import { treeOutline } from './outline'
import {
  TEMPLATE_CATEGORIES,
  announceCopy,
  applyTemplate,
  createBlankTemplate,
  customiseBuiltin,
  customisedBuiltins,
  duplicateTemplate,
  editTemplate,
  removeTemplate,
  templateName,
  templateRoots,
} from './own'
import './templates.css'

type Source = 'builtin' | 'mine'
type Cat = 'all' | TemplateCategory

const SOURCES: Source[] = ['builtin', 'mine']
const CATS: Cat[] = ['all', ...TEMPLATE_CATEGORIES]
const GLYPH: Record<OutlineKind, string> = { page: '▤', db: '▦', views: '◫', fields: '≡', rows: '⋯' }
const pad2 = (n: number) => String(n).padStart(2, '0')

/** One card: a built-in (maybe customised) or an own template. */
interface Entry {
  key: string
  source: Source
  code: string
  category: TemplateCategory | null
  title: string
  description: string
  /** catalogue art: assets/icons/<name>.webp */
  asset: string | null
  icon: PageIconT | null
  kind: Page['kind']
  outline: OutlineLine[]
  def?: TemplateDef
  /** own template, or the customised copy of a built-in */
  root?: Page
}

export function TemplatesModal({ parentId, tab, select, onClose }: { parentId?: ID | null; tab?: Source; select?: ID; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const L = useMemo(() => translator(lang), [lang])
  const parent = usePage(parentId ?? null)
  const target = parent && !parent.trashed && !parent.databaseId && parent.kind === 'page' ? parent : undefined
  const readOnly = useCloud((s) => s.readOnly)
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)

  const roots = useMemo(() => templateRoots(pages), [pages])
  const custom = useMemo(() => customisedBuiltins(roots), [roots])
  const builtins = useMemo<Entry[]>(
    () =>
      TEMPLATES.map((def) => {
        const root = custom.get(def.id)
        return {
          key: `b:${def.id}`,
          source: 'builtin',
          code: def.code,
          category: def.category,
          title: root ? templateName(root) : def.title(L),
          description: root?.template?.description?.trim() || def.description(L),
          asset: def.icon,
          icon: null,
          kind: 'page',
          outline: root ? treeOutline(pages, dbs, root.id, t) : def.outline(L),
          def,
          root,
        }
      }),
    [L, custom, pages, dbs, t],
  )
  const mine = useMemo<Entry[]>(
    () =>
      roots
        .filter((r) => !r.template?.from)
        .map((r, i) => ({
          key: `m:${r.id}`,
          source: 'mine',
          code: `U-${pad2(i + 1)}`,
          category: r.template?.category ?? null,
          title: templateName(r),
          description: r.template?.description?.trim() ?? '',
          asset: null,
          icon: r.template?.icon ?? r.icon,
          kind: r.kind,
          outline: treeOutline(pages, dbs, r.id, t),
          root: r,
        })),
    [roots, pages, dbs, t],
  )

  const initial = useMemo(() => {
    const root = select ? pages[select] : undefined
    if (root?.template?.from) return { source: 'builtin' as Source, key: `b:${root.template.from}` }
    if (root?.template) return { source: 'mine' as Source, key: `m:${root.id}` }
    return { source: tab ?? 'builtin', key: '' }
    // the first render decides; later store changes don't move the selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [source, setSource] = useState<Source>(initial.source)
  const [cat, setCat] = useState<Cat>('all')
  const [query, setQuery] = useState('')
  const [selKey, setSelKey] = useState(initial.key)
  const [busy, setBusy] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const srcRef = useRef<HTMLDivElement>(null)
  const catRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLElement>(null)

  const pool = source === 'builtin' ? builtins : mine
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const searched = terms.length
    ? pool.filter((e) => {
        const hay = `${e.title} ${e.description} ${e.code} ${e.category ? t(`features.tpl.cat.${e.category}`) : ''}`.toLowerCase()
        return terms.every((x) => hay.includes(x))
      })
    : pool
  const list = cat === 'all' ? searched : searched.filter((e) => e.category === cat)
  const sel = list.find((e) => e.key === selKey) ?? list[0]

  const focusSelectedCard = () => gridRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: false })

  // the Modal focuses [data-autofocus] (the selected card) — once more two frames later, after layout
  useEffect(() => {
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(focusSelectedCard)
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [])

  /** Roving arrows inside a row of tabs / chips. */
  const rove = <V,>(values: V[], cur: V, set: (v: V) => void, ref: React.RefObject<HTMLDivElement | null>, selector: string) => (e: React.KeyboardEvent) => {
    const i = values.indexOf(cur)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % values.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + values.length) % values.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = values.length - 1
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusSelectedCard()
      return
    }
    if (next < 0) return
    e.preventDefault()
    set(values[next])
    ref.current?.querySelectorAll<HTMLElement>(selector)[next]?.focus()
  }

  const switchSource = (s: Source) => {
    setSource(s)
    setCat('all')
  }

  /* ---------------- actions ---------------- */

  const guarded = (fn: () => void) => {
    if (busy || readOnly) return
    setBusy(true)
    const resume = pauseAutomations()
    try {
      fn()
    } catch (err) {
      console.error('[templates] action failed', err)
      toast({ message: t('features.tpl.failed'), kind: 'error' })
      setBusy(false)
    } finally {
      resume()
    }
  }

  const use = (e: Entry) =>
    guarded(() => {
      const from = window.location.hash
      const where = target?.id ?? null
      const id = e.root ? applyTemplate(e.root.id, where) : e.def!.build(where, L)
      if (!id) throw new Error('template is gone')
      void flushSave()
      onClose()
      openPage(id)
      announceCopy(id, e.title, from)
    })

  const edit = (e: Entry) => {
    if (!e.root) return
    onClose()
    editTemplate(e.root.id)
  }

  const customise = (e: Entry) =>
    guarded(() => {
      const id = customiseBuiltin(e.def!, L)
      onClose()
      editTemplate(id)
      toast({ message: t('features.tpl.customising', { name: e.def!.title(L) }), kind: 'success' })
    })

  const duplicate = (e: Entry) => {
    if (!e.root || readOnly) return
    const id = duplicateTemplate(e.root.id)
    if (!id) return
    setSource('mine')
    setCat('all')
    setQuery('')
    setSelKey(`m:${id}`)
    toast({ message: t('features.tpl.duplicated'), kind: 'success' })
    requestAnimationFrame(focusSelectedCard)
  }

  const remove = (e: Entry) => {
    if (!e.root || readOnly) return
    if (e.source === 'mine') {
      const i = list.indexOf(e)
      const next = list[i + 1] ?? list[i - 1]
      setSelKey(next?.key ?? '')
    }
    removeTemplate(e.root.id, e.source === 'builtin' ? 'reset' : 'delete')
    requestAnimationFrame(focusSelectedCard)
  }

  const newTemplate = () =>
    guarded(() => {
      const id = createBlankTemplate()
      onClose()
      editTemplate(id, { details: true })
    })

  const onGridKey = (e: React.KeyboardEvent) => {
    const idx = list.findIndex((x) => x.key === sel?.key)
    // real column count of the auto-fill grid (an estimate from the width drifts diagonally)
    const tracks = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').filter(Boolean).length : 1
    const cols = Math.max(1, tracks)
    const move = (d: number) => {
      e.preventDefault()
      const next = list[Math.max(0, Math.min(list.length - 1, idx + d))]
      if (next) {
        setSelKey(next.key)
        gridRef.current?.querySelector<HTMLElement>(`[data-tpl="${next.key}"]`)?.focus()
      }
    }
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(cols)
    else if (e.key === 'ArrowUp') move(-cols)
    else if (e.key === 'Enter' && sel) {
      e.preventDefault()
      use(sel)
    } else if ((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey && !e.altKey && sel) {
      e.preventDefault()
      if (sel.root) edit(sel)
      else if (sel.def) customise(sel)
    }
  }

  const ownCount = mine.length
  const catCount = (c: Cat) => (c === 'all' ? searched.length : searched.filter((e) => e.category === c).length)

  return (
    <Modal open onClose={onClose} label="§ TPL" title={t('features.tpl.title')} width={1080} className="tpl-modal">
      <div className="tpl">
        <div className="tpl-bar">
          <div className="tpl-src" role="tablist" aria-label={t('features.tpl.sources')} ref={srcRef} onKeyDown={rove(SOURCES, source, switchSource, srcRef, '[role="tab"]')}>
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                tabIndex={source === s ? 0 : -1}
                className="tpl-src__tab"
                data-source={s}
                onClick={() => switchSource(s)}
              >
                <span>{t(`features.tpl.src.${s}`)}</span>
                <span className="tpl-src__n">{pad2(s === 'builtin' ? TEMPLATES.length : ownCount)}</span>
              </button>
            ))}
          </div>
          <label className="tpl-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              className="tpl-search__input"
              value={query}
              placeholder={t('features.tpl.search')}
              aria-label={t('features.tpl.search')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || (e.key === 'Enter' && list.length)) {
                  e.preventDefault()
                  focusSelectedCard()
                }
              }}
            />
          </label>
          {!readOnly && (
            <button type="button" className="btn btn--sm tpl-new" onClick={newTemplate} disabled={busy}>
              <Plus size={14} /> {t('features.tpl.new')}
            </button>
          )}
        </div>

        <div className="tpl-filter" role="radiogroup" aria-label={t('features.tpl.categories')} ref={catRef} onKeyDown={rove(CATS, cat, setCat, catRef, '[role="radio"]')}>
          {CATS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cat === c} tabIndex={cat === c ? 0 : -1} className="tpl-filter__tab" onClick={() => setCat(c)}>
              <span>{t(`features.tpl.cat.${c}`)}</span>
              <span className="tpl-filter__n">{pad2(catCount(c))}</span>
            </button>
          ))}
        </div>

        {source === 'mine' && !ownCount ? (
          <EmptyMine readOnly={readOnly} onNew={newTemplate} onBuiltins={() => switchSource('builtin')} />
        ) : !list.length ? (
          <div className="tpl-body tpl-body--empty">
            <p className="tpl-none">
              <span className="label">§ 00</span> {t('features.tpl.noMatch', { q: query.trim() || t(`features.tpl.cat.${cat}`) })}
            </p>
          </div>
        ) : (
          <div className="tpl-body" role="tabpanel" aria-label={t(`features.tpl.src.${source}`)}>
            <div className="tpl-grid" ref={gridRef} role="listbox" aria-label={t('features.tpl.title')} onKeyDown={onGridKey}>
              {list.map((e) => (
                <Card key={e.key} e={e} selected={e.key === sel?.key} onSelect={() => setSelKey(e.key)} onUse={() => use(e)} />
              ))}
            </div>
            {sel && (
              <Preview
                e={sel}
                target={target}
                busy={busy}
                readOnly={readOnly}
                previewRef={previewRef}
                onUse={() => use(sel)}
                onEdit={() => edit(sel)}
                onCustomise={() => customise(sel)}
                onDuplicate={() => duplicate(sel)}
                onRemove={() => remove(sel)}
              />
            )}
          </div>
        )}

        {/* narrow screens: the preview sits below all cards — keep the choice + action in reach */}
        {sel && list.length > 0 && (
          <div className="tpl-dock">
            <Art e={sel} size={32} />
            <span className="tpl-dock__text">
              <span className="tpl-dock__code mono">{sel.code}</span>
              <span className="tpl-dock__title">{sel.title}</span>
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {t('features.tpl.details')} <ArrowDown size={13} />
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => use(sel)} disabled={busy || readOnly}>
              {t('features.tpl.useShort')} <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- parts ---------------- */

function Art({ e, size }: { e: Entry; size: number }) {
  if (e.asset) return <img src={resolveAssetUrl(`assets/icons/${e.asset}.webp`)} alt="" width={size} height={size} draggable={false} loading="lazy" />
  return <PageIcon icon={e.icon} kind={e.kind} size={size} />
}

function Card({ e, selected, onSelect, onUse }: { e: Entry; selected: boolean; onSelect: () => void; onUse: () => void }) {
  const t = useT()
  const s = outlineStats(e.outline)
  const flag = e.source === 'builtin' && !!e.root
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-tpl={e.key}
      data-customised={flag || undefined}
      className="tpl-card"
      onClick={onSelect}
      onDoubleClick={onUse}
      data-autofocus={selected ? '' : undefined}
    >
      <span className="tpl-card__top">
        <span className="tpl-card__code mono">{e.code}</span>
        {flag ? (
          <span className="tpl-card__flag label">
            <span className="led led--on" aria-hidden /> {t('features.tpl.customised')}
          </span>
        ) : (
          <span className="tpl-card__cat label">
            {e.root?.private && <Lock size={10} aria-label={t('features.tpl.private')} />} {e.category ? t(`features.tpl.cat.${e.category}`) : ''}
          </span>
        )}
      </span>
      <span className="tpl-card__art">
        <Art e={e} size={e.asset ? 64 : 48} />
      </span>
      <span className="tpl-card__title">{e.title}</span>
      <span className="tpl-card__spec mono">
        {[s.pages ? countOf(t, 'page', s.pages) : null, s.dbs ? countOf(t, 'db', s.dbs) : null, s.views ? countOf(t, 'view', s.views) : null].filter(Boolean).join(' · ')}
      </span>
    </button>
  )
}

interface PreviewProps {
  e: Entry
  target: Page | undefined
  busy: boolean
  readOnly: boolean
  previewRef: React.RefObject<HTMLElement | null>
  onUse: () => void
  onEdit: () => void
  onCustomise: () => void
  onDuplicate: () => void
  onRemove: () => void
}

function Preview({ e, target, busy, readOnly, previewRef, onUse, onEdit, onCustomise, onDuplicate, onRemove }: PreviewProps) {
  const t = useT()
  const custom = e.source === 'builtin' && !!e.root
  const off = busy || readOnly
  return (
    <aside className="tpl-preview" aria-live="polite" ref={previewRef}>
      <div className="tpl-preview__art" data-asset={!!e.asset || undefined}>
        <Art e={e} size={e.asset ? 112 : 72} />
        <span className="tpl-preview__code mono">{e.code}</span>
        {custom && (
          <span className="tpl-preview__flag label">
            <span className="led led--on" aria-hidden /> {t('features.tpl.customised')}
          </span>
        )}
      </div>
      <div className="label tpl-preview__cat">{e.category ? t(`features.tpl.cat.${e.category}`) : t('features.tpl.unsorted')}</div>
      <h3 className="display tpl-preview__title">{e.title}</h3>
      <p className="tpl-preview__desc muted" data-empty={!e.description || undefined}>
        {e.description || t('features.tpl.noDesc')}
      </p>

      <div className="tpl-section label">
        <b>§</b> {t('features.tpl.structure')}
      </div>
      <ul className="tpl-outline">
        {e.outline.map((line, k) => (
          <li key={k} className={`tpl-outline__line tpl-outline__line--${line.kind}`} data-depth={line.depth} style={{ '--d': line.depth } as React.CSSProperties}>
            <span className="tpl-outline__glyph mono" aria-hidden>
              {GLYPH[line.kind]}
            </span>
            <span className="tpl-outline__kind label">{t(`features.tpl.kind.${line.kind}`)}</span>
            <span className="tpl-outline__label">{line.label}</span>
          </li>
        ))}
      </ul>

      <div className="tpl-preview__foot">
        <div className="tpl-target">
          <span className="label">{t('features.tpl.target')}</span>
          <span className="tpl-target__name">
            {target ? (
              <>
                <PageIcon icon={target.icon} kind={target.kind} size={14} /> {target.title.trim() || t('common.untitled')}
              </>
            ) : (
              t('features.tpl.root')
            )}
          </span>
        </div>
        <button type="button" className="btn btn--primary btn--lg tpl-use" onClick={onUse} disabled={off}>
          {t('features.tpl.use')} <ArrowRight size={16} />
        </button>
        <div className="tpl-acts">
          {!e.root ? (
            <button type="button" className="btn btn--sm" onClick={onCustomise} disabled={off}>
              <PencilRuler size={13} /> {t('features.tpl.customise')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--sm" onClick={onEdit}>
                <PencilRuler size={13} /> {t('features.tpl.edit')}
              </button>
              {!custom && (
                <button type="button" className="btn btn--sm" onClick={onDuplicate} disabled={off}>
                  <Copy size={13} /> {t('features.tpl.duplicate')}
                </button>
              )}
              <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={onRemove} disabled={off}>
                {custom ? <RotateCcw size={13} /> : <Trash2 size={13} />} {t(custom ? 'features.tpl.reset' : 'features.tpl.delete')}
              </button>
            </>
          )}
        </div>
        <span className="tpl-preview__creates mono faint">
          <span className="kbd">↵</span> {t('features.tpl.kbdUse')} · <span className="kbd">E</span> {t(e.root ? 'features.tpl.kbdEdit' : 'features.tpl.kbdCustomise')} ·{' '}
          {t(e.source === 'mine' ? 'features.tpl.createsMine' : custom ? 'features.tpl.createsCustom' : 'features.tpl.creates')}
        </span>
      </div>
    </aside>
  )
}

function EmptyMine({ readOnly, onNew, onBuiltins }: { readOnly: boolean; onNew: () => void; onBuiltins: () => void }) {
  const t = useT()
  return (
    <div className="tpl-body tpl-body--empty">
      <div className="tpl-empty">
        <span className="label">§ 00 — {t('features.tpl.src.mine')}</span>
        <h3 className="display tpl-empty__title">{t('features.tpl.emptyMine.title')}</h3>
        <p className="muted tpl-empty__body">{t('features.tpl.emptyMine.body')}</p>
        <div className="tpl-empty__acts">
          {!readOnly && (
            <button type="button" className="btn btn--primary" onClick={onNew} data-autofocus="">
              <Plus size={14} /> {t('features.tpl.new')}
            </button>
          )}
          <button type="button" className="btn" onClick={onBuiltins}>
            {t('features.tpl.emptyMine.builtins')} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
