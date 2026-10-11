/**
 * Task block — the link picker over the workspace index: "Blocked by…" / "Related…" (this task's own links) and
 * "Blocks…" (the OTHER tasks wait for this one: `writeItems` on each, with Undo).
 *
 *  - Candidates: the live tasks (index winners) — and, for a task in a template, the tasks of that same template —
 *    minus itself. Groups THIS PAGE (document order) and OTHER PAGES (recently visited pages first), ≤ 50 rows each —
 *    a linked row always shows; what is left out is counted in one line ("240 more — type to narrow").
 *  - Search: a folded substring (lower case, no accents) over titles folded once per opening — no RegExp from input.
 *  - Rows: LED + title + page path + the state in words; linked = ticked (toggling removes). Disabled with the reason
 *    in words: would make a loop · private (a shared task can't wait for a private one) · the page is locked
 *    (Blocks: it writes the other task) · 20 links reached.
 *  - A draft until written: Esc discards, Done writes (one undo step here; Blocks: one write per task + Undo).
 */
import { useId, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { pageTitle, templateRootOf } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { HelpLink } from '../../help'
import type { PickerCtx } from '../../editor'
import { getItemIndex, useItemIndexVersion } from './live'
import { wouldLoop } from './graph'
import { writeItems, type ItemEdit } from './write'
import type { ItemEntry } from './itemIndex'
import './items.css'

const MAX_LINKS = 20
/** rows per group (a page with hundreds of tasks would make the opening slow; the search reaches every one) */
const GROUP_MAX = 50
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Folded titles per index entry (an entry is a new object whenever its page's tasks change): folded once. */
const FOLDED = new WeakMap<ItemEntry, string>()
function foldedTitle(e: ItemEntry): string {
  let f = FOLDED.get(e)
  if (f === undefined) FOLDED.set(e, (f = fold(e.title)))
  return f
}
/** One collator for the page paths (String#localeCompare builds one per call: thousands per opening). */
const collator = new Intl.Collator()

/** "Projects / Launch plan" — a page and up to two ancestors. */
export function pagePath(pages: Record<ID, Page>, id: ID | null, untitled: string): string {
  const parts: string[] = []
  let p = id ? pages[id] : undefined
  for (let i = 0; p && i < 3; i++) {
    parts.unshift(pageTitle(p, untitled))
    p = p.parentId ? pages[p.parentId] : undefined
  }
  return parts.join(' / ')
}

type Mode = 'blockedBy' | 'related' | 'blocks'

interface Cand {
  e: ItemEntry
  folded: string
  path: string
  here: boolean
  rank: number
}

export function ItemLinkPicker({ ctx, mode }: { ctx: PickerCtx; mode: Mode }) {
  const t = useT()
  const ids = useId()
  const version = useItemIndexVersion()
  const pages = useWorkspace((s) => s.pages)
  const { team, viewer } = useCloud(useShallow((c) => ({ team: c.active.kind === 'cloud', viewer: c.readOnly })))
  const self = ctx.attrs.itemId
  const thisPrivate = !!pages[ctx.pageId]?.private
  const template = templateRootOf(pages, ctx.pageId)
  const untitled = t('features.workItems.untitled')

  // what is linked now (Blocks: the tasks that wait for this one)
  const linkedNow = useMemo(() => {
    if (mode === 'blocks') return self ? [...(getItemIndex().dependents.get(self) ?? [])] : []
    return mode === 'blockedBy' ? ctx.attrs.blockedBy : ctx.attrs.related
  }, [mode, self, ctx.attrs, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<string[]>(linkedNow)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const touched = useRef(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  // the candidates, folded once per opening (and when the index changes)
  const cands = useMemo<Cand[]>(() => {
    const index = getItemIndex()
    const list: ItemEntry[] = []
    for (const e of index.byId.values()) if (e.itemId !== self) list.push(e)
    if (template) for (const occ of index.templated.values()) for (const e of occ) if (e.template === template && e.itemId !== self && !list.some((x) => x.itemId === e.itemId)) list.push(e)
    // per page once: its place among the recently visited and its path (a page holds several tasks)
    const recent = useWorkspace.getState().recent
    const rankOf = new Map<ID, number>()
    recent.forEach((id, i) => rankOf.has(id) || rankOf.set(id, i))
    const paths = new Map<ID, string>()
    const pathOf = (pageId: ID) => {
      let p = paths.get(pageId)
      if (p === undefined) paths.set(pageId, (p = pagePath(pages, pageId, untitled)))
      return p
    }
    const here: Cand[] = []
    const other: Cand[] = []
    for (const e of list) {
      const c = { e, folded: foldedTitle(e), path: pathOf(e.pageId), here: e.pageId === ctx.pageId, rank: rankOf.get(e.pageId) ?? Number.MAX_SAFE_INTEGER }
      ;(c.here ? here : other).push(c)
    }
    here.sort((a, b) => a.e.order - b.e.order)
    other.sort((a, b) => a.rank - b.rank || collator.compare(a.path, b.path) || a.e.order - b.e.order)
    return [...here, ...other]
  }, [version, self, template, pages, ctx.pageId, untitled])

  const q = fold(query.trim())
  const { rows, more } = useMemo(() => {
    const hits = q ? cands.filter((c) => c.folded.includes(q)) : cands
    const cap = (list: Cand[]) => (list.length <= GROUP_MAX ? list : list.filter((c, i) => i < GROUP_MAX || linkedNow.includes(c.e.itemId)))
    const shown = [...cap(hits.filter((c) => c.here)), ...cap(hits.filter((c) => !c.here))]
    return { rows: shown, more: hits.length - shown.length }
  }, [cands, q, linkedNow])

  const index = getItemIndex()
  /** why a row cannot be ticked (null: it can) */
  const reason = (c: Cand, on: boolean): string | null => {
    if (on) return null
    if (mode === 'blockedBy' && self && wouldLoop(index, self, c.e.itemId)) return t('features.workItems.items.loop')
    if (mode === 'blocks' && self && wouldLoop(index, c.e.itemId, self)) return t('features.workItems.items.loop')
    if (team && (mode === 'blocks' ? !c.e.private && thisPrivate : !thisPrivate && c.e.private)) return t('features.workItems.items.private')
    if (mode === 'blocks' && (pages[c.e.pageId]?.settings.locked || viewer)) return t('features.workItems.items.locked')
    if (mode === 'blocks' ? c.e.attrs.blockedBy.length >= MAX_LINKS : draftRef.current.length >= MAX_LINKS) return t('features.workItems.items.cap')
    return null
  }

  const toggle = (c: Cand) => {
    const on = draftRef.current.includes(c.e.itemId)
    if (reason(c, on)) return
    const next = on ? draftRef.current.filter((x) => x !== c.e.itemId) : [...draftRef.current, c.e.itemId]
    touched.current = true
    draftRef.current = next
    setDraft(next)
  }

  const write = () => {
    const now = draftRef.current
    const add = now.filter((x) => !linkedNow.includes(x))
    const remove = linkedNow.filter((x) => !now.includes(x))
    if (!add.length && !remove.length) return ctx.close()
    if (mode !== 'blocks') return void ctx.commit({ [mode]: { add, remove } })
    if (!self) return ctx.close()
    const edits: ItemEdit[] = [...add.map((itemId) => ({ itemId, patch: { blockedBy: { add: [self] } } })), ...remove.map((itemId) => ({ itemId, patch: { blockedBy: { remove: [self] } } }))]
    const r = writeItems(edits, { by: 'person', toasts: false, from: ctx.pageId })
    ctx.close()
    const refused = r.results.find((x) => x.refused)
    const added = r.results.filter((x, i) => x.ok && i < add.length).length
    const ui = useUI.getState()
    if (refused) {
      const page = refused.pageId ? pageTitle(useWorkspace.getState().pages[refused.pageId] ?? { title: '' }, t('common.untitled')) : ''
      ui.toast({ message: t(`features.workItems.refused.${refused.refused}`, { page }), kind: 'error' })
    } else if (added) ui.toast({ message: added === 1 ? t('features.workItems.edge.blocksAddedOne') : t('features.workItems.edge.blocksAdded', { n: added }), kind: 'success', action: { label: t('features.workItems.undo'), run: r.undo } })
    else ui.toast({ message: t('features.workItems.edge.removed'), kind: 'success', action: { label: t('features.workItems.undo'), run: r.undo } })
  }
  const onClose = () => {
    if (ctx.escaped() || !touched.current) return ctx.close()
    write()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) return write()
      if (rows[active]) toggle(rows[active])
    }
  }
  const optId = (i: number) => `${ids}-o${i}`
  const title = t(`features.workItems.items.title.${mode}`)
  const stateWord = (s: string) => t(`editor.workItem.status.${s}`)

  return (
    <Popover open anchor={ctx.anchor} onClose={onClose} placement="bottom-start" offset={6} className="wi-pop wi-links" role="dialog" aria-label={title}>
      <div className="wi-pop__head label">{title}</div>
      <input
        className="input wi-pop__search"
        data-autofocus=""
        value={query}
        placeholder={t('features.workItems.items.search')}
        aria-label={t('features.workItems.items.search')}
        role="combobox"
        aria-expanded
        aria-controls={`${ids}-list`}
        aria-activedescendant={rows.length ? optId(active) : undefined}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKey}
      />
      <div className="wi-pop__list" id={`${ids}-list`} role="listbox" aria-multiselectable aria-label={title} onMouseDown={(e) => e.preventDefault()}>
        {rows.map((c, i) => {
          const on = draft.includes(c.e.itemId)
          const why = reason(c, on)
          const head = i === 0 || rows[i - 1].here !== c.here
          return (
            <div key={c.e.itemId}>
              {head && <div className="label wi-pop__section">{t(c.here ? 'features.workItems.items.here' : 'features.workItems.items.other')}</div>}
              <div
                id={optId(i)}
                role="option"
                aria-selected={on}
                aria-disabled={why ? true : undefined}
                data-active={i === active ? '' : undefined}
                className="wi-opt wi-opt--item"
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => toggle(c)}
              >
                <span className={c.e.attrs.status === 'done' ? 'led led--ok' : c.e.attrs.status === 'in_progress' ? 'led led--on' : 'led'} aria-hidden />
                <span className="wi-opt__main">
                  <span className="wi-opt__name">{c.e.title || untitled}</span>
                  <span className="wi-opt__sub">{why ?? (c.here ? stateWord(c.e.attrs.status) : `${c.path} · ${stateWord(c.e.attrs.status)}`)}</span>
                </span>
                {on && <Check size={14} strokeWidth={2} className="wi-opt__check" aria-hidden />}
              </div>
            </div>
          )
        })}
        {!rows.length && <div className="label wi-pop__empty">{t('features.workItems.items.none')}</div>}
        {more > 0 && <div className="label wi-pop__empty">{t('features.workItems.items.more', { n: more })}</div>}
      </div>
      <div className="wi-pop__foot">
        <HelpLink id="tasks" topic={t('features.workItems.help')} />
        <span className="wi-pop__note" role="status">
          {mode !== 'blocks' && draft.length >= MAX_LINKS ? t('features.workItems.items.cap') : ''}
        </span>
        <button type="button" className="btn btn--ink btn--sm" onClick={write}>
          {t('common.done')}
        </button>
      </div>
    </Popover>
  )
}
