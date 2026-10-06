/**
 * Everything in the workspace that runs or is built to be reused — read only, for the workspace page's
 * Automation section: custom agents, scripts, custom functions, database automations, own database
 * commands, repeating entries (row templates with a schedule) and own templates. Every list is read the
 * way its area reads it (sanitized); nothing here runs anything.
 */
import { useMemo } from 'react'
import { useWorkspace } from '../../store/store'
import { sanitizeAgents } from '../../store/agents'
import { sanitizeScripts } from '../../store/scripts'
import { sanitizeFunctions } from '../../store/functions'
import { isEffectivelyTrashed, inTemplate } from '../../store/selectors'
import type { Automation, CustomAgent, CustomFunction, Database, DbCommand, ID, OneScript, Page, Workspace } from '../../store/types'
import { readDbCommands, templateRoots } from '../../features'

type DbTemplate = NonNullable<Database['templates']>[number]

export interface AutomationInventory {
  agents: CustomAgent[]
  scripts: OneScript[]
  functions: CustomFunction[]
  automations: Array<{ dbId: ID; automation: Automation }>
  commands: Array<{ dbId: ID; command: DbCommand }>
  repeating: Array<{ dbId: ID; template: DbTemplate }>
  templates: Page[]
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** Databases that count: live, outside templates. */
function liveDatabases(pages: Record<ID, Page>, databases: Record<ID, Database>): Database[] {
  return Object.values(databases)
    .filter((db) => {
      const p = pages[db.id]
      return !!p && !p.trashed && !isEffectivelyTrashed(pages, db.id) && !inTemplate(pages, db.id)
    })
    .sort((a, b) => (pages[a.id]?.title ?? '').localeCompare(pages[b.id]?.title ?? ''))
}

export function automationInventory(s: Pick<Workspace, 'pages' | 'databases' | 'agents' | 'scripts' | 'functions'>): AutomationInventory {
  const dbs = liveDatabases(s.pages, s.databases)
  return {
    agents: Object.values(sanitizeAgents(s.agents).agents).sort(byName),
    scripts: Object.values(sanitizeScripts(s.scripts).scripts).sort(byName),
    functions: Object.values(sanitizeFunctions(s.functions).functions).sort(byName),
    automations: dbs.flatMap((db) => (db.automations ?? []).map((automation) => ({ dbId: db.id, automation }))),
    commands: dbs.flatMap((db) => readDbCommands(db.commands).filter((c) => c.kind !== 'default').map((command) => ({ dbId: db.id, command }))),
    repeating: dbs.flatMap((db) => (db.templates ?? []).filter((tpl) => !!tpl.repeat).map((template) => ({ dbId: db.id, template }))),
    templates: templateRoots(s.pages),
  }
}

export const inventoryCount = (inv: AutomationInventory) =>
  inv.agents.length + inv.scripts.length + inv.functions.length + inv.automations.length + inv.commands.length + inv.repeating.length + inv.templates.length

export function useAutomationInventory(): AutomationInventory {
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const agents = useWorkspace((s) => s.agents)
  const scripts = useWorkspace((s) => s.scripts)
  const functions = useWorkspace((s) => s.functions)
  return useMemo(() => automationInventory({ pages, databases, agents, scripts, functions }), [pages, databases, agents, scripts, functions])
}
