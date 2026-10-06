/**
 * One Script templates — what fits in THIS workspace: databases by the properties they have (a status,
 * a date, people, a relation …), the "done" / "open" options of a status, the Mails database (Settings →
 * Mail, else one that looks like it) and the mail directories by their marker (`Database.system`).
 * Everything reads the store; nothing writes.
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import { ALL_MESSAGES } from '../../../i18n'
import type { Database, MailPropRole, Page, PropertyDef } from '../../../store/types'

export interface DbPick {
  page: Page
  db: Database
  /** the stable @ reference */
  ref: string
  name: string
}

const ws = () => useWorkspace.getState()

export const refOf = (p: Page) => `@[${(p.title.trim() || 'Untitled').replace(/[\]\\]/g, (c) => `\\${c}`).replace(/\n/g, ' ')}](p:${p.id})`

function pickOf(db: Database): DbPick | null {
  const { pages } = ws()
  const page = pages[db.id]
  if (!page || page.trashed || isEffectivelyTrashed(pages, page.id) || inTemplate(pages, page.id)) return null
  return { page, db, ref: refOf(page), name: page.title.trim() || 'Untitled' }
}

/** The workspace's live databases, oldest first (the memory and the mail directories left out). */
export function liveDbs(): DbPick[] {
  return Object.values(ws().databases)
    .filter((db) => !db.system)
    .map(pickOf)
    .filter((x): x is DbPick => !!x)
    .sort((a, b) => a.page.createdAt - b.page.createdAt)
}

const named = (p: PropertyDef, re: RegExp) => re.test(p.name.trim())

/** A status (else a select that reads like one). */
export function statusOf(db: Database): PropertyDef | undefined {
  return db.properties.find((p) => p.type === 'status') ?? db.properties.find((p) => p.type === 'select' && named(p, /^(status|state|zustand|stand|phase)$/i))
}

/** The date things are due by (a name like Due / Fällig / Deadline first). */
export function dateOf(db: Database): PropertyDef | undefined {
  const dates = db.properties.filter((p) => p.type === 'date')
  return dates.find((p) => named(p, /due|f[äa]llig|deadline|termin|frist|until|bis/i)) ?? dates[0]
}

export const personOf = (db: Database) => db.properties.find((p) => p.type === 'person' && named(p, /owner|assignee|verantwortlich|zust[äa]ndig|wer|who/i)) ?? db.properties.find((p) => p.type === 'person')

/** A priority: a select (not the status) named like one, else any other select. */
export function prioOf(db: Database, status: PropertyDef | undefined): PropertyDef | undefined {
  const sel = db.properties.filter((p) => p.type === 'select' && p.id !== status?.id)
  return sel.find((p) => named(p, /prio/i)) ?? sel[0]
}

export const titleOf = (db: Database) => db.properties.find((p) => p.type === 'title')

const DONE = /^(done|erledigt|fertig|completed?|closed|geschlossen|abgeschlossen|finished|gelesen|read|published|ver[öo]ffentlicht)$/i
const ARCHIVED = /^(archived?|archiviert|archiv)$/i

/** The option that means "done": a status' complete group, else a done-like name, else the last one. */
export function doneOf(p: PropertyDef | undefined): string {
  const opts = (p?.options ?? []).filter((o) => !ARCHIVED.test(o.name.trim()))
  return (opts.find((o) => o.group === 'done') ?? opts.find((o) => DONE.test(o.name.trim())) ?? opts[opts.length - 1])?.name ?? 'Done'
}

/** The option a new entry starts with (a status' to-do group, else the first one). */
export function openOf(p: PropertyDef | undefined): string | null {
  const opts = p?.options ?? []
  return (opts.find((o) => o.group === 'todo') ?? opts[0])?.name ?? null
}

export const archivedOptionOf = (p: PropertyDef | undefined) => p?.options?.find((o) => ARCHIVED.test(o.name.trim()))?.name ?? null
export const archivedBoxOf = (db: Database) => db.properties.find((p) => p.type === 'checkbox' && ARCHIVED.test(p.name.trim()))
export const summaryOf = (db: Database) => db.properties.find((p) => p.type === 'text' && named(p, /^(summary|zusammenfassung|tl;?dr|kurzfassung)$/i))

/** A relation to group entries by (Project / Parent first) with an existing target database. */
export function relationOf(db: Database): PropertyDef | undefined {
  const rels = db.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId && ws().databases[p.relationDatabaseId])
  return rels.find((p) => named(p, /project|projekt|parent|[üu]bergeordnet/i)) ?? rels[0]
}

/** Whether the entries of a date property hold ranges (start → end). */
export function hasRanges(db: Database, prop: PropertyDef | undefined): boolean {
  if (!prop) return false
  return Object.values(ws().pages).some((p) => p.databaseId === db.id && !p.trashed && !!(p.properties[prop.id] as { end?: string } | undefined)?.end)
}

/** The first database that fits (in the order of `prefer`, then oldest first). */
export function findDb(fits: (db: Database) => boolean, prefer: RegExp | null = /task|aufgabe|todo|projekt|project/i, exclude: string[] = []): DbPick | null {
  const list = liveDbs().filter((x) => fits(x.db) && !exclude.includes(x.db.id))
  return (prefer ? list.find((x) => prefer.test(x.name)) : undefined) ?? list[0] ?? null
}

/** A database for tasks: a status and a date (the Mails database left out). */
export function taskDb(exclude: string[] = []): DbPick | null {
  return findDb((db) => !!statusOf(db) && !!dateOf(db), /task|aufgabe|todo/i, exclude) ?? findDb((db) => !!statusOf(db) && !!dateOf(db), null, exclude)
}

/* ------------------------------------------------------------------ mail */

const ROLE_TYPE: Partial<Record<MailPropRole, PropertyDef['type']>> = { needsReply: 'checkbox', unread: 'checkbox', link: 'url', from: 'text', date: 'date', company: 'relation', contact: 'relation', summary: 'text' }
const roleNames = (r: MailPropRole) => [ALL_MESSAGES.en[`features.mail.prop.${r}`], ALL_MESSAGES.de[`features.mail.prop.${r}`]].filter(Boolean).map((n) => n.toLowerCase())

export interface MailPick extends DbPick {
  role(r: MailPropRole): PropertyDef | undefined
}

/** The Mails database: the one Settings → Mail syncs into, else a database named like it with a Gmail link. */
export function mailDb(): MailPick | null {
  const s = ws()
  const cfg = s.settings.mail
  const set = cfg?.databaseId ? s.databases[cfg.databaseId] : undefined
  let pick = set ? pickOf(set) : null
  if (!pick)
    pick =
      Object.values(s.databases)
        .map(pickOf)
        .filter((x): x is DbPick => !!x)
        .find((x) => /^(e-?)?mails?$/i.test(x.name) && x.db.properties.some((p) => p.type === 'url' && roleNames('link').includes(p.name.trim().toLowerCase()))) ?? null
  if (!pick) return null
  const db = pick.db
  const ids = cfg?.databaseId === db.id ? (cfg.props ?? {}) : {}
  const role = (r: MailPropRole) => {
    const id = ids[r]
    return (id ? db.properties.find((p) => p.id === id) : undefined) ?? db.properties.find((p) => (!ROLE_TYPE[r] || p.type === ROLE_TYPE[r]) && roleNames(r).includes(p.name.trim().toLowerCase()))
  }
  return { ...pick, role }
}

/** A mail directory by its marker: the oldest live one. */
export function directoryDb(system: 'mail-contacts' | 'mail-companies' | 'mail-conversations'): DbPick | null {
  return (
    Object.values(ws().databases)
      .filter((db) => db.system === system)
      .map(pickOf)
      .filter((x): x is DbPick => !!x)
      .sort((a, b) => a.page.createdAt - b.page.createdAt)[0] ?? null
  )
}

/** A directory's "Last mail" (the rollup the sync keeps, or a date named like it). */
export function lastMailOf(db: Database): PropertyDef | undefined {
  const names = [ALL_MESSAGES.en['features.mail.people.prop.lastMail'], ALL_MESSAGES.de['features.mail.people.prop.lastMail']].filter(Boolean).map((n) => n.toLowerCase())
  return db.properties.find((p) => (p.type === 'rollup' || p.type === 'date') && names.includes(p.name.trim().toLowerCase())) ?? db.properties.find((p) => p.type === 'rollup' && p.rollup?.fn === 'latest_date')
}
