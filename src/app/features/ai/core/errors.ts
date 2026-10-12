/**
 * AIError: every AI failure, for every provider and for the gate in front of every request (moved here from
 * client.ts, which re-exports it unchanged). The codes are the shared ones (src/shared/ai/errors.ts).
 */
import type { AIErrorCode } from '@/shared/ai/errors'
import { labelOf } from '@/shared/ai/models'
import { legacyRule } from '@/shared/ai/route'
import { useWorkspace } from '../../../store/store'
import { t } from '../../../i18n'

export type { AIErrorCode }

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
  /** `model`: the label of the route the request went to (else this device's Claude model, as before) */
  constructor(code: AIErrorCode, detail?: string, server?: string, model?: string) {
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
  }
}
