/**
 * "New integration": the generic template the person completes — every feature unlocked, the built-in mirror recipe
 * written out in full (the database's properties and views, the agent's instructions with their [PLACEHOLDERS]) and
 * an EMPTY match (the profile stays inactive until the person says which server it is for). From a picked server:
 * match = that server's tested read tools + its name. Nothing here names a service.
 */
import type { Lang } from '@/shared/i18n'
import { INTEGRATION_FEATURES, type IntegrationMatch, type IntegrationProfile, type McpServerConfig } from '../../../store/types'
import { INTEGRATION_SCHEMA } from '../../../store/integrations'
import { makeTranslator } from '@/shared/i18n'
import { ALL_MESSAGES } from '../../../i18n'
import { isReadTool } from '../mcpTools'
import { defaultMirror } from './recipe'

/** "tracker-2" — a profile id not taken yet. */
export function freeProfileId(base: string, taken: string[]): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 56) || 'integration'
  let id = slug
  for (let n = 2; taken.includes(id); n++) id = `${slug}-${n}`
  return id
}

/** The template as a JSON-ready value (a draft: its match is empty unless a server was picked). */
export function integrationTemplate(lang: Lang, taken: string[], server?: Pick<McpServerConfig, 'name' | 'tools'> | null): Omit<IntegrationProfile, 'match'> & { match: IntegrationMatch } {
  const tr = makeTranslator(ALL_MESSAGES, lang)
  const recipe = defaultMirror(lang, true)
  const match: IntegrationMatch = {}
  if (server) {
    const read = (server.tools ?? []).filter(isReadTool)
    if (read.length) match.tools = read.slice(0, 50)
    match.name = server.name
  }
  return {
    schema: INTEGRATION_SCHEMA,
    id: freeProfileId(server ? server.name : tr('features.integrations.template.id'), taken),
    name: server ? tr('features.integrations.template.nameFor', { server: server.name }) : tr('features.integrations.template.name'),
    description: tr('features.integrations.template.description'),
    match,
    unlocks: [...INTEGRATION_FEATURES],
    recipes: [recipe],
  }
}
