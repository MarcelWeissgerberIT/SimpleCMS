/**
 * one-worker — secrets never go to One (worker 1.13.0). Every text the worker sends (log lines, tool lines and their
 * edit hunks, sections, test output, git diffs, errors) passes the Scrubber (scrub.ts), which removes, before any path:
 *  - the exact value of every credential variable in the worker's environment (Claude Code inherits it): the named ones
 *    below, plus any variable whose NAME ends in KEY / TOKEN / SECRET / PASSWORD with a value of 12+ characters — as
 *    "[secret <NAME>]"
 *  - key-shaped text by pattern ("sk-ant-…", "sk-…" — src/shared/ai/keys.ts, the app's own rule) — as "••••"
 * A secret is replaced before a text is cut to length (never a key in halves past the scrubber).
 *
 * And which credential Claude Code will use, said without revealing it (`claudeAuth`): an API key / auth token from the
 * environment (the last 4 characters only), a cloud provider, or the person's own Claude Code sign-in. In `claude -p`
 * the environment's key wins over apiKeyHelper and the /login subscription, without asking.
 */
import { scrubSecrets } from '../../../src/shared/ai/keys.ts'

/** Credential variables scrubbed by name, whatever their length (≥ 8: nothing shorter is a credential). */
export const SECRET_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN',
  'GITLAB_PRIVATE_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AZURE_CLIENT_SECRET',
  'NPM_TOKEN',
] as const

/** Any other variable whose name says it holds a secret. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)$/i
const NAMED_MIN = 8
const OTHER_MIN = 12

export interface SecretValue {
  name: string
  value: string
}

/** The secret values of an environment, longest first (a value inside another is replaced after it). */
export function secretValues(env: NodeJS.ProcessEnv = process.env): SecretValue[] {
  const named = new Set<string>(SECRET_ENV.map((n) => n.toUpperCase()))
  const out = new Map<string, string>()
  for (const [name, raw] of Object.entries(env)) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    const upper = name.toUpperCase()
    const min = named.has(upper) ? NAMED_MIN : SECRET_NAME.test(name) ? OTHER_MIN : null
    if (min === null || value.length < min) continue
    // the first name a value is found under names it
    if (!out.has(value)) out.set(value, upper)
  }
  return [...out].map(([value, name]) => ({ name, value })).sort((a, b) => b.value.length - a.value.length)
}

/** The text without the given secret values and without key-shaped text. */
export function scrubSecretText(s: string, secrets: readonly SecretValue[]): string {
  let out = s
  for (const { name, value } of secrets) if (out.includes(value)) out = out.split(value).join(`[secret ${name}]`)
  return scrubSecrets(out)
}

/* ------------------------------------------------------------------ which credential Claude Code uses */

export interface ClaudeAuth {
  /** a log code of lines.ts */
  code: 'authCloud' | 'authToken' | 'authApiKey' | 'authOAuthToken' | 'authLogin'
  v: Record<string, string>
  /** the English line */
  s: string
}

const set = (env: NodeJS.ProcessEnv, name: string) => {
  const v = env[name]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}
const truthy = (env: NodeJS.ProcessEnv, name: string) => {
  const v = set(env, name)
  return v !== null && !/^(0|false|no|off)$/i.test(v)
}

/** "…ab12" — the last 4 characters only (a value under 12 characters shows none). */
export const last4 = (v: string): string => (v.length >= 12 ? `…${v.slice(-4)}` : '…')

/**
 * The credential Claude Code takes from this environment, in its own order: a cloud provider (CLAUDE_CODE_USE_BEDROCK /
 * _VERTEX / _FOUNDRY), then ANTHROPIC_AUTH_TOKEN, then ANTHROPIC_API_KEY, then (after an apiKeyHelper, which the worker
 * cannot see) CLAUDE_CODE_OAUTH_TOKEN — else the person's own Claude Code sign-in (/login, or an apiKeyHelper).
 */
export function claudeAuth(env: NodeJS.ProcessEnv): ClaudeAuth {
  const cloud = truthy(env, 'CLAUDE_CODE_USE_BEDROCK') ? 'Amazon Bedrock' : truthy(env, 'CLAUDE_CODE_USE_VERTEX') ? 'Google Vertex AI' : truthy(env, 'CLAUDE_CODE_USE_FOUNDRY') ? 'Microsoft Foundry' : null
  if (cloud) return { code: 'authCloud', v: { provider: cloud }, s: `Claude Code bills: ${cloud} (cloud provider from the environment)` }
  const token = set(env, 'ANTHROPIC_AUTH_TOKEN')
  if (token) return { code: 'authToken', v: { name: 'ANTHROPIC_AUTH_TOKEN', last: last4(token) }, s: `Claude Code bills: auth token from ANTHROPIC_AUTH_TOKEN · ${last4(token)}` }
  const key = set(env, 'ANTHROPIC_API_KEY')
  if (key) return { code: 'authApiKey', v: { name: 'ANTHROPIC_API_KEY', last: last4(key) }, s: `Claude Code bills: API key from ANTHROPIC_API_KEY · ${last4(key)}` }
  const oauth = set(env, 'CLAUDE_CODE_OAUTH_TOKEN')
  if (oauth) return { code: 'authOAuthToken', v: { name: 'CLAUDE_CODE_OAUTH_TOKEN', last: last4(oauth) }, s: `Claude Code bills: sign-in token from CLAUDE_CODE_OAUTH_TOKEN · ${last4(oauth)} (unless an apiKeyHelper is set)` }
  return { code: 'authLogin', v: {}, s: 'Claude Code bills: your Claude Code sign-in (claude /login, or an apiKeyHelper in its settings)' }
}
