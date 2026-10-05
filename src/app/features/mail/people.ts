/**
 * Names instead of numbers: the Gmail sync fills three linked databases and links every mail to them.
 *
 *  - Contacts ('mail-contacts') — one row per person, matched by address (case-insensitive; "E-Mail" holds
 *    one or more addresses, comma-separated). Name from the From header's display name, else the address's
 *    local part ("felix.merz" → "Felix Merz"). Company (→ Companies, two-way "Contacts"), Mails (the reverse
 *    of the Mails database's Contact), Last mail (rollup: latest Date), Notes.
 *  - Companies ('mail-companies') — one row per company, matched by domain ("Domains", comma-separated; a
 *    subdomain counts as its domain). Name from the domain ("mueller-gmbh.de" → "Mueller GmbH"). Freemail /
 *    personal domains (settings.mail.people.freemail) never become companies.
 *  - Conversations ('mail-conversations') — one row per Gmail thread, matched by the hidden "Thread id";
 *    named by the subject without "Re: / AW: / Fwd: / WG:". People (→ Contacts), Mails, Last mail.
 *  - The Mails database gets the relations Contact (the sender; a mail the person sent: its first other
 *    recipient), Company (the contact's company) and Conversation — written once per mail, only into empty
 *    fields (a link the person changed stays).
 *
 * Found again by their marker (`Database.system`), not by an id in the per-device settings: they are
 * directories that outlive a Mails database ("Start a new Mails database" keeps the contacts), and another
 * device of the workspace finds the same ones. Like the memory: the oldest live marked one counts (a
 * duplicate is ignored), a deleted one is created again on the next run, in a team workspace only a
 * private one counts (they are created private, like the Mails database). Rows are ordinary rows: rename
 * once and every mail shows the new name — matching only ever uses the stored addresses / domains / thread
 * ids, never a name. Merging two rows ("Merge…" in the database header): mergeRows().
 */
import { defaultView, useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../cloud'
import { ALL_MESSAGES, t } from '../../i18n'
import type { Database, ID, MailPropRole, Page, PropertyDef, PropertyValue } from '../../store/types'
import { inTeam } from './schema'
import { readMail, setMail } from './settings'
import { loadState, saveState } from './storage'

export type PeopleKind = 'contacts' | 'companies' | 'conversations'
export const PEOPLE_KINDS: PeopleKind[] = ['contacts', 'companies', 'conversations']
export const PEOPLE_SYSTEM = { contacts: 'mail-contacts', companies: 'mail-companies', conversations: 'mail-conversations' } as const
const ICON: Record<PeopleKind, string> = { contacts: 'Contact', companies: 'Building2', conversations: 'MessageSquare' }
/** The Mails database's relation to each directory. */
const MAIL_ROLE: Record<PeopleKind, MailPropRole> = { contacts: 'contact', companies: 'company', conversations: 'conversation' }

/** The reverse side of a two-way relation pair (database/model/actions.ts TWO_WAY_SUFFIX). */
const TWO_WAY = '.2way'
const ws = () => useWorkspace.getState()

/* ------------------------------------------------------------------ addresses, domains, subjects */

export interface Address {
  name: string
  email: string
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/** "Doe, Jane <jane@x.com>, bob@y.com" → [{ name: 'Doe, Jane', email: 'jane@x.com' }, { name: '', email: 'bob@y.com' }] */
export function parseAddresses(raw: string): Address[] {
  const out: Address[] = []
  const re = /<([^<>\s]+@[^<>\s]+)>|([^\s<>,;:"()]+@[^\s<>,;:"()]+)/g
  let last = 0
  for (const m of raw.matchAll(re)) {
    const email = (m[1] ?? m[2] ?? '').toLowerCase().replace(/[.)]+$/, '')
    const name = m[1] ? raw.slice(last, m.index).replace(/^[\s,;]+/, '').trim() : ''
    last = (m.index ?? 0) + m[0].length
    if (EMAIL.test(email)) out.push({ name: name.replace(/^['"]+|['"]+$/g, '').trim(), email })
  }
  return out
}

const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w)

/** The name a contact gets: the display name ("Doe, Jane" → "Jane Doe"), else the local part prettified. */
export function contactName(a: Address): string {
  let n = a.name.replace(/\s+/g, ' ').trim()
  if (n.includes('@') || n.toLowerCase() === a.email) n = ''
  const flip = n.match(/^([^,]+),\s*([^,]+)$/)
  if (flip) n = `${flip[2]} ${flip[1]}`
  if (n) return n.slice(0, 120)
  const local = a.email.split('@')[0].split('+')[0]
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map(cap)
      .join(' ') || a.email
  )
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'ltd', 'plc'])

/** The domain a company is known by: "mail.firma.de" → "firma.de", "news.bbc.co.uk" → "bbc.co.uk". */
export function orgDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const keep = SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2
  return parts.slice(-keep).join('.')
}

const LEGAL: Record<string, string> = { gmbh: 'GmbH', ag: 'AG', kg: 'KG', ug: 'UG', se: 'SE', ohg: 'OHG', ev: 'e.V.', llc: 'LLC', inc: 'Inc', ltd: 'Ltd', plc: 'PLC', sa: 'SA', sarl: 'SARL', bv: 'BV', nv: 'NV', ab: 'AB', as: 'AS', oy: 'Oy', spa: 'SpA', srl: 'Srl' }

/** "mueller-gmbh.de" → "Mueller GmbH", "firma.de" → "Firma" (simple — the row is renamed by hand when needed). */
export function companyName(org: string): string {
  const label = org.split('.')[0] ?? org
  return (
    label
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => LEGAL[w] ?? cap(w))
      .join(' ') || org
  )
}

/** Is this domain (or its company domain) a freemail / personal one? "yahoo.*" matches any ending. */
export function isFreemail(domain: string, list: string[]): boolean {
  const d = domain.toLowerCase()
  const org = orgDomain(d)
  return list.some((e) => (e.endsWith('.*') ? d.startsWith(e.slice(0, -1)) || org.startsWith(e.slice(0, -1)) : d === e || org === e || d.endsWith(`.${e}`)))
}

const PREFIX = /^\s*(?:(?:re|aw|antw|antwort|fw|fwd|wg|tr|sv|vs)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*)+/i

/** "Re: AW: Fwd: Angebot P2" → "Angebot P2" */
export function cleanSubject(subject: string): string {
  return subject.replace(PREFIX, '').trim()
}

/** "a@x.de, B@y.de" → ['a@x.de', 'b@y.de'] (addresses, domains or thread ids as stored in a text property). */
export const keysOf = (v: PropertyValue | undefined): string[] =>
  typeof v === 'string'
    ? v
        .split(/[\s,;]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    : []

/* ------------------------------------------------------------------ the three databases */

const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())
const named = (p: PropertyDef, key: string) => both(key).includes(p.name.trim().toLowerCase())
const pn = (key: string) => t(`features.mail.people.prop.${key}`)

/** The directory of this kind: the oldest live marked database (team: a private one only). */
export function peopleDbId(kind: PeopleKind): ID | null {
  const { pages, databases } = ws()
  const team = inTeam()
  let best: { id: ID; at: number } | null = null
  for (const db of Object.values(databases)) {
    if (db.system !== PEOPLE_SYSTEM[kind]) continue
    const p = pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(pages, db.id) || inTemplate(pages, db.id)) continue
    if (team && !p.private) continue
    if (!best || p.createdAt < best.at || (p.createdAt === best.at && db.id < best.id)) best = { id: db.id, at: p.createdAt }
  }
  return best?.id ?? null
}

/** Which directory a database is (its marker), or null. */
export function peopleKindOf(db: Pick<Database, 'system'> | undefined): PeopleKind | null {
  return PEOPLE_KINDS.find((k) => db?.system === PEOPLE_SYSTEM[k]) ?? null
}

/** The text property holding the matching keys (addresses · domains · thread ids). */
const KEY_PROP: Record<PeopleKind, string> = { contacts: 'email', companies: 'domains', conversations: 'threadId' }

function textProp(db: Database, key: string, fallback: boolean): ID | undefined {
  return (db.properties.find((p) => p.type === 'text' && named(p, `features.mail.people.prop.${key}`)) ?? (fallback ? db.properties.find((p) => p.type === 'text') : undefined))?.id
}

export const keyPropOf = (kind: PeopleKind, db: Database) => textProp(db, KEY_PROP[kind], true)

function createDirectory(kind: PeopleKind, parentId: ID | null): ID {
  const title: PropertyDef = { id: newId(), name: pn('name'), type: 'title' }
  const key: PropertyDef = { id: newId(), name: pn(KEY_PROP[kind]), type: 'text' }
  const properties = [title, key]
  if (kind === 'contacts') properties.push({ id: newId(), name: pn('notes'), type: 'text' })
  const view = defaultView('table', { properties }, t('features.mail.people.view.all'))
  // a thread id means nothing to a person: kept, not shown
  if (kind === 'conversations') view.visibleProperties = []
  const input = { parentId, title: t(`features.mail.people.${kind}.title`), icon: { type: 'lucide' as const, value: ICON[kind] }, properties, views: [view] }
  const s = ws()
  const id = inTeam() ? createPrivateDatabase({ ...input, parentId: parentId && s.pages[parentId]?.private ? parentId : null }) : s.createDatabase(input)
  ws().updateDatabase(id, { system: PEOPLE_SYSTEM[kind] })
  return id
}

/** A relation `from` → `to` (by name or any), else a new one with its reverse side `<id>.2way` on `to`. */
function ensureRelation(fromDb: ID, toDb: ID, nameKey: string, backName: string | null): ID | undefined {
  const s = ws()
  const from = s.databases[fromDb]
  const to = s.databases[toDb]
  if (!from || !to) return undefined
  const rels = from.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId === toDb)
  const hit = rels.find((p) => named(p, nameKey)) ?? rels.find((p) => to.properties.some((q) => q.id === p.id + TWO_WAY)) ?? rels[0]
  if (hit) return hit.id
  if (from.locked) return undefined
  const id = s.addProperty(fromDb, { id: newId(), type: 'relation', name: t(nameKey), relationDatabaseId: toDb })
  if (backName && !to.locked) s.addProperty(toDb, { id: id + TWO_WAY, type: 'relation', name: backName, relationDatabaseId: fromDb })
  return id
}

/** "Last mail" on a directory: the latest Date of its mails (computed). */
function ensureLastMail(dbId: ID, mailsBack: ID | undefined, dateProp: ID | undefined): void {
  const db = ws().databases[dbId]
  if (!db || db.locked || !mailsBack || !dateProp || !db.properties.some((p) => p.id === mailsBack)) return
  const cfg = { relationPropertyId: mailsBack, targetPropertyId: dateProp, fn: 'latest_date' as const }
  const prop = db.properties.find((p) => p.type === 'rollup' && p.rollup?.relationPropertyId === mailsBack) ?? db.properties.find((p) => p.type === 'rollup' && named(p, 'features.mail.people.prop.lastMail'))
  if (!prop) ws().addProperty(dbId, { type: 'rollup', name: pn('lastMail'), rollup: cfg })
  else if (prop.rollup?.targetPropertyId !== dateProp || prop.rollup?.relationPropertyId !== mailsBack) ws().updateProperty(dbId, prop.id, { rollup: cfg })
}

/** A freshly created directory's table: the useful columns, newest mail first. */
function tidyView(kind: PeopleKind, dbId: ID): void {
  const db = ws().databases[dbId]
  const view = db?.views[0]
  if (!db || !view) return
  const by = (key: string, type: PropertyDef['type']) => db.properties.find((p) => p.type === type && named(p, `features.mail.people.prop.${key}`))?.id
  const last = db.properties.find((p) => p.type === 'rollup')?.id
  const order: Record<PeopleKind, Array<ID | undefined>> = {
    contacts: [by('email', 'text'), by('company', 'relation'), last, by('mails', 'relation')],
    companies: [by('domains', 'text'), by('contacts', 'relation'), last, by('mails', 'relation')],
    conversations: [by('people', 'relation'), last, by('mails', 'relation')],
  }
  const visible = order[kind].filter((x): x is ID => !!x)
  ws().updateView(dbId, view.id, { visibleProperties: visible, sorts: last ? [{ propertyId: last, direction: 'desc' }] : view.sorts })
}

/** Put the Mails database's new relations right after "From" in its views (they say who it is). */
function placeInMailViews(mailDbId: ID, ids: ID[]): void {
  const db = ws().databases[mailDbId]
  const from = readMail().props?.from
  if (!db || !ids.length) return
  for (const v of db.views) {
    const rest = v.visibleProperties.filter((x) => !ids.includes(x))
    const at = from && rest.includes(from) ? rest.indexOf(from) + 1 : rest.length
    ws().updateView(mailDbId, v.id, { visibleProperties: [...rest.slice(0, at), ...ids, ...rest.slice(at)] })
  }
}

export interface PeopleCtx {
  db: Record<PeopleKind, ID>
  /** the matching keys' properties */
  key: Partial<Record<PeopleKind, ID>>
  /** Contacts → Companies (and its reverse on Companies) */
  company?: ID
  companyBack?: ID
  /** Conversations → Contacts */
  people?: ID
  /** the Mails database's relations (forward) and their reverse sides on the directories */
  mail: Partial<Record<PeopleKind, ID>>
  mailBack: Partial<Record<PeopleKind, ID>>
}

/**
 * The three directories for the Mails database `mailDbId` — created when missing (private in a team
 * workspace, next to the Mails database) — with their relations and "Last mail" rollups; a locked database
 * gets no new properties (the links it would hold are then left out).
 */
export function ensurePeople(mailDbId: ID): PeopleCtx {
  const made: PeopleKind[] = []
  const parent = ws().pages[mailDbId]?.parentId ?? null
  const db = {} as Record<PeopleKind, ID>
  for (const kind of PEOPLE_KINDS) {
    let id = peopleDbId(kind)
    if (!id) {
      id = createDirectory(kind, parent)
      made.push(kind)
    }
    db[kind] = id
  }
  const company = ensureRelation(db.contacts, db.companies, 'features.mail.people.prop.company', pn('contacts'))
  const people = ensureRelation(db.conversations, db.contacts, 'features.mail.people.prop.people', null)
  // the Mails database's side: stored id (still pointing at this directory), else by name, else new
  const cfg = readMail()
  const mailDb = ws().databases[mailDbId]
  const mail: PeopleCtx['mail'] = {}
  const added: ID[] = []
  for (const kind of PEOPLE_KINDS) {
    const role = MAIL_ROLE[kind]
    const stored = mailDb?.properties.find((p) => p.id === cfg.props?.[role] && p.type === 'relation' && p.relationDatabaseId === db[kind])
    const before = new Set(ws().databases[mailDbId]?.properties.map((p) => p.id))
    const id = stored?.id ?? ensureRelation(mailDbId, db[kind], `features.mail.prop.${role}`, pn('mails'))
    if (id && !before.has(id)) added.push(id)
    if (id) mail[kind] = id
  }
  placeInMailViews(mailDbId, added)
  // a relation to a directory that is gone (deleted, replaced): kept with its links, but out of the views
  const stale = PEOPLE_KINDS.map((kind) => cfg.props?.[MAIL_ROLE[kind]]).filter((id): id is ID => !!id && !Object.values(mail).includes(id))
  if (stale.length && !ws().databases[mailDbId]?.locked) for (const v of ws().databases[mailDbId]?.views ?? []) if (v.visibleProperties.some((x) => stale.includes(x))) ws().updateView(mailDbId, v.id, { visibleProperties: v.visibleProperties.filter((x) => !stale.includes(x)) })
  const props = { ...(readMail().props ?? {}) }
  let dirty = false
  for (const kind of PEOPLE_KINDS) {
    const role = MAIL_ROLE[kind]
    if (props[role] !== mail[kind]) {
      if (mail[kind]) props[role] = mail[kind]
      else delete props[role]
      dirty = true
    }
  }
  if (dirty) setMail({ props })
  const mailBack: PeopleCtx['mailBack'] = {}
  const date = readMail().props?.date
  for (const kind of PEOPLE_KINDS) {
    const back = mail[kind] ? mail[kind] + TWO_WAY : undefined
    if (back && ws().databases[db[kind]]?.properties.some((p) => p.id === back)) mailBack[kind] = back
    ensureLastMail(db[kind], mailBack[kind], date)
  }
  for (const kind of made) tidyView(kind, db[kind])
  const key: PeopleCtx['key'] = {}
  for (const kind of PEOPLE_KINDS) {
    const d = ws().databases[db[kind]]
    if (d) key[kind] = keyPropOf(kind, d)
  }
  const companyBack = company && ws().databases[db.companies]?.properties.some((p) => p.id === company + TWO_WAY) ? company + TWO_WAY : undefined
  return { db, key, company, companyBack, people, mail, mailBack }
}

/* ------------------------------------------------------------------ linking */

const rel = (row: Page | undefined, prop: ID | undefined): ID[] => (row && prop && Array.isArray(row.properties[prop]) ? (row.properties[prop] as ID[]) : [])

/** Add `target` to a relation of `rowId` (no duplicates). */
function addRel(rowId: ID, prop: ID | undefined, target: ID): void {
  if (!prop) return
  const cur = rel(ws().pages[rowId], prop)
  if (!cur.includes(target)) ws().setRowProperty(rowId, prop, [...cur, target])
}

/** rowId ⇄ target over a two-way pair (the reverse side when it exists). */
function link(rowId: ID, fwd: ID | undefined, target: ID, back: ID | undefined): void {
  if (!fwd) return
  addRel(rowId, fwd, target)
  if (back) addRel(target, back, rowId)
}

/** Live rows of a database by their keys (addresses / domains / thread ids). */
function indexOf(dbId: ID, keyProp: ID | undefined): Map<string, ID> {
  const out = new Map<string, ID>()
  if (!keyProp) return out
  const rows = Object.values(ws().pages)
    .filter((p) => p.databaseId === dbId && !p.trashed)
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const p of rows) for (const k of keysOf(p.properties[keyProp])) if (!out.has(k)) out.set(k, p.id)
  return out
}

export interface Linker {
  /** link one mail row (only its empty relations are filled) */
  row: (rowId: ID) => void
}

/** A linker for the Mails database: indexes of the three directories, created rows join them. */
export function makeLinker(ctx: PeopleCtx, own: string | null): Linker {
  const cfg = readMail()
  const mp = cfg.props ?? {}
  const freemail = cfg.people.freemail
  const idx = { contacts: indexOf(ctx.db.contacts, ctx.key.contacts), companies: indexOf(ctx.db.companies, ctx.key.companies), conversations: indexOf(ctx.db.conversations, ctx.key.conversations) }
  const me = (own ?? '').toLowerCase()
  const str = (row: Page, role: MailPropRole) => {
    const id = mp[role]
    const v = id ? row.properties[id] : ''
    return typeof v === 'string' ? v : ''
  }

  const companyOf = (domain: string): ID | null => {
    if (!ctx.key.companies || isFreemail(domain, freemail)) return null
    const org = orgDomain(domain)
    const hit = idx.companies.get(domain) ?? idx.companies.get(org)
    if (hit) return hit
    const id = ws().createRow(ctx.db.companies, { title: companyName(org), properties: { [ctx.key.companies]: org } })
    idx.companies.set(org, id)
    return id
  }

  const contactOf = (a: Address): ID | null => {
    if (!ctx.key.contacts) return null
    const hit = idx.contacts.get(a.email)
    if (hit) return hit
    const id = ws().createRow(ctx.db.contacts, { title: contactName(a), properties: { [ctx.key.contacts]: a.email } })
    idx.contacts.set(a.email, id)
    const company = companyOf(a.email.split('@')[1] ?? '')
    if (company) link(id, ctx.company, company, ctx.companyBack)
    return id
  }

  const conversationOf = (thread: string, subject: string): ID | null => {
    if (!ctx.key.conversations || !thread) return null
    const hit = idx.conversations.get(thread.toLowerCase())
    if (hit) return hit
    const title = cleanSubject(subject) || t('features.mail.noSubject')
    const id = ws().createRow(ctx.db.conversations, { title, properties: { [ctx.key.conversations]: thread } })
    idx.conversations.set(thread.toLowerCase(), id)
    return id
  }

  const setIfEmpty = (rowId: ID, kind: PeopleKind, target: ID | null) => {
    const fwd = ctx.mail[kind]
    if (!fwd || !target || rel(ws().pages[rowId], fwd).length) return
    link(rowId, fwd, target, ctx.mailBack[kind])
  }

  return {
    row: (rowId) => {
      const row = ws().pages[rowId]
      if (!row || row.trashed) return
      const sender = parseAddresses(str(row, 'from'))[0]
      // a mail the person sent: the contact is whom it went to
      const who = sender && (!me || sender.email !== me) ? sender : parseAddresses(str(row, 'to')).find((a) => a.email !== me)
      const contact = who ? contactOf(who) : null
      const company = contact ? (rel(ws().pages[contact], ctx.company)[0] ?? null) : null
      const conversation = conversationOf(str(row, 'thread'), row.title)
      if (conversation && contact) addRel(conversation, ctx.people, contact)
      setIfEmpty(rowId, 'contacts', contact)
      setIfEmpty(rowId, 'companies', company && ws().pages[company] && !ws().pages[company].trashed ? company : null)
      setIfEmpty(rowId, 'conversations', conversation)
    },
  }
}

/** Mails linked per step (then the UI breathes and the state is saved). */
const LINK_BATCH = 40
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * Link the synced mails that were not linked yet on this device (new ones, and on the first run every
 * earlier one — the backfill), oldest first so names come from the first mail. A directory that is gone
 * (deleted) is created again and every synced mail is linked once more (only empty fields are filled, so
 * nothing doubles). Returns how many.
 */
export async function linkPending(signal: AbortSignal, progress: (p: { done: number; total: number } | null) => void): Promise<number> {
  const cfg = readMail()
  if (!cfg.people.enabled || !cfg.databaseId || !ws().databases[cfg.databaseId]) return 0
  if (inTeam() && useCloud.getState().readOnly) return 0
  const dbId = cfg.databaseId
  const state = await loadState()
  const dateOf = (rowId: ID) => {
    const v = cfg.props?.date ? ws().pages[rowId]?.properties[cfg.props.date] : null
    return v && typeof v === 'object' && !Array.isArray(v) ? v.start : ''
  }
  const live = Object.values(state.known).filter((k) => {
    const p = ws().pages[k.r]
    return !!p && !p.trashed && p.databaseId === dbId
  })
  const again = live.some((k) => k.c) && PEOPLE_KINDS.some((kind) => !peopleDbId(kind))
  const pending = again ? live : live.filter((k) => !k.c)
  if (!pending.length) return 0
  pending.sort((a, b) => dateOf(a.r).localeCompare(dateOf(b.r)))
  const linker = makeLinker(ensurePeople(dbId), state.account)
  let done = 0
  progress({ done, total: pending.length })
  try {
    for (let i = 0; i < pending.length; i += LINK_BATCH) {
      if (signal.aborted) break
      for (const k of pending.slice(i, i + LINK_BATCH)) {
        linker.row(k.r)
        k.c = 1
        done++
      }
      progress({ done, total: pending.length })
      await saveState(state)
      await tick()
    }
  } finally {
    progress(null)
    await saveState(state)
  }
  return done
}

/* ------------------------------------------------------------------ merging */

/**
 * Merge row `fromId` into `intoId` (same directory): the addresses / domains / thread ids join, every
 * relation moves over (the mails, the company, the people — in every database that points here), empty
 * text fields are filled, then `fromId` goes to the trash. One toast with Undo. Returns false when the
 * rows can't be merged.
 */
export function mergeRows(dbId: ID, fromId: ID, intoId: ID): boolean {
  const s = ws()
  const db = s.databases[dbId]
  const kind = peopleKindOf(db)
  const from = s.pages[fromId]
  const into = s.pages[intoId]
  if (!db || !kind || !from || !into || fromId === intoId || from.databaseId !== dbId || into.databaseId !== dbId || from.trashed || into.trashed) return false
  const before = new Map<ID, Record<ID, PropertyValue>>()
  const write = (rowId: ID, propId: ID, value: PropertyValue) => {
    const row = ws().pages[rowId]
    if (!row) return
    const saved = before.get(rowId) ?? {}
    if (!(propId in saved)) saved[propId] = row.properties[propId] ?? null
    before.set(rowId, saved)
    ws().setRowProperty(rowId, propId, value)
  }
  const keyProp = keyPropOf(kind, db)
  for (const p of db.properties) {
    const a = into.properties[p.id]
    const b = from.properties[p.id]
    if (p.id === keyProp) {
      const keys = [...new Set([...keysOf(a), ...keysOf(b)])]
      if (keys.join(', ') !== (typeof a === 'string' ? a : '')) write(intoId, p.id, keys.join(', '))
    } else if (p.type === 'relation') {
      const merged = [...new Set([...rel(into, p.id), ...rel(from, p.id)])].filter((x) => x !== intoId && x !== fromId)
      if (merged.length !== rel(into, p.id).length) write(intoId, p.id, merged)
    } else if (p.type === 'text' && (a === undefined || a === null || a === '') && typeof b === 'string' && b) write(intoId, p.id, b)
  }
  // everything that points at `fromId` points at `intoId` now (both sides of every pair, other databases too)
  const pointing = Object.values(ws().databases).flatMap((d) => d.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId === dbId).map((p) => [d.id, p.id] as const))
  for (const row of Object.values(ws().pages)) {
    if (!row.databaseId || row.id === fromId) continue
    for (const [d, propId] of pointing) {
      if (row.databaseId !== d) continue
      const cur = rel(row, propId)
      if (!cur.includes(fromId)) continue
      write(row.id, propId, [...new Set(cur.map((x) => (x === fromId ? intoId : x)))].filter((x) => !(row.id === intoId && x === intoId)))
    }
  }
  ws().trashPage(fromId)
  const fromTitle = from.title.trim() || t('common.untitled')
  const intoTitle = into.title.trim() || t('common.untitled')
  useUI.getState().toast({
    message: t('features.mail.people.merged', { from: fromTitle, into: intoTitle }),
    kind: 'success',
    timeout: 10_000,
    action: {
      label: t('common.undo'),
      run: () => {
        ws().restorePage(fromId)
        for (const [rowId, props] of before) for (const [propId, v] of Object.entries(props)) ws().setRowProperty(rowId, propId, v)
      },
    },
  })
  return true
}

/** How many live rows a directory has (Settings → Mail lists them). */
export function rowCount(dbId: ID): number {
  let n = 0
  for (const p of Object.values(ws().pages)) if (p.databaseId === dbId && !p.trashed) n++
  return n
}

