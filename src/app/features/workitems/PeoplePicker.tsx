/**
 * Task block — the people picker (a task's `people`, ≤ 12). Search field + a multi-select listbox
 * (↑ / ↓ move, Enter ticks, Backspace in the empty field unticks the last one):
 *  - Me first when it resolves (team: the signed-in member; local: the local user's own person), then people.
 *  - Team: members first, the others under NOT MEMBERS · NO REMINDERS (a reminder never rings for them); no "Add".
 *  - Local: Add “x” ticks a NEW person (1–60 characters, a name not taken) — made only when the picker writes.
 *  - Ids the task holds that resolve to nobody: one row "n people no longer here — Remove".
 * A draft until written: Esc discards the ticks (and the people it would have made), Done writes them (one undo step),
 * a press outside writes a changed one. The draft holds only the person's own ticks: someone a member assigned
 * meanwhile shows ticked and is never removed by a Done the person did not mean for them.
 */
import { useId, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check, Plus } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import type { ID, Person } from '../../store/types'
import { useCloud } from '../../cloud'
import { localPerson } from '../../database'
import type { PickerCtx } from '../../editor'
import { useMemberIds } from './members'
import { shownLinks, toggleDelta } from './draft'
import './items.css'

const MAX = 12
const NAME_MAX = 60
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Row = { kind: 'person'; id: ID; name: string; color: string; me?: boolean; section: 'me' | 'members' | 'others' | 'people' } | { kind: 'add'; name: string }

export function PeoplePicker({ ctx }: { ctx: PickerCtx }) {
  const t = useT()
  const ids = useId()
  const people = useWorkspace((s) => s.people)
  const userName = useWorkspace((s) => s.settings.userName)
  const { team, me: account, myName } = useCloud(useShallow((c) => ({ team: c.active.kind === 'cloud', me: c.user?.id ?? null, myName: c.user?.name ?? '' })))
  const members = useMemberIds()
  // the person's own ticks against the task's people NOW (a member's change meanwhile shows and stays) …
  const [toggles, setToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const togglesRef = useRef(toggles)
  togglesRef.current = toggles
  // … and the people "Add" would make (`new:<n>` until the picker writes — Esc makes none)
  const [pending, setPending] = useState<readonly Person[]>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const assigned = ctx.attrs.people
  const assignedRef = useRef(assigned)
  assignedRef.current = assigned
  const draft = useMemo(() => shownLinks(assigned, toggles), [assigned, toggles])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [capHit, setCapHit] = useState(false)

  const me: Person | null = useMemo(() => {
    if (team) return account ? (people.find((p) => p.id === account) ?? { id: account, name: myName || t('features.workItems.people.me'), color: 'gray' }) : null
    return localPerson({ me: { id: null, name: userName }, people, labels: { you: t('database.actor.you') } })
  }, [team, account, myName, people, userName, t])

  const q = fold(query.trim())
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const match = (name: string) => !q || fold(name).includes(q)
    if (me && (match(me.name) || match(t('features.workItems.people.me')))) out.push({ kind: 'person', id: me.id, name: me.name, color: me.color, me: true, section: 'me' })
    const rest = [...people, ...pending].filter((p) => p.id !== me?.id && match(p.name))
    if (team) {
      const isMember = (p: Person) => members === null || members.has(p.id)
      for (const p of rest.filter(isMember)) out.push({ kind: 'person', id: p.id, name: p.name, color: p.color, section: 'members' })
      for (const p of rest.filter((p) => !isMember(p))) out.push({ kind: 'person', id: p.id, name: p.name, color: p.color, section: 'others' })
    } else for (const p of rest) out.push({ kind: 'person', id: p.id, name: p.name, color: p.color, section: 'people' })
    const name = query.trim()
    if (!team && name && name.length <= NAME_MAX && ![...people, ...pending].some((p) => fold(p.name) === fold(name))) out.push({ kind: 'add', name })
    return out
  }, [me, people, pending, team, members, q, query, t])

  const known = (id: string) => people.some((p) => p.id === id) || pending.some((p) => p.id === id) || id === me?.id
  const unknown = draft.filter((id) => !known(id))

  /** set the person's own ticks (id → assigned or not) */
  const change = (ticks: ReadonlyArray<[string, boolean]>) => {
    const next = new Map(togglesRef.current)
    for (const [id, on] of ticks) next.set(id, on)
    togglesRef.current = next
    draftRef.current = shownLinks(assignedRef.current, next)
    setToggles(next)
  }
  const toggle = (id: string) => {
    const cur = draftRef.current
    if (cur.includes(id)) {
      setCapHit(false)
      return change([[id, false]])
    }
    if (cur.length >= MAX) return setCapHit(true)
    change([[id, true]])
  }
  const pick = (i: number) => {
    const row = rows[i]
    if (!row) return
    if (row.kind === 'add') {
      if (draftRef.current.length >= MAX) return setCapHit(true)
      const person: Person = { id: `new:${pendingRef.current.length}`, name: row.name, color: 'gray' }
      pendingRef.current = [...pendingRef.current, person]
      setPending(pendingRef.current)
      change([[person.id, true]])
    } else toggle(row.id)
    setQuery('')
    setActive(0)
  }

  const write = () => {
    // a new person ticked at the end is made now (a name someone added meanwhile: that person)
    const made = new Map<string, string>()
    for (const p of pendingRef.current) {
      if (togglesRef.current.get(p.id) !== true) continue
      const ws = useWorkspace.getState()
      made.set(p.id, ws.people.find((x) => fold(x.name) === fold(p.name))?.id ?? ws.addPerson(p.name))
    }
    const ticks = new Map<string, boolean>()
    for (const [id, on] of togglesRef.current) if (!id.startsWith('new:') || made.has(id)) ticks.set(made.get(id) ?? id, on)
    const { add, remove } = toggleDelta(assignedRef.current, ticks)
    if (!add.length && !remove.length) return ctx.close()
    ctx.commit({ people: { add, remove } })
  }
  const onClose = () => {
    if (ctx.escaped() || !togglesRef.current.size) return ctx.close()
    write()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) return write()
      pick(active)
    } else if (e.key === 'Backspace' && !query && draftRef.current.length) {
      e.preventDefault()
      change([[draftRef.current[draftRef.current.length - 1], false]])
    }
  }
  const optId = (i: number) => `${ids}-o${i}`
  const label = (r: Row) => (r.kind === 'add' ? t('features.workItems.people.add', { name: r.name }) : r.me ? `${t('features.workItems.people.me')} · ${r.name}` : r.name)

  return (
    <Popover open anchor={ctx.anchor} onClose={onClose} placement="bottom-start" offset={6} className="wi-pop wi-people" role="dialog" aria-label={t('features.workItems.people.title')}>
      <input
        className="input wi-pop__search"
        data-autofocus=""
        value={query}
        placeholder={t('features.workItems.people.search')}
        aria-label={t('features.workItems.people.search')}
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
      <div className="wi-pop__list" id={`${ids}-list`} role="listbox" aria-multiselectable aria-label={t('features.workItems.people.title')} onMouseDown={(e) => e.preventDefault()}>
        {rows.map((r, i) => {
          const head = r.kind === 'person' && (i === 0 || rows[i - 1].kind !== 'person' || (rows[i - 1] as { section: string }).section !== r.section) && (r.section === 'members' || r.section === 'others')
          const on = r.kind === 'person' && draft.includes(r.id)
          return (
            <div key={r.kind === 'add' ? 'add' : r.id}>
              {head && <div className="label wi-pop__section">{t(r.section === 'members' ? 'features.workItems.people.members' : 'features.workItems.people.others')}</div>}
              <div id={optId(i)} role="option" aria-selected={r.kind === 'person' ? on : false} data-active={i === active ? '' : undefined} className="wi-opt" onMouseMove={() => i !== active && setActive(i)} onClick={() => pick(i)}>
                {r.kind === 'add' ? (
                  <Plus size={14} strokeWidth={1.8} className="faint" aria-hidden />
                ) : (
                  <span className="wi-opt__avatar" style={{ background: `var(--c-${r.color}-bg)`, color: `var(--c-${r.color}-text)` }} aria-hidden>
                    {initials(r.name)}
                  </span>
                )}
                <span className="wi-opt__name">{label(r)}</span>
                {on && <Check size={14} strokeWidth={2} className="wi-opt__check" aria-hidden />}
              </div>
            </div>
          )
        })}
        {!rows.length && <div className="label wi-pop__empty">{t('database.person.empty')}</div>}
      </div>
      {unknown.length > 0 && (
        <button type="button" className="btn btn--ghost btn--sm wi-pop__unknown" onClick={() => change(draftRef.current.filter((id) => !known(id)).map((id): [string, boolean] => [id, false]))}>
          {unknown.length === 1 ? t('features.workItems.people.unknownOne') : t('features.workItems.people.unknown', { n: unknown.length })}
        </button>
      )}
      <div className="wi-pop__foot">
        <span className="wi-pop__note" role="status">
          {capHit || draft.length >= MAX ? t('features.workItems.people.cap') : ''}
        </span>
        <button type="button" className="btn btn--ink btn--sm" onClick={write}>
          {t('common.done')}
        </button>
      </div>
    </Popover>
  )
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}
