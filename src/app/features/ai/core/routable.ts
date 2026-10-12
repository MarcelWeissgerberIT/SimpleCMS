/**
 * Which kinds of work each provider takes in this build (design § 6.2, S2): a rule that names a provider for a class
 * it does not take yet is skipped to the next level (a step says so). Claude takes every class; OpenRouter the
 * one-shots of S2 — never the terminal, agents, the Outbox, scripts, MCP tests / media or the gate; OpenAI none yet.
 */
import type { FeatureClass, ProviderId } from '@/shared/ai/types'
import { FEATURE_CLASSES } from '@/shared/ai/policy'

export const ROUTABLE: Readonly<Record<ProviderId, readonly FeatureClass[]>> = {
  anthropic: FEATURE_CLASSES,
  openai: [],
  openrouter: ['write', 'ask', 'workspace', 'structure', 'vision', 'documents', 'bulk', 'meeting', 'memory', 'help'],
}

/** Does `p` take work of class `cls` in this build? */
export const routable = (p: ProviderId, cls: FeatureClass): boolean => ROUTABLE[p].includes(cls)
