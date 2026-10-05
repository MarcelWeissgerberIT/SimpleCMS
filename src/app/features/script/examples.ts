/**
 * One Script — the starter examples of the #/scripts list. Their code points at a real database of
 * this workspace (a project / task database when there is one) with a stable @ reference, so a dry
 * run works right away; the comments say what to adapt.
 */
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { Database, Page, PropertyDef } from '../../store/types'
import type { Lang } from '@/shared/i18n'
import { nameCode } from './builder/model'

export type ExampleId = 'raise' | 'mail' | 'query'

export const EXAMPLES: Array<{ id: ExampleId; kind: 'script' | 'query' }> = [
  { id: 'query', kind: 'query' },
  { id: 'raise', kind: 'script' },
  { id: 'mail', kind: 'script' },
]

const refOf = (p: Page) => `@[${(p.title.trim() || 'Untitled').replace(/[\]\\]/g, (c) => `\\${c}`)}](p:${p.id})`

/** The database the examples use: one with a status and a date, else the first one. */
function pickDb(): { page: Page; db: Database } | null {
  const { pages, databases } = useWorkspace.getState()
  const live = Object.values(databases)
    .map((db) => ({ db, page: pages[db.id] }))
    .filter((x): x is { db: Database; page: Page } => !!x.page && !x.page.trashed && !isEffectivelyTrashed(pages, x.page.id) && !inTemplate(pages, x.page.id) && !x.db.system)
    .sort((a, b) => a.page.createdAt - b.page.createdAt)
  const good = live.find((x) => x.db.properties.some((p) => p.type === 'status' || p.type === 'select') && x.db.properties.some((p) => p.type === 'date'))
  return good ?? live[0] ?? null
}

const statusOf = (db: Database): PropertyDef | undefined => db.properties.find((p) => p.type === 'status') ?? db.properties.find((p) => p.type === 'select')
const dateOf = (db: Database): PropertyDef | undefined => db.properties.find((p) => p.type === 'date')
const prioOf = (db: Database, status: PropertyDef | undefined): PropertyDef | undefined => db.properties.find((p) => p.type === 'select' && p.id !== status?.id)
/** The option that means "done" (a status' complete group, else the last option). */
const doneOf = (p: PropertyDef | undefined): string => {
  const opts = p?.options ?? []
  return (opts.find((o) => o.group === 'done') ?? opts[opts.length - 1])?.name ?? 'Done'
}

/** The code of an example in the person's language. */
export function exampleCode(id: ExampleId, lang: Lang): string {
  const de = lang === 'de'
  const pick = pickDb()
  const dbRef = pick ? refOf(pick.page) : de ? '@"Aufgaben"' : '@"Tasks"'
  const status = pick ? statusOf(pick.db) : undefined
  const date = pick ? dateOf(pick.db) : undefined
  const prio = pick ? prioOf(pick.db, status) : undefined
  const S = nameCode(status?.name ?? 'Status')
  const D = nameCode(date?.name ?? (de ? 'Fällig' : 'Due'))
  const P = nameCode(prio?.name ?? (de ? 'Priorität' : 'Priority'))
  const done = JSON.stringify(doneOf(status))
  const high = JSON.stringify(prio?.options?.[0]?.name ?? (de ? 'Hoch' : 'High'))
  if (id === 'query')
    return de
      ? `# Offene Einträge, die nächsten zuerst — das Ergebnis steht live darunter\ndb(${dbRef}).where(${S} != ${done}).sort(${D}).limit(10)\n`
      : `# Open entries, soonest first — the result shows live below\ndb(${dbRef}).where(${S} != ${done}).sort(${D}).limit(10)\n`
  if (id === 'raise')
    return de
      ? `# Alles Offene, das in den nächsten 3 Tagen fällig ist, bekommt Priorität ${high}.\n# Erst ⌘⇧↵ (Probelauf): zeigt, was sich ändern würde.\nlet fällig = db(${dbRef}).where(${S} != ${done}, ${D} < today() + 3d)\n\nfor t in fällig {\n  t.set(${P}: ${high})\n}\n\nnotify("{fällig.count} Einträge hochgestuft")\n`
      : `# Everything open that is due within 3 days gets priority ${high}.\n# Try ⌘⇧↵ first (dry run): it shows what would change.\nlet due = db(${dbRef}).where(${S} != ${done}, ${D} < today() + 3d)\n\nfor t in due {\n  t.set(${P}: ${high})\n}\n\nnotify("{due.count} entries raised")\n`
  return de
    ? `# Schickt eine Seite als Mail — vor dem Lauf fragt One nach.\n# Ohne verbundenes Gmail öffnet sich ein fertiger Entwurf in deinem Mailprogramm.\nlet an = ask("An wen?", default: "team@example.com")\nlet eintrag = choose("Welche Seite?", db(${dbRef}).limit(5).rows)\n\nif eintrag {\n  mail.send(to: an, subject: eintrag.title, body: eintrag.markdown)\n  modal("Gesendet", buttons: ["OK"])\n}\n`
    : `# Sends a page as a mail — One asks before the run.\n# Without Gmail connected, a ready draft opens in your mail program.\nlet to = ask("Send to?", default: "team@example.com")\nlet entry = choose("Which page?", db(${dbRef}).limit(5).rows)\n\nif entry {\n  mail.send(to: to, subject: entry.title, body: entry.markdown)\n  modal("Sent", buttons: ["OK"])\n}\n`
}
