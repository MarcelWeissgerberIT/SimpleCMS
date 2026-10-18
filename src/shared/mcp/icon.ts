/**
 * One MCP — the icon a tool takes (pure; the local bridge and the team server alike): an emoji, "asset:<name>" or
 * "lucide:<IconName>"; "" (or null) removes it. Anything else — a word, a sentence, markup — is refused, so a word
 * never shows as a page's icon in every member's sidebar.
 */

export type McpIcon = { type: 'emoji' | 'asset' | 'lucide'; value: string }

export const MCP_ICON_HINT = 'an emoji (e.g. "🚀"), "asset:<name>" or "lucide:<IconName>" ("" removes the icon)'

/** undefined: leave it as it is · null: remove it · the icon · `{ error }`: what the refusal says (no code, no full stop). */
export function mcpIcon(raw: unknown): McpIcon | null | undefined | { error: string } {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw !== 'string') return { error: `"icon" must be ${MCP_ICON_HINT}` }
  const s = raw.trim()
  if (!s) return null
  const named = /^(asset|lucide):([A-Za-z0-9_-]{1,64})$/.exec(s)
  if (named) return { type: named[1] as 'asset' | 'lucide', value: named[2]! }
  const emoji = s.length <= 16 && !/[A-Za-z\s<>]/.test(s) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u.test(s)
  if (!emoji) return { error: `"icon" must be ${MCP_ICON_HINT} — got ${JSON.stringify(s.slice(0, 40))}` }
  return { type: 'emoji', value: s }
}

export const isIconError = (v: ReturnType<typeof mcpIcon>): v is { error: string } => !!v && 'error' in v
