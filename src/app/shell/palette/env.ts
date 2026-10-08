/**
 * The workspace as ⌘K filters see it (filters.ts / suggest.ts are pure): pages, databases, people, who
 * "me" is, and the database area's computed values (formulas, rollups, display text) through its public API.
 */
import type { CustomAgent, Database, ID, Page, Person } from '../../store/types'
import { activeWorkspace, useCloud } from '../../cloud'
import { meFor, propertyFormulaValue, propertyValueToText } from '../../database'
import type { FilterEnv } from './filters'

export interface EnvSource {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  lang: 'en' | 'de'
  agents: Record<ID, CustomAgent> | undefined
}

export function filterEnv(s: EnvSource, now: number): FilterEnv {
  const team = activeWorkspace().kind === 'cloud'
  return {
    now,
    lang: s.lang,
    team,
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    agents: Object.values(s.agents ?? {}).map((a) => ({ id: a.id, name: a.name })),
    meId: team ? (useCloud.getState().user?.id ?? null) : null,
    me: meFor,
    computed: propertyFormulaValue,
    text: propertyValueToText,
  }
}
