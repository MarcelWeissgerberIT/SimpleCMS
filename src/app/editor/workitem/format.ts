/**
 * Task block — what the read-only placard shows, computed from the sanitized attrs (pure: the caller
 * passes the translator, the language, the workspace's people and "now"). One model for the editor's
 * node view, the schema's static HTML (exports, clipboard) and the history diff.
 *
 * P0 shows counts for linked tasks only: their titles need the workspace index (P1).
 */
import { format } from 'date-fns'
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

export interface PlacardModel {
  status: WorkItemStatus
  /** "Task · 7F3A" (no id: "Task") */
  label: string
  /** "Open" / "In progress" / "Done" — the key's accessible name */
  statusText: string
  due: { text: string; iso: string; late: boolean; reminder: string | null } | null
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

/** "Fr 17 Okt" / "Fri 17 Oct", with the time "· 09:00" / "· 9:00 AM" when the due date has one. */
export function dueText(due: string, lang: Lang): string {
  const d = dueDate(due)
  const locale = lang === 'de' ? de : enUS
  const day = format(d, lang === 'de' ? 'EEEEEE d MMM' : 'EEE d MMM', { locale }).replace(/\./g, '')
  return dueHasTime(due) ? `${day} · ${format(d, lang === 'de' ? 'HH:mm' : 'h:mm a', { locale })}` : day
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

export function placardModel(a: WorkItemAttrs, ctx: { t: T; lang: Lang; people: Person[]; now: number }): PlacardModel {
  const { t } = ctx
  const short = shortItemId(a.itemId)
  const label = short ? `${t('editor.workItem.label')} · ${short}` : t('editor.workItem.label')
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
  return {
    status: a.status,
    label,
    statusText: t(`editor.workItem.status.${a.status}`),
    due: a.due ? { text: dueText(a.due, ctx.lang), iso: a.due, late: a.status !== 'done' && isLate(a.due, ctx.now), reminder: reminderShort(a.reminder, t) } : null,
    people,
    blockedBy: a.blockedBy.length || a.frozen?.blockedBy || 0,
    related: a.related.length || a.frozen?.related || 0,
  }
}

/** The chips' plain words (static HTML, plain text): "Fri 17 Oct", "Alex", "Blocked by 2", "2 related". */
export function chipWords(m: PlacardModel, t: T): { due: string | null; people: string[]; blockedBy: string | null; related: string | null } {
  return {
    due: m.due ? (m.due.late ? `${t('editor.workItem.overdue')} · ${m.due.text}` : m.due.text) : null,
    people: m.people.map((p) => p.name),
    blockedBy: m.blockedBy ? t('editor.workItem.blockedBy', { n: m.blockedBy }) : null,
    related: m.related ? t('editor.workItem.related', { n: m.related }) : null,
  }
}
