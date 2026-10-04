/**
 * The "Mails" database: its properties by role, created on the first sync (store actions only).
 *
 *  - Team workspace: created in the member's PRIVATE section (cloud createPrivateDatabase) — mails never
 *    land in the shared space silently; a Mails database moved to the workspace pauses the sync.
 *  - Local workspace: an ordinary database under the chosen page (or at the top level).
 *  - Gmail-owned properties (from, to, date, labels, unread, attachments, link, thread, message id) are
 *    written by the sync; Claude's (category, priority, needs reply, summary, project) once per mail.
 *  - Existing databases are adopted: properties are found by stored id, then by name (EN / DE) and type;
 *    missing ones are added — never while the database is locked.
 */
import { format } from 'date-fns'
import { defaultView, useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { newId } from '../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../cloud'
import { ALL_MESSAGES, t } from '../../i18n'
import type { ColorName, Database, ID, MailPropRole, MailSettings, PropertyDef, PropertyValue, SelectOption, View } from '../../store/types'
import type { ParsedMail } from './parse'

export const GMAIL_ROLES: MailPropRole[] = ['from', 'to', 'date', 'labels', 'unread', 'attachments', 'link', 'thread', 'messageId', 'images']
const HIDDEN_ROLES: MailPropRole[] = ['to', 'thread', 'link', 'messageId', 'images']

const ROLE_TYPE: Record<MailPropRole, PropertyDef['type']> = {
  messageId: 'text',
  from: 'text',
  to: 'text',
  date: 'date',
  labels: 'multi_select',
  thread: 'text',
  link: 'url',
  attachments: 'checkbox',
  unread: 'checkbox',
  images: 'checkbox',
  category: 'select',
  priority: 'select',
  needsReply: 'checkbox',
  summary: 'text',
  project: 'relation',
}

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
const PRIORITY_COLOR: Record<Priority, ColorName> = { high: 'red', medium: 'yellow', low: 'gray' }

/** Problems that stop a run before Gmail is asked for anything. */
export type TargetProblem = 'shared' | 'trashed' | 'readonly' | 'locked'

export class TargetError extends Error {
  code: TargetProblem
  constructor(code: TargetProblem) {
    super(code)
    this.name = 'TargetError'
    this.code = code
  }
}

export const gmailLink = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`

/** A property's name in the workspace language. */
const nameOf = (role: MailPropRole | 'subject') => t(`features.mail.prop.${role}`)
/** Both languages' names (an adopted database may have been created in the other one). */
const namesOf = (role: MailPropRole) => [ALL_MESSAGES.en[`features.mail.prop.${role}`], ALL_MESSAGES.de[`features.mail.prop.${role}`]].filter(Boolean).map((n) => n.toLowerCase())

/** The roles the database needs with these settings. */
export function neededRoles(cfg: MailSettings): MailPropRole[] {
  const roles = [...GMAIL_ROLES]
  const o = cfg.organise
  if (!o.enabled) return roles
  roles.push('category')
  if (o.priority) roles.push('priority')
  if (o.needsReply) roles.push('needsReply')
  if (o.summary) roles.push('summary')
  if (o.relationDatabaseId) roles.push('project')
  return roles
}

const COLORS: ColorName[] = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray']

/** A stable colour for an option name. */
export function colorFor(name: string): ColorName {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

function makeProp(role: MailPropRole, cfg: MailSettings): PropertyDef {
  const p: PropertyDef = { id: newId(), name: nameOf(role), type: ROLE_TYPE[role] }
  if (GMAIL_ROLES.includes(role)) p.description = t('features.mail.prop.gmailOwned')
  if (role === 'images') p.description = t('features.mail.prop.imagesHint')
  if (role === 'labels') p.options = []
  if (role === 'category') p.options = cfg.organise.categories.map((c) => ({ id: newId(), name: c, color: colorFor(c) }))
  if (role === 'priority') p.options = PRIORITIES.map((x) => ({ id: newId(), name: t(`features.mail.priority.${x}`), color: PRIORITY_COLOR[x] }))
  if (role === 'project') p.relationDatabaseId = cfg.organise.relationDatabaseId ?? undefined
  return p
}

function inboxView(props: PropertyDef[], roles: Partial<Record<MailPropRole, ID>>): View {
  const v = defaultView('table', { properties: props }, t('features.mail.view.inbox'))
  const hidden = new Set(HIDDEN_ROLES.map((r) => roles[r]).filter(Boolean))
  v.visibleProperties = v.visibleProperties.filter((id) => !hidden.has(id))
  if (roles.date) v.sorts = [{ propertyId: roles.date, direction: 'desc' }]
  return v
}

function boardView(props: PropertyDef[], categoryId: ID): View {
  const v = defaultView('board', { properties: props }, t('features.mail.view.byCategory'))
  v.groupBy = categoryId
  return v
}

/** Team workspace? (the database must then be private) */
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** Create the Mails database (private in a team workspace). Returns its id and the property ids by role. */
export function createMailDatabase(cfg: MailSettings): { dbId: ID; props: Partial<Record<MailPropRole, ID>> } {
  const roles = neededRoles(cfg)
  const title: PropertyDef = { id: newId(), name: nameOf('subject'), type: 'title' }
  const made = roles.map((r) => [r, makeProp(r, cfg)] as const)
  const props: PropertyDef[] = [title, ...made.map(([, p]) => p)]
  const byRole: Partial<Record<MailPropRole, ID>> = Object.fromEntries(made.map(([r, p]) => [r, p.id]))
  const views = [inboxView(props, byRole)]
  if (byRole.category) views.push(boardView(props, byRole.category))
  const s = useWorkspace.getState()
  const parent = cfg.parentId && s.pages[cfg.parentId] && !isEffectivelyTrashed(s.pages, cfg.parentId) ? cfg.parentId : null
  const input = { parentId: parent, title: t('features.mail.dbTitle'), icon: { type: 'lucide' as const, value: 'Mail' }, properties: props, views }
  let dbId: ID
  if (inTeam()) {
    // mails are personal: the member's Private section only (a shared parent is never used)
    dbId = createPrivateDatabase({ ...input, parentId: parent && s.pages[parent]?.private ? parent : null })
  } else dbId = s.createDatabase(input)
  return { dbId, props: byRole }
}

/** Can the sync write into this database? Throws TargetError otherwise. */
export function checkTarget(dbId: ID): Database {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const page = s.pages[dbId]
  if (!db || !page) throw new TargetError('trashed')
  if (isEffectivelyTrashed(s.pages, dbId)) throw new TargetError('trashed')
  const c = useCloud.getState()
  if (c.active.kind === 'cloud') {
    if (c.readOnly) throw new TargetError('readonly')
    if (!page.private) throw new TargetError('shared')
  }
  return db
}

/**
 * The property ids of every needed role in `dbId`: the stored id, else a property with the role's name
 * (EN / DE) and type, else a new property (not in a locked database — the role is then left out).
 */
export function ensureProps(dbId: ID, cfg: MailSettings): Partial<Record<MailPropRole, ID>> {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db) return {}
  const out: Partial<Record<MailPropRole, ID>> = {}
  const taken = new Set<ID>()
  for (const role of neededRoles(cfg)) {
    const fits = (p: PropertyDef) => p.type === ROLE_TYPE[role] && !taken.has(p.id) && (role !== 'project' || p.relationDatabaseId === cfg.organise.relationDatabaseId)
    const stored = cfg.props?.[role]
    let prop = db.properties.find((p) => p.id === stored && fits(p))
    prop ??= db.properties.find((p) => fits(p) && namesOf(role).includes(p.name.trim().toLowerCase()))
    if (!prop && !db.locked) {
      const def = makeProp(role, cfg)
      const id = s.addProperty(dbId, def)
      if (HIDDEN_ROLES.includes(role)) for (const v of useWorkspace.getState().databases[dbId]?.views ?? []) s.updateView(dbId, v.id, { visibleProperties: v.visibleProperties.filter((x) => x !== id) })
      if (role === 'category' && !useWorkspace.getState().databases[dbId]?.views.some((v) => v.type === 'board')) s.addView(dbId, { type: 'board', name: t('features.mail.view.byCategory'), groupBy: id })
      prop = useWorkspace.getState().databases[dbId]?.properties.find((p) => p.id === id)
    }
    if (prop) {
      out[role] = prop.id
      taken.add(prop.id)
    }
  }
  return out
}

/**
 * Option ids for names (case-insensitive) of a select / multi-select property; missing options are added
 * (not in a locked database — those names are left out).
 */
export function ensureOptions(dbId: ID, propId: ID, names: string[]): Map<string, ID> {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  const out = new Map<string, ID>()
  if (!db || !prop) return out
  const options: SelectOption[] = [...(prop.options ?? [])]
  let added = false
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (!key || out.has(key)) continue
    let opt = options.find((o) => o.name.trim().toLowerCase() === key)
    if (!opt && !db.locked) {
      opt = { id: newId(), name: name.trim(), color: colorFor(name.trim()) }
      options.push(opt)
      added = true
    }
    if (opt) out.set(key, opt.id)
  }
  if (added) s.updateProperty(dbId, propId, { options })
  return out
}

/** Gmail's system labels in the workspace language (UNREAD is the "Unread" checkbox, CHAT is no mail). */
const SYSTEM_LABELS = ['INBOX', 'SENT', 'IMPORTANT', 'STARRED', 'SPAM', 'TRASH', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']
const SKIP_LABELS = new Set(['UNREAD', 'CHAT'])

/** A label id → its name as an option ('' = not shown as a label). */
export function labelName(id: string, names: Map<string, string>): string {
  if (SKIP_LABELS.has(id)) return ''
  if (SYSTEM_LABELS.includes(id)) return t(`features.mail.label.${id}`)
  return names.get(id) ?? ''
}

const pad = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

/** The Gmail-owned property values of a new row. */
export function rowValues(m: ParsedMail, props: Partial<Record<MailPropRole, ID>>, labelOptions: (labelIds: string[]) => string[]): Record<ID, PropertyValue> {
  const v: Record<ID, PropertyValue> = {}
  const put = (role: MailPropRole, value: PropertyValue) => {
    const id = props[role]
    if (id) v[id] = value
  }
  put('messageId', m.id)
  put('from', m.from)
  put('to', m.to)
  put('date', { start: pad(new Date(m.date)), includeTime: true })
  put('labels', labelOptions(m.labelIds))
  put('unread', m.unread)
  put('attachments', m.attachments.length > 0)
  put('link', gmailLink(m.id))
  put('thread', m.threadId)
  put('images', false)
  return v
}

/** Rows of the database by their stored Gmail message id (dedupe across devices and resets). */
export function rowsByMessageId(dbId: ID, propId: ID | undefined): Map<string, ID> {
  const out = new Map<string, ID>()
  if (!propId) return out
  for (const p of Object.values(useWorkspace.getState().pages)) {
    if (p.databaseId !== dbId) continue
    const v = p.properties[propId]
    if (typeof v === 'string' && v) out.set(v, p.id)
  }
  return out
}
