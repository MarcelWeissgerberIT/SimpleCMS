/**
 * Which kinds of work each provider takes in this build (design § 6.2, S2 + SJ): a rule that names a provider for a
 * class it does not take yet is skipped to the next level (a step says so). Claude takes every class (the gate's filter
 * refuses it for 'gate' — it cannot decide); OpenRouter the one-shots of S2 and the decisions of SJ ('gate': the Jev
 * family only, core/resolve.ts) — never the terminal, agents, the Outbox, scripts or MCP tests / media; OpenAI none yet.
 */
import type { FeatureClass, ProviderId } from '@/shared/ai/types'
import { FEATURE_CLASSES } from '@/shared/ai/policy'

export const ROUTABLE: Readonly<Record<ProviderId, readonly FeatureClass[]>> = {
  anthropic: FEATURE_CLASSES,
  openai: [],
  local: ['write', 'ask', 'workspace', 'help'],
  ollama: ['write', 'ask', 'workspace', 'help'],
  minimax: ['write', 'ask', 'workspace', 'help'],
  codex: ['write', 'ask', 'workspace', 'help'],
  copilot: FEATURE_CLASSES.filter(c => !['generate', 'gate'].includes(c)),
  openrouter: ['write', 'ask', 'workspace', 'structure', 'vision', 'documents', 'bulk', 'meeting', 'memory', 'help', 'gate'],
}

/** Does `p` take work of class `cls` in this build? */
export const routable = (p: ProviderId, cls: FeatureClass): boolean => ROUTABLE[p].includes(cls)
