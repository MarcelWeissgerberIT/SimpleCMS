/**
 * The script scan (plan §1.17) — pure: what a One Script reaches, read from its syntax tree. Nothing runs. The engine
 * (One Script's parser, `loadScriptEngine()` — a lazy chunk) is passed in: inputs.ts hands the loaded engine over on
 * route open, Node specs pass the language module itself. Results are cached by `script.id + updatedAt` (memory here,
 * the lazy cache in IndexedDB — B4).
 *
 *  - `@[Label](p:<id>)` refs are reads — or writes when a write member is called on them (`.set` · `.append` ·
 *    `.prepend` · `.replace` · `.trash` on a page or row; `.add` on a database = a new row), also through `db(@X)`,
 *    `page(@X)`, `let x = …`, `for r in db(@X) { r.set(…) }` (rows of X) and `create.page(…, @Parent)`;
 *  - `page.current` / `page.here` / `page` written = the page the script runs for (an automation's row, a command's
 *    rows, a button's page): `context`;
 *  - refs by name (`@Name`, `db("Tessera")`) cannot be followed: `byName` (shown as "?");
 *  - effects: the names the runner asks for once per run (its own rule, script/runtime/check.ts needsCheck) — `mail`,
 *    `claude`, `http`, `trash`.
 */
import type { ID, OneScript } from '../../store/types'
import type { KitScan, Place, ScriptScan } from './types'

/** The part of One Script's syntax tree the scan reads (lang/ast.ts; kept structural so this file imports no area). */
type N = { type: string; [k: string]: unknown }

/** What the scan needs from the engine (features/script engine.ts: parse · walk · needsCheck). */
export interface ScanEngine {
  parse(source: string): { type: 'Program'; body: unknown[]; source: string }
  walk(node: never, fn: (n: never) => void): void
  needsCheck?(program: never): boolean
}

const WRITE_MEMBERS = new Set(['set', 'append', 'prepend', 'replace', 'trash', 'add'])
const EFFECTS = ['mail', 'claude', 'http', 'trash'] as const
type Effect = (typeof EFFECTS)[number]

const isNode = (v: unknown): v is N => !!v && typeof v === 'object' && typeof (v as N).type === 'string'
const lower = (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : '')

/** What an expression stands for, as far as the scan can tell. */
type Target = { kind: 'ref'; id: ID } | { kind: 'rows'; id: ID } | { kind: 'context' } | { kind: 'byName' } | null

/** Scan one script (null: it does not parse — nothing is known). */
export function scanScript(script: Pick<OneScript, 'code' | 'updatedAt'>, engine: ScanEngine): ScriptScan | null {
  let program: { type: 'Program'; body: unknown[]; source: string }
  try {
    program = engine.parse(script.code)
  } catch {
    return null
  }
  const walk = (node: unknown, fn: (n: N) => void) => engine.walk(node as never, fn as never)

  // let / for bindings: name → the expression it holds (the last one wins; a loop variable stands for the rows)
  const lets = new Map<string, unknown>()
  const loops = new Map<string, unknown>()
  for (const st of program.body) {
    walk(st, (n) => {
      if (n.type === 'Let' && typeof n.name === 'string') lets.set(n.name, n.value)
      if (n.type === 'For' && typeof n.name === 'string') loops.set(n.name, n.iter)
    })
  }

  let byName = false
  const resolve = (e: unknown, depth = 0): Target => {
    if (!isNode(e) || depth > 8) return null
    switch (e.type) {
      case 'Ref':
        if (e.kind === 'p' && typeof e.id === 'string' && e.id) return { kind: 'ref', id: e.id }
        if (e.kind === 'name') return { kind: 'byName' }
        return null
      case 'Str':
        return { kind: 'byName' }
      case 'Ident': {
        const name = e.name as string
        if (lower(name) === 'page') return { kind: 'context' }
        if (loops.has(name)) {
          const t = resolve(loops.get(name), depth + 1)
          return t && t.kind === 'ref' ? { kind: 'rows', id: t.id } : t
        }
        if (lets.has(name)) return resolve(lets.get(name), depth + 1)
        return null
      }
      case 'Member': {
        const obj = e.object
        const m = lower(e.name)
        if (isNode(obj) && obj.type === 'Ident' && lower(obj.name) === 'page' && (m === 'current' || m === 'here')) return { kind: 'context' }
        const t = resolve(obj, depth + 1)
        // db(@X).rows / .items / .list / .where(…) … stand for the rows of X
        if (t && t.kind === 'ref' && ['rows', 'items', 'list', 'first', 'last'].includes(m)) return { kind: 'rows', id: t.id }
        return t
      }
      case 'Call': {
        const callee = e.callee
        const args = Array.isArray(e.args) ? (e.args as Array<{ value: unknown }>) : []
        if (isNode(callee) && callee.type === 'Ident' && ['db', 'page'].includes(lower(callee.name))) return resolve(args[0]?.value, depth + 1)
        // a query step (where / sort / limit …) keeps standing for the rows of what it was called on
        if (isNode(callee) && callee.type === 'Member') {
          const t = resolve(callee.object, depth + 1)
          if (t && t.kind === 'ref' && ['where', 'filter', 'sort', 'select', 'limit', 'take', 'skip', 'find', 'map'].includes(lower(callee.name))) return { kind: 'rows', id: t.id }
          return t
        }
        return null
      }
      case 'Index':
        return resolve(e.object, depth + 1)
      default:
        return null
    }
  }

  const reads = new Map<string, Place>()
  const writes = new Map<string, Place>()
  let context = false
  const effects = new Set<Effect>()
  const write = (p: Place) => writes.set(JSON.stringify(p), p)

  walk(program, (n) => {
    if (n.type === 'Ref') {
      if (n.kind === 'p' && typeof n.id === 'string' && n.id) reads.set(n.id, { page: n.id })
      else if (n.kind === 'name') byName = true
    }
    if (n.type === 'Ident') {
      const name = lower(n.name)
      if ((EFFECTS as readonly string[]).includes(name)) effects.add(name as Effect)
    }
    if (n.type === 'Member' && lower(n.name) === 'trash') effects.add('trash')
    if (n.type !== 'Call' || !isNode(n.callee)) return
    const callee = n.callee
    const args = Array.isArray(n.args) ? (n.args as Array<{ value: unknown; name: string | null }>) : []
    // db("Name") / page("A / B"): by name
    if (callee.type === 'Ident' && ['db', 'page'].includes(lower(callee.name)) && isNode(args[0]?.value) && (args[0].value as N).type === 'Str') byName = true
    // create.page(title, @Parent): a new page below the parent
    if (callee.type === 'Member' && lower(callee.name) === 'page' && isNode(callee.object) && callee.object.type === 'Ident' && lower(callee.object.name) === 'create') {
      const parent = args.find((a) => a.name === 'parent')?.value ?? args[1]?.value
      const t = parent ? resolve(parent) : null
      if (t?.kind === 'ref') write({ page: t.id })
      else if (t?.kind === 'context') context = true
      else if (t?.kind === 'byName') byName = true
      return
    }
    // trash(x) — the global
    if (callee.type === 'Ident' && lower(callee.name) === 'trash') {
      const t = resolve(args[0]?.value)
      if (t?.kind === 'ref') write({ page: t.id })
      else if (t?.kind === 'rows') write({ db: t.id, prop: '*' })
      else if (t?.kind === 'context') context = true
      else if (t?.kind === 'byName') byName = true
      return
    }
    if (callee.type !== 'Member') return
    const member = lower(callee.name)
    if (!WRITE_MEMBERS.has(member)) return
    const t = resolve(callee.object)
    if (!t) return
    if (t.kind === 'byName') byName = true
    else if (t.kind === 'context') context = true
    else if (t.kind === 'rows') write({ db: t.id, prop: member === 'add' ? '+row' : '*' })
    else if (member === 'add') write({ db: t.id, prop: '+row' })
    else write({ page: t.id })
  })

  // a written ref is no read of its own (the write reaches it anyway)
  const written = new Set<string>()
  for (const p of writes.values()) written.add('page' in p ? p.page : 'db' in p ? p.db : '')
  const readList = [...reads.values()].filter((p) => !('page' in p) || !written.has(p.page))
  const asks = engine.needsCheck ? engine.needsCheck(program as never) : effects.size > 0
  return {
    at: script.updatedAt,
    reads: readList,
    writes: [...writes.values()],
    effects: asks ? EFFECTS.filter((x) => effects.has(x)) : [],
    byName,
    ...(context ? { context: true } : {}),
  }
}

/**
 * fix (rest): a kit value code's reach (null: it does not parse — nothing is known). A value script runs in query mode
 * (features/kit recompute.ts): writes are refused, never the read — every place it names is a read, also one a write
 * member is called on; `page` / `row` are its own row.
 */
export function scanKitCode(code: string, engine: ScanEngine): KitScan | null {
  const scan = scanScript({ code, updatedAt: 0 }, engine)
  if (!scan) return null
  const reads = new Map<string, Place>()
  for (const p of [...scan.reads, ...scan.writes]) {
    const id = 'db' in p ? p.db : 'page' in p ? p.page : null
    if (id && !reads.has(id)) reads.set(id, { page: id })
  }
  return { reads: [...reads.values()], byName: scan.byName }
}

/** A memory cache of scans by `id + updatedAt` (the lazy cache in IndexedDB keeps the same records — B4). */
export class ScanCache {
  private map = new Map<string, ScriptScan | null>()

  get(script: Pick<OneScript, 'id' | 'updatedAt'>): ScriptScan | null | undefined {
    return this.map.get(`${script.id}@${script.updatedAt}`)
  }

  /** Scan what is not cached yet (ids + updatedAt); returns whether anything new was scanned. */
  fill(scripts: ReadonlyArray<Pick<OneScript, 'id' | 'code' | 'updatedAt'>>, engine: ScanEngine): boolean {
    let fresh = false
    const keep = new Set<string>()
    for (const s of scripts) {
      const key = `${s.id}@${s.updatedAt}`
      keep.add(key)
      if (this.map.has(key)) continue
      this.map.set(key, scanScript(s, engine))
      fresh = true
    }
    for (const k of [...this.map.keys()]) if (!keep.has(k)) this.map.delete(k)
    return fresh
  }

  /** The scans as the model input takes them (script id → scan; a script that does not parse is left out). */
  byId(scripts: ReadonlyArray<Pick<OneScript, 'id' | 'updatedAt'>>): Record<ID, ScriptScan> {
    const out: Record<ID, ScriptScan> = {}
    for (const s of scripts) {
      const scan = this.get(s)
      if (scan) out[s.id] = scan
    }
    return out
  }
}
