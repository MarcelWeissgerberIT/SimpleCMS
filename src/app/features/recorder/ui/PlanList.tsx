/**
 * The list of a read window's places, grouped by what changed (numbered 01, 02 … over the groups present): one
 * listbox — ↑ / ↓ pick (the preview follows), Home / End, a "+ n more" entry that expands in place (the first new
 * place becomes the active one), ↵ on a place opens it on the phone's second sheet. The picked place carries an ink
 * bar (never orange); a place someone changed since is held (signal wash + bar). Titles are read live.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronRight, Columns3, FileDiff, FileText, MoveRight, Rows3, SquareDashed, Table2, Trash2, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { PlaceKey } from '../model/types'
import { rowLabel, type GroupKind, type ReadItem, type ReadModel } from '../window/read'
import { fmtNum, hm, hms, pl } from './format'
import { laneMeta } from './lanes'
import { whoName } from './WindowPlate'

/** Places shown per group before "+ n more" (held ones always). */
const FIRST = 3

const ICON: Record<GroupKind, LucideIcon> = { schema: Table2, views: Columns3, pages: FileText, rows: Rows3, newRows: Rows3, trashed: Trash2, moved: MoveRight, partial: SquareDashed }
const ACT: Record<GroupKind, string> = { schema: 'changed', views: 'changed', pages: 'changed', rows: 'changed', newRows: 'new', trashed: 'trashed', moved: 'moved', partial: 'changed' }

type Entry = { kind: 'item'; item: ReadItem; group: GroupKind } | { kind: 'more'; group: GroupKind; n: number }

export const optionId = (p: PlaceKey | string) => `rec-pi-${p.replace(/[^A-Za-z0-9_-]/g, '_')}`

export function PlanList({ model, pick, onPick, onOpen, phone }: { model: ReadModel; pick: PlaceKey | null; onPick: (p: PlaceKey) => void; onOpen: (p: PlaceKey) => void; phone: boolean }) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))
  const [open, setOpen] = useState<ReadonlySet<GroupKind>>(() => new Set())
  // the "+ n more" entry that is active (keyboard) — an item otherwise
  const [moreActive, setMoreActive] = useState<GroupKind | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // per group: the first places (held ones always), then "+ n more" until it is opened
  const groups = useMemo(
    () =>
      model.groups.map((g) => {
        const shown = open.has(g.kind) ? g.items : g.items.filter((it, i) => i < FIRST || it.verdict.outcome === 'held' || it.p === pick)
        const entries: Entry[] = shown.map((item) => ({ kind: 'item', item, group: g.kind }))
        if (shown.length < g.items.length) entries.push({ kind: 'more', group: g.kind, n: g.items.length - shown.length })
        return { kind: g.kind, count: g.items.length, entries }
      }),
    // the picked place stays shown once picked (a hidden one picked by a test or a link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, open],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups])
  const activeIndex = moreActive ? flat.findIndex((e) => e.kind === 'more' && e.group === moreActive) : flat.findIndex((e) => e.kind === 'item' && e.item.p === pick)
  const activeId = activeIndex < 0 ? undefined : flat[activeIndex].kind === 'more' ? `rec-more-${flat[activeIndex].group}` : optionId((flat[activeIndex] as Extract<Entry, { kind: 'item' }>).item.p)

  // the active entry stays in view
  useEffect(() => {
    if (!activeId) return
    ref.current?.querySelector(`#${CSS.escape(activeId)}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const go = (i: number) => {
    const e = flat[Math.max(0, Math.min(flat.length - 1, i))]
    if (!e) return
    if (e.kind === 'more') setMoreActive(e.group)
    else {
      setMoreActive(null)
      onPick(e.item.p)
    }
  }
  const expand = (group: GroupKind) => {
    const g = model.groups.find((x) => x.kind === group)
    const before = new Set(groups.find((x) => x.kind === group)?.entries.flatMap((e) => (e.kind === 'item' ? [e.item.p] : [])))
    setOpen((o) => new Set(o).add(group))
    setMoreActive(null)
    // the first place that was not shown becomes the active one
    const next = g?.items.find((it) => !before.has(it.p))
    if (next) onPick(next.p)
  }

  // a press focuses the list without scrolling it (the hint above the list stays where it is)
  const keepScroll = (e: MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ref.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      go((activeIndex < 0 ? -1 : activeIndex) + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      go(e.key === 'Home' ? 0 : flat.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      const cur = flat[activeIndex]
      if (!cur) return
      e.preventDefault()
      if (cur.kind === 'more') expand(cur.group)
      else if (phone) onOpen(cur.item.p)
    }
  }

  const titleOf = (it: ReadItem): { key: string | null; title: string } => {
    const id = it.p.slice(2)
    if (it.pk === 'schema' || it.pk === 'view') {
      const db = pages[it.db ?? id]?.title || t('features.recorder.report.untitled')
      const view = it.pk === 'view' ? model.data.places.get(it.p)?.ownEvents.flatMap((e) => e.x ?? []).find((d) => d.view)?.view?.name : undefined
      return { key: null, title: it.pk === 'schema' ? t('features.recorder.read.schemaItem', { db }) : t('features.recorder.read.viewItem', { db, view: view ?? '' }) }
    }
    if (it.verdict.reason === 'unavailable') return { key: null, title: t('features.recorder.read.unavailable') }
    const page = pages[id]
    if (!page) return { key: null, title: t('features.recorder.read.gone') }
    const title = page.title || t('features.recorder.report.untitled')
    const key = it.pk === 'row' ? rowLabel(page) : null
    return { key: key && key !== title && !title.startsWith(key) ? key : null, title }
  }
  const metaOf = (it: ReadItem): string => {
    const by = it.verdict.outcome === 'held' ? it.verdict.by[0] : undefined
    if (by) return `${whoName(by.lane, t, ws, true)} ${hm(by.at)}`
    if (it.pk === 'row') {
      const parts: string[] = []
      if (it.values) parts.push(t(pl('features.recorder.read.values', it.values), { n: fmtNum(it.values, lang) }))
      if (it.text) parts.push(t('features.recorder.read.textShort'))
      return parts.join(' · ') || hm(it.at)
    }
    if (it.pk === 'page' || it.pk === 'db') return it.words[0] || it.words[1] ? `+${fmtNum(it.words[0], lang)} −${fmtNum(it.words[1], lang)}` : hm(it.at)
    return hms(it.at)
  }
  /** What W changed on a row, in a stable order: title, the properties as the database lists them, text. */
  const subOf = (it: ReadItem): string | null => {
    if (it.pk !== 'row') return null
    const keys = new Set<string>()
    for (const g of model.data.places.get(it.p)?.own ?? []) {
      if (g.touched === '*') return null
      for (const k of g.touched) keys.add(k)
    }
    const names: string[] = []
    if (keys.has('t')) names.push(t('features.recorder.read.titlePart'))
    for (const prop of ws.databases[it.db ?? '']?.properties ?? []) if (keys.has(`p:${prop.id}`)) names.push(prop.name)
    if (keys.has('c')) names.push(t('features.recorder.read.textShort'))
    return names.length ? names.join(' · ') : null
  }
  const heldTitle = (it: ReadItem): string | undefined => {
    const by = it.verdict.outcome === 'held' ? it.verdict.by[0] : undefined
    return by ? t('features.recorder.read.heldBy', { who: whoName(by.lane, t, ws), time: hm(by.at) }) : undefined
  }

  let n = 0
  return (
    <div className="plan" aria-label={t('features.recorder.read.planAria')}>
      {phone && (
        <p className="plan__hint">
          <FileDiff aria-hidden />
          <span>{t('features.recorder.read.hint')}</span>
        </p>
      )}
      <div ref={ref} className="plan__list" role="listbox" tabIndex={0} data-autofocus aria-label={t('features.recorder.read.planAria')} aria-activedescendant={activeId} onKeyDown={onKeyDown}>
        {groups.map((g) => {
          n++
          const Icon = ICON[g.kind]
          return (
            <div key={g.kind} role="group" aria-labelledby={`rec-g-${g.kind}`} className="plan__g" data-group={g.kind}>
              <div className="plan__sec" id={`rec-g-${g.kind}`}>
                <span className="plan__n">{String(n).padStart(2, '0')}</span>
                <span className="label plan__label">
                  {t(`features.recorder.read.group.${g.kind}`)} · {fmtNum(g.count, lang)}
                </span>
                <span className="plan__dots" aria-hidden="true" />
                <span className="plan__act">{t(`features.recorder.read.act.${ACT[g.kind]}`)}</span>
              </div>
              {g.entries.map((e) => {
                if (e.kind === 'more')
                  return (
                    <div key={`more-${e.group}`} id={`rec-more-${e.group}`} role="option" aria-selected={moreActive === e.group} className="pi pi--more" data-on={moreActive === e.group || undefined} onMouseDown={keepScroll} onClick={() => expand(e.group)}>
                      {t('features.recorder.read.more', { n: fmtNum(e.n, lang) })}
                    </div>
                  )
                const it = e.item
                const { key, title } = titleOf(it)
                const sub = subOf(it)
                const isHeld = it.verdict.outcome === 'held'
                const on = it.p === pick && !moreActive
                return (
                  <div
                    key={it.p}
                    id={optionId(it.p)}
                    role="option"
                    aria-selected={on}
                    className={`pi${isHeld ? ' pi--held' : ''}`}
                    data-on={on || undefined}
                    data-place={it.p}
                    onMouseDown={keepScroll}
                    onClick={() => {
                      setMoreActive(null)
                      onPick(it.p)
                      if (phone) onOpen(it.p)
                    }}
                  >
                    <Icon className="pi__i" aria-hidden />
                    <span className="pi__t" title={key ? `${key} · ${title}` : title}>
                      {key && <span className="pi__key">{key}</span>}
                      {title}
                    </span>
                    <span className="pi__r" title={heldTitle(it)}>
                      {metaOf(it)}
                    </span>
                    {sub && <span className="pi__s">{sub}</span>}
                    {phone && <ChevronRight className="pi__go" aria-hidden />}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The writer's name as the dialog says it ("Agent · Nordlicht-Spiegel", or "Lauf 212"). */
export function writerName(model: ReadModel, t: ReturnType<typeof useT>, ws: Parameters<typeof laneMeta>[2]): { writer: string; run: string } {
  const writer = laneMeta(model.sel.lane, t, ws).title
  const seq = model.sel.run ? model.data.runs[model.sel.run]?.meta?.seq : undefined
  return { writer, run: seq ? t('features.recorder.win.run', { n: seq }) : writer }
}
