/**
 * Task block — what the read-only placard shows, computed from the sanitized attrs (pure: the caller
 * passes the translator, the language, the workspace's people and "now"). One model for the editor's
 * node view, the schema's static HTML (exports, clipboard) and the history diff.
 *
 * Static renders (exports, clipboard, share links) show counts for linked tasks only ("Depends on 2"): titles and
 * whether a blocker is still open need the workspace index. The editor's placard passes what the index computed
 * (`computed`): blocked / after all / a template's task / a duplicate — the label says it in words, the root carries
 * it as `data-state`.
 */
import { differenceInCalendarDays, format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'
import type { ColorName, Person } from '../../store/types'
import { dueHasTime, shortItemId, type WorkItemAttrs, type WorkItemStatus } from './attrs'

type T = (key: string, vars?: Record<string, string | number>) => string

export interface PlacardPerson {
  key: string
  name: string
  initials: string
  color: ColorName
}

/** What the workspace index adds to a task's own fields (the editor's placard; static renders have none). */
export interface PlacardComputed {
  /** status ≠ done ∧ an open blocker */
  blocked: boolean
  /** waits for tasks that are all finished now */
  afterAll: boolean
  /** how many tasks it waits for (any state) */
  blockers: number
  /** the task sits in a template (it is created when the template is used) */
  template: boolean
  /** another block holds the same itemId and wins */
  duplicate: boolean
}

/** The computed state the root carries (`data-state`): only the label says it, so narrow layouts keep the label. */
export type PlacardState = 'blocked' | 'after' | 'template' | 'duplicate'

export interface PlacardModel {
  status: WorkItemStatus
  /** a computed state (null: the status says it all) */
  computed: PlacardState | null
  /**
   * The spec label: the state in words (never by colour alone) + the id's last four — "Open · 7F3A",
   * "In progress · 1B2C" / "Overdue · 4C1A" (signal), "Done Thu 08 Oct" (the day it was done).
   */
  state: { word: string; signal: boolean; id: string }
  /** the label as one line of text ("In progress · 1B2C") */
  label: string
  /** "Open" / "In progress" / "Done" — the key's accessible name */
  statusText: string
  /** `lateDays`: whole days past the due day (0 = later today) — only while late */
  due: { text: string; iso: string; late: boolean; lateDays: number; reminder: string | null } | null
  people: PlacardPerson[]
  /** linked tasks this one waits for / is related to (counts only in P0) */
  blockedBy: number
  related: number
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}

/** Local Date of a due value (all-day: midnight). */
export function dueDate(due: string): Date {
  const d = new Date(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, Number(due.slice(8, 10)))
  if (dueHasTime(due)) d.setHours(Number(due.slice(11, 13)), Number(due.slice(14, 16)), 0, 0)
  return d
}

/** "Fr 17 Okt" / "Fri 17 Oct" — a day on the placard. */
export function dayText(d: Date, lang: Lang): string {
  return format(d, lang === 'de' ? 'EEEEEE dd MMM' : 'EEE dd MMM', { locale: lang === 'de' ? de : enUS }).replace(/\./g, '')
}

/** "Fr 17 Okt" / "Fri 17 Oct", with the time "· 09:00" / "· 9:00 AM" when the due date has one. */
export function dueText(due: string, lang: Lang): string {
  const d = dueDate(due)
  const day = dayText(d, lang)
  return dueHasTime(due) ? `${day} · ${format(d, lang === 'de' ? 'HH:mm' : 'h:mm a', { locale: lang === 'de' ? de : enUS })}` : day
}

/** Past due: an all-day date once its day is over, a timed one once its time passed. */
export function isLate(due: string, now: number): boolean {
  const d = dueDate(due)
  if (!dueHasTime(due)) d.setDate(d.getDate() + 1)
  return d.getTime() <= now
}

/** "−1 T" / "−1 D" — a reminder code in a chip ('at' → '' : the bell alone says it). */
export function reminderShort(code: string | null, t: T): string | null {
  if (!code) return null
  if (code === 'at') return ''
  const m = /^-(\d{1,3})([mhdw])$/.exec(code)
  return m ? `−${Number(m[1])} ${t(`editor.workItem.unit.${m[2]}`)}` : null
}

export function placardModel(a: WorkItemAttrs, ctx: { t: T; lang: Lang; people: Person[]; now: number }, computed?: PlacardComputed | null): PlacardModel {
  const { t } = ctx
  const short = shortItemId(a.itemId)
  const people: PlacardPerson[] = []
  if (a.people.length) {
    for (const id of a.people) {
      // ids that no longer resolve are hidden, never deleted
      const p = ctx.people.find((x) => x.id === id)
      if (p) people.push({ key: id, name: p.name, initials: initialsOf(p.name), color: p.color })
    }
  } else if (a.frozen) {
    a.frozen.people.forEach((name, i) => people.push({ key: `f${i}`, name, initials: initialsOf(name), color: 'gray' }))
  }
  const late = !!a.due && a.status !== 'done' && isLate(a.due, ctx.now)
  const statusText = t(`editor.workItem.status.${a.status}`)
  // the label's word: duplicate > template > done > blocked > overdue > after all > the status
  let kind: PlacardState | null = null
  let state: PlacardModel['state']
  if (computed?.duplicate) {
    kind = 'duplicate'
    state = { word: t('editor.workItem.state.duplicate'), signal: true, id: '' }
  } else if (computed?.template) {
    kind = 'template'
    state = { word: t('editor.workItem.state.template'), signal: false, id: '' }
  } else if (a.status === 'done') {
    state = a.doneAt ? { word: `${statusText} ${dayText(new Date(a.doneAt), ctx.lang)}`, signal: false, id: '' } : { word: statusText, signal: false, id: short }
  } else if (computed?.blocked) {
    kind = 'blocked'
    state = { word: t('editor.workItem.state.blocked'), signal: true, id: short }
  } else if (late) {
    state = { word: t('editor.workItem.overdue'), signal: true, id: short }
  } else if (computed?.afterAll) {
    kind = 'after'
    state = { word: t('editor.workItem.state.after', { n: computed.blockers }), signal: false, id: short }
  } else state = { word: statusText, signal: a.status === 'in_progress', id: short }
  return {
    status: a.status,
    computed: kind,
    state,
    label: state.id ? `${state.word} · ${state.id}` : state.word,
    statusText,
    due: a.due
      ? { text: dueText(a.due, ctx.lang), iso: a.due, late, lateDays: late ? Math.max(0, differenceInCalendarDays(ctx.now, dueDate(a.due))) : 0, reminder: reminderShort(a.reminder, t) }
      : null,
    people,
    blockedBy: a.blockedBy.length || a.frozen?.blockedBy || 0,
    related: a.related.length || a.frozen?.related || 0,
  }
}

/** "Überfällig · 2 T" / "Overdue · 2 d" — the late part of the due chip (no count later on the same day). */
export function lateText(m: PlacardModel, t: T): string {
  const days = m.due?.lateDays ?? 0
  return days > 0 ? `${t('editor.workItem.overdue')} · ${days} ${t('editor.workItem.unit.d')}` : t('editor.workItem.overdue')
}

/** The chips' plain words (static HTML, plain text): "Fri 17 Oct", "Alex", "Depends on 2", "2 related". */
export function chipWords(m: PlacardModel, t: T): { due: string | null; people: string[]; blockedBy: string | null; related: string | null } {
  return {
    due: m.due ? (m.due.late ? `${lateText(m, t)} · ${m.due.text}` : m.due.text) : null,
    people: m.people.map((p) => p.name),
    blockedBy: m.blockedBy ? t('editor.workItem.blockedBy', { n: m.blockedBy }) : null,
    related: m.related ? t('editor.workItem.related', { n: m.related }) : null,
  }
}
