/**
 * AIError: every AI failure, for every provider and for the gate in front of every request (moved here from
 * client.ts, which re-exports it unchanged). The codes are the shared ones (src/shared/ai/errors.ts).
 */
import type { AIErrorCode } from '@/shared/ai/errors'
import type { DataClass, ProviderId, Route } from '@/shared/ai/types'
import { labelOf, providerLabel } from '@/shared/ai/models'
import { providerInfo } from '@/shared/ai/providers'
import { legacyRule } from '@/shared/ai/route'
import { useWorkspace } from '../../../store/store'
import { t } from '../../../i18n'

export type { AIErrorCode }

/** A capability a request needs of its model (core/purposes.ts Need — repeated here so errors stay dependency-free). */
type FixNeed = 'structured' | 'tools' | 'vision' | 'pdf' | 'mcp' | 'listing'

/**
 * What the person can do about a refused request (D-S2-37) — one shape, rendered by one component: a step of the
 * setup assistant (its key, its models, its data rule — `data` = the class), ask Claude instead (an addressed MCP server
 * on a route that cannot connect it), or pick a model that can do what the request needs.
 */
export type AIFix =
  | { kind: 'step'; step: 'key' | 'models' | 'data'; provider: ProviderId; data?: DataClass }
  | { kind: 'askClaude' }
  | { kind: 'pick'; need: FixNeed }
  /**
   * The governor's red line (AIError 'budget'): E allows +`allow` USD once (null: it would not fit), `need` is what is
   * missing, `cheaper` a model of the same provider that fits (B: the same request with it as a chip), the request's
   * band and the lowest rest with its line — rendered by features/governor's BrakeNote.
   */
  | { kind: 'brake'; allow: number | null; need: number; cheaper?: Route; band: { low: number; high: number }; rest: number; binding: string | null; line?: { spent: number; limit: number } }

/**
 * The provider a route's label names: other providers' labels start with their name ("OpenRouter · …",
 * registry.ts labelFor); Claude's are the registry's own ("Claude Opus 5.5").
 */
export function providerOfLabel(label: string): ProviderId {
  for (const p of ['openrouter', 'openai'] as const) if (label === providerLabel(p) || label.startsWith(`${providerLabel(p)} ·`)) return p
  return 'anthropic'
}

/** The friendly sentence for an error code (in the current UI language) — naming the company and host of the route. */
export function aiErrorText(code: AIErrorCode, v: { model: string; detail?: string; server?: string }): string {
  if (code === 'mcp') return t(v.server ? 'features.ai.err.mcp' : 'features.ai.err.mcpAny', { server: v.server ?? '', detail: v.detail ?? '' })
  if (code === 'mcp_auth') return t(v.server ? 'features.ai.err.mcp_auth' : 'features.ai.err.mcp_authAny', { server: v.server ?? '' })
  const info = providerInfo(providerOfLabel(v.model))
  return t(`features.ai.err.${code}`, { model: v.model, detail: v.detail ?? '', company: info.company, host: info.host })
}

/** The model a message names: this device's Claude model (an unknown setting reads as the default, as it is sent). */
function modelName(): string {
  const [route] = legacyRule(useWorkspace.getState().settings.aiModel, true)
  return route ? labelOf(route) : 'Claude'
}

/** An AI failure. `message` is a friendly, localized sentence; `detail` keeps the raw API message. */
export class AIError extends Error {
  code: AIErrorCode
  detail?: string
  /** 'mcp': the server's name ('' = not known) */
  server?: string
  /** what to do about it (the first refused pin's fix) */
  fix?: AIFix
  /** one fix per refused pin of the winning rule (the first = `fix`) */
  fixes?: AIFix[]
  /** the label of the route the message names (absent: this device's Claude model) */
  label?: string
  /** `model`: the label of the route the request went to (else this device's Claude model, as before) */
  constructor(code: AIErrorCode, detail?: string, server?: string, model?: string, fixes?: readonly AIFix[]) {
    let message: string = code
    try {
      message = aiErrorText(code, { model: model ?? modelName(), detail, server })
    } catch {
      /* i18n unavailable — keep the code */
    }
    super(message)
    this.name = 'AIError'
    this.code = code
    this.detail = detail
    this.server = server
    if (model) this.label = model
    if (fixes?.length) {
      this.fix = fixes[0]
      this.fixes = [...fixes]
    }
  }
}
