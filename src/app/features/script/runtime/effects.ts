/**
 * One Script runtime — effects: the only ways a script reaches outside One. Each has a safe default
 * implementation and can be replaced with registerEffect() (the integrations add Gmail for mail.send):
 *
 *  - mail.send({ to, cc, bcc, subject, body }) → { status: 'sent' | 'draft' } — default: a ready
 *    draft in the person's mail program (a mailto: link), nothing is sent by One itself
 *  - claude({ prompt, context }) → text — default: the AI client with the person's own key (one
 *    completion, no MCP servers)
 *  - http.post({ url, data }) → { status, body } — default: a JSON POST to an https address
 *
 * A run asks the person once before any of them happens (dry runs and queries never call them).
 */
export type EffectName = 'mail.send' | 'claude' | 'http.post'

export interface MailInput {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

export interface ClaudeInput {
  prompt: string
  /** extra material for the prompt ('' = none) */
  context: string
}

export interface HttpInput {
  url: string
  data: unknown
}

export interface EffectInputs {
  'mail.send': MailInput
  claude: ClaudeInput
  'http.post': HttpInput
}

export interface EffectOutputs {
  'mail.send': { status: 'sent' | 'draft'; id?: string }
  claude: string
  'http.post': { status: number; body: unknown }
}

export interface EffectEnv {
  signal: AbortSignal
  scriptName: string
  lang: 'en' | 'de'
}

export type EffectImpl<K extends EffectName> = (input: EffectInputs[K], env: EffectEnv) => Promise<EffectOutputs[K]>

/* ------------------------------------------------------------------ defaults */

/** mailto: with a body that fits the length mail programs accept (≈ 1,800 characters). */
export function mailtoUrl(m: MailInput): string {
  // addresses keep their "@" readable (RFC 6068); everything else is percent-encoded
  const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@')
  const params: string[] = []
  if (m.cc.length) params.push(`cc=${enc(m.cc.join(','))}`)
  if (m.bcc.length) params.push(`bcc=${enc(m.bcc.join(','))}`)
  if (m.subject) params.push(`subject=${enc(m.subject)}`)
  let body = m.body
  const head = `mailto:${m.to.map(enc).join(',')}?${params.join('&')}`
  while (body && (head + `&body=${enc(body)}`).length > 1900) body = `${body.slice(0, Math.floor(body.length * 0.8))}…`
  if (body) params.push(`body=${enc(body)}`)
  return `mailto:${m.to.map(enc).join(',')}${params.length ? `?${params.join('&')}` : ''}`
}

const defaultMail: EffectImpl<'mail.send'> = async (m) => {
  // the person's mail program opens with the draft; One sends nothing itself
  window.open(mailtoUrl(m), '_self')
  return { status: 'draft' }
}

const SCRIPT_SYSTEM = 'You are called from a small script in One, a local-first notes app. Answer the request directly and concisely, in the language of the request. Reply with the answer only — no preamble.'

const defaultClaude: EffectImpl<'claude'> = async (input, env) => {
  const { streamCompletion } = await import('../../ai/client')
  const prompt = input.context ? `${input.prompt}\n\n<context>\n${input.context}\n</context>` : input.prompt
  return (await streamCompletion({ system: SCRIPT_SYSTEM, prompt, signal: env.signal, mcp: false })).trim()
}

const defaultHttp: EffectImpl<'http.post'> = async (input, env) => {
  const url = new URL(input.url)
  if (url.protocol !== 'https:') throw new Error('only https:// addresses')
  const res = await fetch(url.href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.data ?? null), signal: env.signal, credentials: 'omit', redirect: 'follow' })
  const text = (await res.text()).slice(0, 200_000)
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* plain text */
  }
  return { status: res.status, body }
}

/* ------------------------------------------------------------------ registry */

const defaults: { [K in EffectName]: EffectImpl<K> } = { 'mail.send': defaultMail, claude: defaultClaude, 'http.post': defaultHttp }
const impls: { [K in EffectName]?: EffectImpl<K> } = {}
/** what the confirm list says about how an effect happens now ("via Gmail · ada@…"), per registration */
const notes: { [K in EffectName]?: () => string | null } = {}

/**
 * Replace the implementation of an effect (e.g. mail.send through the person's Gmail). Returns a
 * function that puts the previous one back. The run still asks the person before calling it.
 * `note`: a short line the run's confirm list shows next to such an effect (null: none right now).
 */
export function registerEffect<K extends EffectName>(name: K, impl: EffectImpl<K>, opts: { note?: () => string | null } = {}): () => void {
  const prev = impls[name]
  const prevNote = notes[name]
  ;(impls as Record<string, unknown>)[name] = impl
  notes[name] = opts.note
  return () => {
    if (impls[name] !== impl) return
    ;(impls as Record<string, unknown>)[name] = prev
    notes[name] = prevNote
  }
}

/** The confirm list's note of an effect (null: none). */
export function effectNote(name: EffectName): string | null {
  try {
    return notes[name]?.() ?? null
  } catch {
    return null
  }
}

export function effectImpl<K extends EffectName>(name: K): EffectImpl<K> {
  return (impls[name] ?? defaults[name]) as EffectImpl<K>
}
