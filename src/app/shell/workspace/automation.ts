/**
 * Everything in the workspace that runs or is built to be reused — read only, for the workspace page's
 * Automation section: custom agents, scripts, custom functions, database automations, own database
 * commands, repeating entries (row templates with a schedule) and own templates. Every list is read the
 * way its area reads it (sanitized); nothing here runs anything.
 *
 * What runs (or is wired to run) by itself is the Patchbay's wiring inventory (features/patchbay inventory.ts —
 * agents, scripts, automations, own commands, repeating entries, live databases): both screens count the same.
 * Custom functions and own templates are added here only — they do not run by themselves.
 */
import { useMemo } from 'react'
import { useWorkspace } from '../../store/store'
import { sanitizeFunctions } from '../../store/functions'
import type { CustomFunction, Page, Workspace } from '../../store/types'
import { templateRoots, wiringInventory, WIRING_READERS, type WiringInventory } from '../../features'

export interface AutomationInventory extends WiringInventory {
  functions: CustomFunction[]
  templates: Page[]
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

export function automationInventory(s: Pick<Workspace, 'pages' | 'databases' | 'agents' | 'scripts' | 'functions'>): AutomationInventory {
  return {
    ...wiringInventory(s, WIRING_READERS),
    functions: Object.values(sanitizeFunctions(s.functions).functions).sort(byName),
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
