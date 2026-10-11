/** "@" menu: pages, dates (natural language, EN + DE) and people. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { useStore } from 'zustand'
import Fuse from 'fuse.js'
import { exitSuggestion } from '@tiptap/suggestion'
import { CalendarDays, FilePlus2, UserRound } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle, templateScope } from '../../store/selectors'
import { useLang, useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { addDays, nextMonday } from 'date-fns'
import { dateMentionAttrs, dateMentionLabel, parseDateQuery } from '../lib/dates'
import { SUGGEST_KEYS, type SuggestRun } from '../extensions/suggest'
import { liveIds } from '../lib/livePages'
import { patchItemAttrs, type ItemPatch } from '../workitem/patch'
import { dueText } from '../workitem/format'
import { itemAttrs } from '../workitem/attrs'
import { useScrollActive, useSuggestAnchor, useSuggestKeys } from './common'

interface Row {
  key: string
  section: 'fields' | 'pages' | 'dates' | 'people' | 'new'
  icon: ReactNode
  label: string
  hint?: string
  run: (range: Range) => void
}

export function MentionMenu({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const lang = useLang()
  const suggest = useStore(bridge, (s) => (s.suggest?.kind === 'mention' ? s.suggest : null))
  const anchor = useSuggestAnchor(editor, suggest)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const query = suggest?.query.trim() ?? ''
  const open = !!suggest
  // pages inside a trashed parent are gone with it on "Empty trash" — computed once per opening
  const live = useMemo(() => (open ? liveIds(useWorkspace.getState().pages) : null), [open])

  const insert = (range: Range, attrs: { id: string; label: string; kind: 'page' | 'date' | 'person' }) => {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'mention', attrs },
        { type: 'text', text: ' ' },
      ])
      .run()
    // database rows answer with "link as relation?" (database PAGE_MENTIONED)
    if (attrs.kind === 'page') window.dispatchEvent(new CustomEvent('one:page-mentioned', { detail: { from: pageId, to: attrs.id } }))
  }

  // "@" in a task's title: the task's own fields first ("Assign: Alex", "Due: Fri 17 Oct") — one transaction that
  // removes the "@query" and writes the field (people added, due set, a reminder kept)
  const itemPos = useMemo(() => {
    if (!suggest || editor.isDestroyed) return null
    const $p = editor.state.doc.resolve(Math.min(suggest.range.from, editor.state.doc.content.size))
    const d = $p.depth - 1
    return d >= 1 && $p.node(d).type.name === 'workItem' && $p.index(d) === 0 ? $p.before(d) : null
  }, [suggest, editor])
  const writeField = (range: Range, patch: ItemPatch) => {
    if (itemPos === null || editor.isDestroyed) return
    const { state, view } = editor
    const node = state.doc.nodeAt(itemPos)
    if (!node || node.type.name !== 'workItem') return
    const delta = patchItemAttrs(node.attrs, patch, Date.now())
    // "checkout @alex" at the end of the title: the space before the "@" goes with it
    const $r = state.doc.resolve(range.from)
    const atEnd = range.to >= $r.end()
    const from = atEnd && range.from > $r.start() && state.doc.textBetween(range.from - 1, range.from) === ' ' ? range.from - 1 : range.from
    const tr = state.tr.delete(from, range.to)
    if (delta) tr.setNodeMarkup(itemPos, undefined, { ...node.attrs, ...delta })
    view.dispatch(tr)
    view.focus()
  }

  const rows = useMemo<Row[]>(() => {
    if (!open) return []
    const { pages, people } = useWorkspace.getState()
    const pageRows: Row[] = []
    const dateRows: Row[] = []
    const out: Row[] = []
    // pages — template pages (features/templates) only from a page of the same template
    const scope = templateScope(pages, pageId)
    const candidates = Object.values(pages).filter((p) => !!live?.has(p.id) && p.id !== pageId && scope(p.id))
    let matched = candidates
    if (query) {
      const fuse = new Fuse(candidates, { keys: ['title'], threshold: 0.38, ignoreLocation: true })
      matched = fuse.search(query).map((r) => r.item)
    } else {
      const recent = useWorkspace.getState().recent
      matched = [...candidates].sort((a, b) => {
        const ra = recent.indexOf(a.id)
        const rb = recent.indexOf(b.id)
        return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || b.updatedAt - a.updatedAt
      })
    }
    for (const p of matched.slice(0, query ? 6 : 4)) {
      const parent = p.parentId ? pages[p.parentId] : null
      pageRows.push({
        key: `p-${p.id}`,
        section: 'pages',
        icon: <PageIcon icon={p.icon} kind={p.kind} size={16} />,
        label: pageTitle(p, t('common.untitled')),
        hint: parent ? pageTitle(parent, t('common.untitled')) : undefined,
        // a private page's title never travels inside a mention (others would read it, docs/CLOUD.md § Private pages)
        run: (range) => insert(range, { id: p.id, label: p.private ? '' : p.title, kind: 'page' }),
      })
    }
    // dates
    const dates: Date[] = []
    const parsed = query ? parseDateQuery(query) : null
    if (parsed) dates.push(parsed)
    else if (!query) {
      const today = new Date()
      dates.push(today, addDays(today, 1), nextMonday(today))
    }
    dates.forEach((d, i) => {
      const attrs = dateMentionAttrs(d, lang)
      const word = !query ? [t('editor.date.today'), t('editor.date.tomorrow'), t('editor.date.nextMonday')][i] : dateMentionLabel(d, lang)
      dateRows.push({
        key: `d-${attrs.id}`,
        section: 'dates',
        icon: <CalendarDays size={15} strokeWidth={1.7} />,
        label: word,
        hint: attrs.id,
        run: (range) => insert(range, attrs),
      })
    })
    // a task's own fields on top (in its title)
    if (itemPos !== null) {
      const node = editor.state.doc.nodeAt(itemPos)
      const assigned = node ? itemAttrs(node).people : []
      const q = query.toLowerCase()
      const who = people.filter((p) => !assigned.includes(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 3)
      for (const person of who)
        out.push({
          key: `f-u-${person.id}`,
          section: 'fields',
          icon: <UserRound size={15} strokeWidth={1.7} style={{ color: `var(--c-${person.color}-text)` }} />,
          label: t('editor.workItem.mention.assign', { name: person.name }),
          run: (range) => writeField(range, { people: { add: [person.id] } }),
        })
      const first = dates[0]
      if (first) {
        const iso = dateMentionAttrs(first, lang).id
        out.push({
          key: `f-d-${iso}`,
          section: 'fields',
          icon: <CalendarDays size={15} strokeWidth={1.7} />,
          label: t('editor.workItem.mention.due', { date: dueText(iso, lang) }),
          run: (range) => writeField(range, { due: iso }),
        })
      }
    }
    // a query that parses as a date ("next fri", "morgen") ranks the date above fuzzy page hits
    if (parsed) out.push(...dateRows, ...pageRows)
    else out.push(...pageRows, ...dateRows)
    // people
    const ppl = query ? people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) : people.slice(0, 3)
    for (const person of ppl.slice(0, 4))
      out.push({
        key: `u-${person.id}`,
        section: 'people',
        icon: <UserRound size={15} strokeWidth={1.7} style={{ color: `var(--c-${person.color}-text)` }} />,
        label: person.name,
        run: (range) => insert(range, { id: person.id, label: person.name, kind: 'person' }),
      })
    // new page
    if (query && !parsed)
      out.push({
        key: 'new',
        section: 'new',
        icon: <FilePlus2 size={15} strokeWidth={1.7} />,
        label: t('editor.mention.newPage', { title: query }),
        run: (range) => {
          const id = useWorkspace.getState().createPage({ parentId: pageId, title: query })
          insert(range, { id, label: query, kind: 'page' })
        },
      })
    return out
  }, [open, live, query, pageId, t, lang, itemPos]) // eslint-disable-line react-hooks/exhaustive-deps

  // "New page …" is offered, never the default: Enter on a menu without real matches is a new line
  useEffect(() => setActive(rows.findIndex((r) => r.section !== 'new')), [rows])
  useScrollActive(listRef, active)
  // Notion: "@ " and a phrase that matches nothing close the menu, so normal prose keeps flowing
  const raw = suggest?.query ?? ''
  const noMatch = rows.every((r) => r.section === 'new')
  useEffect(() => {
    if (!open) return
    if (/^\s/.test(raw) || (/\s/.test(raw) && noMatch)) exitSuggestion(editor.view, SUGGEST_KEYS.mention)
  }, [open, raw, noMatch, editor])
  const select = (i: number) => {
    const row = rows[i]
    if (row && suggest) suggest.command(((range) => row.run(range)) as SuggestRun)
  }
  useSuggestKeys(bridge, 'mention', { count: rows.length, active, setActive, onSelect: select })

  return (
    <Popover
      open={open && !!anchor}
      anchor={anchor}
      onClose={() => exitSuggestion(editor.view, SUGGEST_KEYS.mention)}
      placement="bottom-start"
      offset={6}
      autoFocus={false}
      className="suggest-menu"
      role="listbox"
    >
      <div ref={listRef} onMouseDown={(e) => e.preventDefault()}>
        {rows.length === 0 && <div className="menu-section faint">{t('editor.slash.empty')}</div>}
        {rows.map((r, i) => (
          <div key={r.key}>
            {(i === 0 || rows[i - 1].section !== r.section) && r.section !== 'new' && <div className="menu-section label">{t(r.section === 'fields' ? 'editor.workItem.mention.section' : `editor.mention.${r.section}`)}</div>}
            {r.section === 'new' && <div className="menu-sep" />}
            <div role="option" aria-selected={i === active} data-index={i} data-active={i === active} className="menu-item" onMouseMove={() => i !== active && setActive(i)} onClick={() => select(i)}>
              <span className="menu-item__icon">{r.icon}</span>
              <span className="menu-item__label">{r.label}</span>
              {r.hint && <span className="menu-item__hint">{r.hint}</span>}
            </div>
          </div>
        ))}
      </div>
    </Popover>
  )
}
