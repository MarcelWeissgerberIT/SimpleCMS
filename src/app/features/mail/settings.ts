/**
 * Settings → Mail (`settings.mail`): defaults, normalization (a stored value may be partial, from an
 * older build or hand-edited) and the one writer. Per device like every setting; nothing in it is a
 * secret — the OAuth client ID is public and access tokens never leave the tab's memory (auth.ts).
 */
import { useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { useWorkspace } from '../../store/store'
import type { MailOrganise, MailPropRole, MailSettings } from '../../store/types'

/** Read-only Gmail access — the only scope One ever asks for. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
/** "123456789012-abc….apps.googleusercontent.com" */
export const CLIENT_ID_RE = /^\d{5,}-[a-z0-9_]{8,}\.apps\.googleusercontent\.com$/i
/** What a client SECRET looks like (pasted by mistake): refused, never stored. */
export const SECRET_RE = /^GOCSPX-|client_secret/i
/** The origin One is published at (Google's "Authorized JavaScript origins"). */
export const PUBLIC_ORIGIN = 'https://getonecms.com'

export const MAX_PER_RUN = [25, 50, 100, 200, 500]
export const EVERY_MIN = [5, 10, 15, 30, 60]
export const MAX_CATEGORIES = 12
export const CATEGORY_MAX_LEN = 32

const DEFAULT_CATEGORIES = {
  en: ['Customer', 'Invoice', 'Newsletter', 'Personal', 'Notification', 'Todo'],
  de: ['Kunde', 'Rechnung', 'Newsletter', 'Persönlich', 'Benachrichtigung', 'Todo'],
}

const ROLES: MailPropRole[] = ['messageId', 'from', 'to', 'date', 'labels', 'thread', 'link', 'attachments', 'unread', 'images', 'category', 'priority', 'needsReply', 'summary', 'project']

/** 30 days ago, local "YYYY-MM-DD". */
export function defaultFrom(now = new Date()): string {
  return format(subDays(now, 30), 'yyyy-MM-dd')
}

export function defaultCategories(lang: string): string[] {
  return [...(lang === 'de' ? DEFAULT_CATEGORIES.de : DEFAULT_CATEGORIES.en)]
}

const lang = () => useWorkspace.getState().settings.language

export function defaultOrganise(l = lang()): MailOrganise {
  return { enabled: false, categories: defaultCategories(l), priority: true, needsReply: true, summary: true, relationDatabaseId: null }
}

export function defaultMail(l = lang()): MailSettings {
  return {
    clientId: '',
    from: defaultFrom(),
    labels: ['INBOX'],
    excludeSpamTrash: true,
    maxPerRun: 50,
    auto: 'manual',
    everyMin: 15,
    parentId: null,
    databaseId: null,
    props: {},
    organise: defaultOrganise(l),
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const idOrNull = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null)

/** A category name as stored: one line, trimmed, at most CATEGORY_MAX_LEN characters. */
export function cleanCategory(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, CATEGORY_MAX_LEN) : ''
}

/** Unique (case-insensitive), non-empty, at most MAX_CATEGORIES. */
export function cleanCategories(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const c = cleanCategory(raw)
    if (!c || seen.has(c.toLowerCase())) continue
    seen.add(c.toLowerCase())
    out.push(c)
    if (out.length >= MAX_CATEGORIES) break
  }
  return out
}

/** The stored value (anything) → complete, valid MailSettings. */
export function normalizeMail(raw: unknown, l = lang()): MailSettings {
  const d = defaultMail(l)
  if (!isObj(raw)) return d
  const labels = Array.isArray(raw.labels) ? [...new Set(raw.labels.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,80}$/.test(x)))] : d.labels
  const props: Partial<Record<MailPropRole, string>> = {}
  if (isObj(raw.props)) for (const r of ROLES) if (idOrNull(raw.props[r])) props[r] = raw.props[r] as string
  const o = isObj(raw.organise) ? raw.organise : {}
  const cats = cleanCategories(o.categories)
  return {
    clientId: str(raw.clientId, 160),
    from: typeof raw.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.from) ? raw.from : d.from,
    labels: labels.length ? labels : d.labels,
    excludeSpamTrash: typeof raw.excludeSpamTrash === 'boolean' ? raw.excludeSpamTrash : d.excludeSpamTrash,
    maxPerRun: MAX_PER_RUN.includes(Number(raw.maxPerRun)) ? Number(raw.maxPerRun) : d.maxPerRun,
    auto: raw.auto === 'open' || raw.auto === 'interval' || raw.auto === 'manual' ? raw.auto : d.auto,
    everyMin: EVERY_MIN.includes(Number(raw.everyMin)) ? Number(raw.everyMin) : d.everyMin,
    parentId: idOrNull(raw.parentId),
    databaseId: idOrNull(raw.databaseId),
    props,
    organise: {
      enabled: o.enabled === true,
      categories: Array.isArray(o.categories) ? cats : d.organise.categories,
      priority: typeof o.priority === 'boolean' ? o.priority : d.organise.priority,
      needsReply: typeof o.needsReply === 'boolean' ? o.needsReply : d.organise.needsReply,
      summary: typeof o.summary === 'boolean' ? o.summary : d.organise.summary,
      relationDatabaseId: idOrNull(o.relationDatabaseId),
    },
  }
}

/** The current mail settings (complete). */
export function readMail(): MailSettings {
  return normalizeMail(useWorkspace.getState().settings.mail)
}

/** Change the mail settings (normalized; a client SECRET is never stored). */
export function setMail(patch: Partial<MailSettings>): void {
  const next = normalizeMail({ ...readMail(), ...patch })
  if (SECRET_RE.test(next.clientId)) next.clientId = ''
  useWorkspace.getState().updateSettings({ mail: next })
}

export function setOrganise(patch: Partial<MailOrganise>): void {
  setMail({ organise: { ...readMail().organise, ...patch } })
}

/** React: the current mail settings (complete), re-rendered when they change. */
export function useMailSettings(): MailSettings {
  const raw = useWorkspace((s) => s.settings.mail)
  const l = useWorkspace((s) => s.settings.language)
  return useMemo(() => normalizeMail(raw, l), [raw, l])
}

/** What a full listing covers: a change here means "list again from the date" (sync.ts). */
export function scopeOf(cfg: MailSettings): string {
  return `${cfg.from}|${[...cfg.labels].sort().join(',')}|${cfg.excludeSpamTrash ? 'x' : 'a'}`
}
