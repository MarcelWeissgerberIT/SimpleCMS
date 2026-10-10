/**
 * Writer keys (the formatter lives in store/writer.ts): parse a key, and derive its lane (the track on
 * the tape), its segmentation key and its run key. Pure.
 *
 *   you        = "you" [ "~" Via [ ":" Ref ] ]
 *   editor     = "editor:" Id [ "+m" ]
 *   terminal   = "terminal:" Run [ "#" Change ]
 *   ai         = "ai:" Run ":" Action
 *   agent      = "agent:" Id ":" Run [ "#" Change ] [ "@r" ]
 *   mcp        = "mcp:" Session ":" Call ":" Tool
 *   script     = "script:" ( Id | "-" ) ":" Run [ "<" WriterKey ]
 *   sync       = "sync:" ( "folder" | "github" ) ":" Run
 *   automation = "automation:" Id "/" Id ":" Run [ "<" WriterKey ]
 *   autofill   = "autofill:" Id "/" Id [ ":" Run ] [ "<" WriterKey ]
 *   import     = "import:" Run ":" Source
 *   template   = "template:" Id ":" Run
 *   synced     = "synced<" WriterKey
 *   history    = "history:" Id            mail = "mail:" Run         coding = "coding:" Id ":" Run
 *   kit        = "kit:" Id [ "<" WriterKey ]
 *   member     = "member:" Account        api = "api:" Id            hook = "hook:" Id     "team"
 *   eject      = "eject:" Id ">" WriterKey                 rewind = "rewind:" Id
 *   system     = "system:" SystemWhy                       "unknown"
 */
import type { LaneKey, RunKind } from './types'

export type WriterKind =
  | 'you'
  | 'editor'
  | 'terminal'
  | 'ai'
  | 'agent'
  | 'mcp'
  | 'script'
  | 'sync'
  | 'automation'
  | 'autofill'
  | 'import'
  | 'template'
  | 'synced'
  | 'history'
  | 'mail'
  | 'coding'
  | 'kit'
  | 'member'
  | 'api'
  | 'hook'
  | 'team'
  | 'eject'
  | 'rewind'
  | 'system'
  | 'unknown'

export interface ParsedKey {
  kind: WriterKind
  /** the key without its cause */
  own: string
  /** the colon-separated fields after the kind (own part only) */
  parts: string[]
  /** the writer whose change caused this one (derived writers, scripts run by someone, synced copies) */
  cause?: string
  /** you: how; editor: '+m' mixed */
  via?: string
  ref?: string
  /** terminal / agent: the staged change */
  change?: string
  /** agent: received from elsewhere */
  remote?: boolean
  mixed?: boolean
  /** eject: the writer it ejected */
  of?: string
}

const KINDS = new Set<WriterKind>([
  'you',
  'editor',
  'terminal',
  'ai',
  'agent',
  'mcp',
  'script',
  'sync',
  'automation',
  'autofill',
  'import',
  'template',
  'synced',
  'history',
  'mail',
  'coding',
  'kit',
  'member',
  'api',
  'hook',
  'team',
  'eject',
  'rewind',
  'system',
  'unknown',
])

/** Split a key into its own part and its cause (the first '<'; an eject's `>` part is its own). */
function splitCause(key: string): [string, string | undefined] {
  if (key.startsWith('eject:')) return [key, undefined]
  const i = key.indexOf('<')
  return i < 0 ? [key, undefined] : [key.slice(0, i), key.slice(i + 1) || undefined]
}

export function parseWriterKey(key: string): ParsedKey {
  if (key === 'you' || key.startsWith('you~')) {
    const [, rest = ''] = key.split('~', 2)
    const [via, ref] = rest ? [rest.split(':')[0], rest.includes(':') ? rest.slice(rest.indexOf(':') + 1) : undefined] : [undefined, undefined]
    return { kind: 'you', own: key, parts: [], ...(via ? { via } : {}), ...(ref ? { ref } : {}) }
  }
  if (key === 'team' || key === 'unknown') return { kind: key, own: key, parts: [] }
  if (key.startsWith('synced<')) return { kind: 'synced', own: 'synced', parts: [], cause: key.slice(7) || 'unknown' }
  if (key.startsWith('eject:')) {
    const gt = key.indexOf('>')
    const id = gt < 0 ? key.slice(6) : key.slice(6, gt)
    return { kind: 'eject', own: `eject:${id}`, parts: [id], of: gt < 0 ? 'unknown' : key.slice(gt + 1) }
  }
  const [own, cause] = splitCause(key)
  const colon = own.indexOf(':')
  const kind = (colon < 0 ? own : own.slice(0, colon)) as WriterKind
  if (!KINDS.has(kind) || colon < 0) return { kind: 'unknown', own: key, parts: [] }
  let body = own.slice(colon + 1)
  const out: ParsedKey = { kind, own, parts: [], ...(cause ? { cause } : {}) }
  if (kind === 'editor' && body.endsWith('+m')) {
    out.mixed = true
    body = body.slice(0, -2)
  }
  if (kind === 'agent' && body.endsWith('@r')) {
    out.remote = true
    body = body.slice(0, -2)
  }
  if ((kind === 'agent' || kind === 'terminal') && body.includes('#')) {
    out.change = body.slice(body.indexOf('#') + 1)
    body = body.slice(0, body.indexOf('#'))
  }
  if (kind === 'automation' || kind === 'autofill') {
    // "<db>/<id>[:<run>]"
    const [pair, ...rest] = body.split(':')
    const [db = '-', id = '-'] = pair.split('/')
    out.parts = [db, id, ...rest]
    return out
  }
  out.parts = body.split(':')
  return out
}

/** The writer key and its causes, newest first: `automation:…<script:…<you` → [automation…, script…, you]. */
export function causeChain(key: string): string[] {
  const out: string[] = []
  let k: string | undefined = key
  for (let i = 0; k && i < 8; i++) {
    const p = parseWriterKey(k)
    out.push(p.own)
    k = p.cause
  }
  return out
}

/** A client id as a lane slug ([a-z0-9-], ≤ 40). */
export function clientSlug(client: string | null | undefined): string {
  const s = (client ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || '-'
}

/** Where a session's MCP client is known (noteRun meta.client). */
export type ClientOf = (session: string) => string | null | undefined

const UNDO_KINDS = new Set<WriterKind>(['history', 'eject', 'rewind'])

/**
 * The lane (track) of a writer. `you~*` (but `you~undo`) and editors → 'you'; Undo, restores and ejects →
 * 'undo'; synced copies sit on their cause's lane (flag COPY).
 */
export function laneOf(key: string, clientOf?: ClientOf): LaneKey {
  const p = parseWriterKey(key)
  switch (p.kind) {
    case 'you':
      return p.via === 'undo' ? 'undo' : 'you'
    case 'editor':
      return 'you'
    case 'history':
    case 'eject':
    case 'rewind':
      return 'undo'
    case 'terminal':
    case 'ai':
    case 'autofill':
    case 'import':
    case 'template':
    case 'mail':
    case 'coding':
    case 'kit':
    case 'api':
    case 'hook':
    case 'team':
    case 'unknown':
      return p.kind
    case 'agent':
      return `agent:${p.parts[0] ?? '-'}`
    case 'mcp':
      return `mcp:${clientSlug(clientOf?.(p.parts[0] ?? '') ?? null)}`
    case 'script':
      return `script:${p.parts[0] ?? '-'}`
    case 'sync':
      return `sync:${p.parts[0] === 'github' ? 'github' : 'folder'}`
    case 'automation':
      return `automation:${p.parts[0]}/${p.parts[1]}`
    case 'member':
      return `member:${p.parts[0] ?? '-'}`
    case 'synced':
      return laneOf(p.cause ?? 'unknown', clientOf)
    case 'system':
      return 'system'
  }
}

/** Is this a synced-block copy (drawn on its cause's lane, never counted for it)? */
export const isCopyKey = (key: string): boolean => key.startsWith('synced<')

/**
 * The run key of a writer (its flag on the tape), or null for writers without runs: the person,
 * editors, synced copies, kit, autofill without a run, members, API, hooks, system.
 */
export function runKeyOf(key: string): string | null {
  const p = parseWriterKey(key)
  const [a = '-', b = '-', c] = p.parts
  switch (p.kind) {
    case 'agent':
      return `agent:${a}:${b}`
    case 'terminal':
      return `terminal:${a}`
    case 'mcp':
      return `mcp:${a}:${b}`
    case 'script':
      return `script:${a}:${b}`
    case 'ai':
      return `ai:${a}`
    case 'import':
      return `import:${a}`
    case 'sync':
      return `sync:${a}:${b}`
    case 'automation':
      return `automation:${a}/${b}:${c ?? '-'}`
    case 'autofill':
      return c ? `autofill:${a}/${b}:${c}` : null
    case 'template':
      return `template:${a}:${b}`
    case 'mail':
      return `mail:${a}`
    case 'coding':
      return `coding:${a}:${b}`
    case 'eject':
      return `eject:${a}`
    case 'rewind':
      return `rewind:${a}`
    default:
      return null
  }
}

/** The run kind of a run key. */
export function runKindOf(runKey: string): RunKind | null {
  const kind = runKey.slice(0, runKey.indexOf(':')) as RunKind
  const KNOWN: RunKind[] = ['agent', 'terminal', 'mcp', 'script', 'ai', 'import', 'sync', 'automation', 'autofill', 'template', 'mail', 'coding', 'eject', 'rewind']
  return KNOWN.includes(kind) ? kind : null
}

/**
 * The reference a run record keeps to its source: AgentRun.id · batch id · MCP activity key
 * (`<session>:<call>`) · ScriptRun.id · AIRun.id · import / pick-up / eject id.
 */
export function runRefOf(runKey: string): string {
  const p = parseWriterKey(runKey)
  switch (p.kind) {
    case 'agent':
    case 'script':
    case 'sync':
    case 'coding':
    case 'template':
      return p.parts[1] ?? '-'
    case 'mcp':
      return `${p.parts[0] ?? '-'}:${p.parts[1] ?? '-'}`
    case 'automation':
    case 'autofill':
      return p.parts[2] ?? '-'
    default:
      return p.parts[0] ?? '-'
  }
}

/** Runs that get a pennant on the tape (the others are ranges). */
export const FLAG_KINDS = new Set<RunKind>(['agent', 'terminal', 'mcp', 'script', 'ai', 'import', 'sync', 'eject', 'rewind'])

/**
 * The segmentation key: all of the person's writers on this device are ONE writer ('you'); every Undo /
 * restore / eject its own stretch (its full key); machine writers their run; derived writers without a
 * run their key with its cause; members, API, hooks, team their key.
 */
export function segKeyOf(key: string): string {
  if (isCopyKey(key)) return key
  const lane = laneOf(key)
  if (lane === 'you') return 'you'
  if (lane === 'undo') return key
  return runKeyOf(key) ?? key
}

/** Human writers (segments split after 2 min idle; typing folds). */
export const isHumanSeg = (sk: string): boolean => sk === 'you' || sk.startsWith('member:')

/** Writers whose CONTENT / TITLE updates fold into one event per 30 s. */
export function foldsTyping(key: string, sk: string): boolean {
  if (isHumanSeg(sk)) return true
  const p = parseWriterKey(key)
  return p.kind === 'ai' && p.parts[1] === 'meeting_transcript'
}
