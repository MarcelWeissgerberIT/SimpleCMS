/**
 * Codewords for external MCP servers: a free-form request that starts with "<codeword>:" ("kb: what
 * is X", also several: "kb: wiki: …") addresses those servers — client.ts attaches them whatever
 * their scope (a switched-off server stays off and is reported), removes the prefix from the
 * request and tells Claude to answer with their tools first.
 *
 * A codeword is 1–24 characters a–z, 0–9, "_" and "-", lower case, unique in the list and never
 * "one" (One's own MCP codeword in Claude Desktop, features/mcp). Pure functions: the server list is
 * passed in (config.ts reads and sanitizes it).
 */
import type { McpServerConfig } from '../../../store/types'

export const CODEWORD_MAX = 24
/** "one:" belongs to One's own MCP server (Claude Desktop / Code). */
export const RESERVED_CODEWORD = 'one'

const CODEWORD_RE = /^[a-z0-9_-]+$/
/** A leading "<word>:" (the colon right after the word, any space after it). */
const PREFIX_RE = /^\s*([a-z0-9_-]{1,24}):\s*/i

/** What was typed, as a codeword: trimmed, lower case, without the colon ("Atlas:" → "atlas"). */
export function normalizeCodeword(raw: string): string {
  return raw.trim().toLowerCase().replace(/:+$/, '').trim()
}

export type CodewordProblem = '' | 'format' | 'long' | 'reserved' | 'taken'

/** Why a (normalized) codeword can't be used ('' = fine, also for '' = none). `others`: the other servers' codewords. */
export function codewordProblem(cw: string, others: string[]): CodewordProblem {
  if (!cw) return ''
  if (cw.length > CODEWORD_MAX) return 'long'
  if (!CODEWORD_RE.test(cw)) return 'format'
  if (cw === RESERVED_CODEWORD) return 'reserved'
  if (others.some((o) => o.toLowerCase() === cw)) return 'taken'
  return ''
}

/** The suggestion for a server without a codeword: its name ('' when that can't be used). */
export function suggestCodeword(name: string, others: string[]): string {
  const cw = normalizeCodeword(name).slice(0, CODEWORD_MAX).replace(/[-_]+$/, '')
  return cw && !codewordProblem(cw, others) ? cw : ''
}

/** The servers a request addresses with its leading codewords, and the request without them. */
export interface CodewordHit {
  text: string
  servers: McpServerConfig[]
}

/** Read the leading codewords of `text` (case-insensitive). Without one, `text` comes back unchanged. */
export function parseCodewords(text: string, servers: McpServerConfig[]): CodewordHit {
  const byWord = new Map<string, McpServerConfig>()
  for (const s of servers) if (s.codeword) byWord.set(s.codeword, s)
  if (!byWord.size) return { text, servers: [] }
  const hit: McpServerConfig[] = []
  let rest = text
  for (;;) {
    const m = PREFIX_RE.exec(rest)
    const server = m ? byWord.get(m[1].toLowerCase()) : undefined
    if (!m || !server) break
    if (!hit.includes(server)) hit.push(server)
    rest = rest.slice(m[0].length)
  }
  return hit.length ? { text: rest, servers: hit } : { text, servers: [] }
}

/** What Claude is told about a server the person addressed by its codeword. */
export const addressedLine = (name: string) => `The person addressed ${name} by its codeword: answer with its tools first; say when it has nothing.`

/** What Claude is told about an addressed server that is switched off (the agent, where no note shows it). */
export const switchedOffLine = (name: string) =>
  `The person addressed ${name} by its codeword, but ${name} is switched off in One (Settings → Claude AI): say so in one short line, then work without it.`

/** The line in a server's usage prompt that names its codeword. */
export const codewordGuideLine = (cw: string) => `Codeword: "${cw}" — when the person starts a request with "${cw}:" or names "${cw}", they mean this server.`
