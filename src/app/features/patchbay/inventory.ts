/**
 * What runs or is wired to run by itself — the one inventory both the Patchbay and Workspace › Automation count
 * (plan §1.2): custom agents, scripts, database automations, own database commands, repeating database templates, and
 * the live databases they sit in. Pure: the readers of other areas' stored lists are passed in (`WiringReaders` —
 * readers.ts holds the app's), so Node specs run it on plain data.
 *
 * No page-map walk: a database is live when its page and every page above it are out of the trash and outside
 * templates — looked up per database id, O(#databases × depth). (Own functions and own templates do not run by
 * themselves; Workspace › Automation adds them to its list — shell/workspace/automation.ts.)
 */
import { sanitizeAgents } from '../../store/agents'
import { sanitizeScripts } from '../../store/scripts'
import type { Automation, CustomAgent, Database, DbCommand, ID, OneScript, Page, Workspace } from '../../store/types'

type DbTemplate = NonNullable<Database['templates']>[number]

/** How other areas read their stored lists (features/automations readAutomations · features/commands readDbCommands). */
export interface WiringReaders {
  automations: (raw: unknown) => Automation[]
  commands: (raw: unknown) => DbCommand[]
}

export interface WiringInventory {
  agents: CustomAgent[]
  scripts: OneScript[]
  automations: Array<{ dbId: ID; automation: Automation }>
  /** own commands only (the switched-off / moved defaults are not commands of their own) */
  commands: Array<{ dbId: ID; command: DbCommand }>
  /** row templates with a schedule */
  repeating: Array<{ dbId: ID; template: DbTemplate }>
  /** the live databases (not in the trash, not below a page there, outside templates), by title */
  databases: Database[]
}

export type WiringSource = Pick<Workspace, 'pages' | 'databases' | 'agents' | 'scripts'>

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** Is the database's page live: it and every page above it out of the trash and outside templates (cycle-safe)? */
function isLive(pages: Record<ID, Page>, id: ID): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  if (!cur) return false
  while (cur && !seen.has(cur.id)) {
    if (cur.trashed || cur.template) return false
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return true
}

/** The live databases, sorted by their page's title (the order Workspace › Automation lists them in). */
export function liveDatabases(pages: Record<ID, Page>, databases: Record<ID, Database>): Database[] {
  const out: Database[] = []
  for (const id in databases) if (isLive(pages, databases[id].id)) out.push(databases[id])
  return out.sort((a, b) => (pages[a.id]?.title ?? '').localeCompare(pages[b.id]?.title ?? ''))
}

export function wiringInventory(s: WiringSource, read: WiringReaders): WiringInventory {
  const dbs = liveDatabases(s.pages, s.databases)
  return {
    agents: Object.values(sanitizeAgents(s.agents).agents).sort(byName),
    scripts: Object.values(sanitizeScripts(s.scripts).scripts).sort(byName),
    automations: dbs.flatMap((db) => read.automations(db.automations).map((automation) => ({ dbId: db.id, automation }))),
    commands: dbs.flatMap((db) =>
      read
        .commands(db.commands)
        .filter((c) => c.kind !== 'default')
        .map((command) => ({ dbId: db.id, command })),
    ),
    repeating: dbs.flatMap((db) => (db.templates ?? []).filter((tpl) => !!tpl.repeat).map((template) => ({ dbId: db.id, template }))),
    databases: dbs,
  }
}

/** How many things the inventory holds (what Workspace › Automation's lead counts, without functions and templates). */
export const wiringCount = (inv: WiringInventory): number => inv.agents.length + inv.scripts.length + inv.automations.length + inv.commands.length + inv.repeating.length
