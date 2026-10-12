/**
 * AIError: every AI failure, for every provider and for the gate in front of every request (moved here from
 * client.ts, which re-exports it unchanged). The codes are the shared ones (src/shared/ai/errors.ts).
 */
import type { AIErrorCode } from '@/shared/ai/errors'
import type { DataClass, ProviderId } from '@/shared/ai/types'
import { labelOf } from '@/shared/ai/models'
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
export type AIFix = { kind: 'step'; step: 'key' | 'models' | 'data'; provider: ProviderId; data?: DataClass } | { kind: 'askClaude' } | { kind: 'pick'; need: FixNeed }

/** The friendly sentence for an error code (in the current UI language). */
export function aiErrorText(code: AIErrorCode, v: { model: string; detail?: string; server?: string }): string {
  if (code === 'mcp') return t(v.server ? 'features.ai.err.mcp' : 'features.ai.err.mcpAny', { server: v.server ?? '', detail: v.detail ?? '' })
  if (code === 'mcp_auth') return t(v.server ? 'features.ai.err.mcp_auth' : 'features.ai.err.mcp_authAny', { server: v.server ?? '' })
  return t(`features.ai.err.${code}`, { model: v.model, detail: v.detail ?? '' })
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
