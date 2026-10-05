/**
 * One Script runtime — One's standard library (the global names a script sees besides the built-ins):
 *   page(ref | "A / B" | title) · page.current · db(ref | name) · create.page(…) · trash(x) ·
 *   person(name) · people() · me() · modal / confirm / ask / choose / notify / open ·
 *   mail.send(…) · claude(prompt, context?) · http.post(url, data)
 * plus @ references and the workspace's custom functions (built by clicking, lib/formulaFunctions).
 * Nothing here reaches the browser, storage, keys or the network except through the effects.
 */
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import { formulaFunctions, type FormulaPlain } from '../../../lib/formulaFunctions'
import type { ID, Page } from '../../../store/types'
import {
  HostObject,
  SDate,
  SDuration,
  SRecord,
  ScriptError,
  argAt,
  native,
  needList,
  needText,
  normName,
  toPlain,
  toText,
  typeName,
  type Args,
  type CallCtx,
  type NativeFn,
  type RefInput,
  type Value,
} from '../lang'
import type { Host } from './host'
import { AgentObj, PageObj, PersonObj, QueryObj, ScriptRefObj, hostOf, reachable } from './objects'

const ws = () => useWorkspace.getState()
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The object for a reachable page: a database is a query, other pages (rows too) are pages. */
export function objectFor(host: Host, page: Page): Value {
  return page.kind === 'database' && ws().databases[page.id] ? new QueryObj(host, page.id) : new PageObj(host, page.id)
}

/** Live pages with this title (templates and the trash left out). */
function byTitle(title: string, filter: (p: Page) => boolean = () => true): Page[] {
  const n = norm(title)
  if (!n) return []
  const out: Page[] = []
  for (const p of Object.values(ws().pages)) if (norm(p.title) === n && filter(p) && reachable(p.id)) out.push(p)
  return out
}

/** "Team wiki / Onboarding / Checklist": walk down by titles from the top level. */
function byPath(path: string): Page[] {
  const parts = path.split('/').map((x) => norm(x)).filter(Boolean)
  if (parts.length < 2) return []
  const { pages } = ws()
  let level: Page[] = Object.values(pages).filter((p) => !p.parentId && reachable(p.id) && norm(p.title) === parts[0])
  for (const part of parts.slice(1)) {
    const ids = new Set(level.map((p) => p.id))
    level = Object.values(pages).filter((p) => p.parentId && ids.has(p.parentId) && norm(p.title) === part && reachable(p.id))
  }
  return level
}

function one(found: Page[], what: string, name: string): Page {
  if (!found.length) throw new ScriptError('not_found', { what, name: JSON.stringify(name) })
  if (found.length > 1) throw new ScriptError('ambiguous', { name: JSON.stringify(name), n: found.length, what })
  return found[0]
}

/** page(…) / db(…) argument → the page it means. */
function pageArg(v: Value, what: 'page' | 'database'): Page {
  if (v instanceof PageObj) return v.page
  if (v instanceof QueryObj) {
    const p = reachable(v.dbId)
    if (!p) throw new ScriptError('not_found', { what, name: v.dbId })
    return p
  }
  if (typeof v === 'string') {
    const s = v.trim()
    const direct = reachable(s)
    if (direct) return direct
    const filter = what === 'database' ? (p: Page) => p.kind === 'database' && !!ws().databases[p.id] : () => true
    if (s.includes('/')) {
      const path = byPath(s).filter(filter)
      if (path.length) return one(path, what, s)
    }
    return one(byTitle(s, filter), what, s)
  }
  throw new ScriptError('bad_args', { name: what === 'page' ? 'page' : 'db', detail: `expected @page, a title or a path, got ${typeName(v)}` })
}

/** Resolve an @ reference. */
export function resolveRef(host: Host, ref: RefInput): Value {
  const s = ws()
  if (ref.kind === 'p' && ref.id) {
    const p = reachable(ref.id)
    if (!p) throw new ScriptError('not_found', { what: 'page', name: `@${ref.label}` })
    return objectFor(host, p)
  }
  if (ref.kind === 'u' && ref.id) {
    const person = s.people.find((x) => x.id === ref.id)
    if (!person) throw new ScriptError('not_found', { what: 'person', name: `@${ref.label}` })
    return new PersonObj(person)
  }
  if (ref.kind === 'a' && ref.id) {
    const agent = s.agents?.[ref.id]
    if (!agent) throw new ScriptError('not_found', { what: 'agent', name: `@${ref.label}` })
    return new AgentObj(agent)
  }
  if (ref.kind === 's' && ref.id) {
    const script = s.scripts?.[ref.id]
    if (!script) throw new ScriptError('not_found', { what: 'script', name: `@${ref.label}` })
    return new ScriptRefObj(script)
  }
  // @Name / @"Some name": a page or database by title, then a person, an agent, a script
  const pages = byTitle(ref.label)
  if (pages.length) return objectFor(host, one(pages, 'pages', ref.label))
  const people = s.people.filter((x) => norm(x.name) === norm(ref.label))
  if (people.length === 1) return new PersonObj(people[0])
  const agents = Object.values(s.agents ?? {}).filter((a) => norm(a.name) === norm(ref.label))
  if (agents.length === 1) return new AgentObj(agents[0])
  const scripts = Object.values(s.scripts ?? {}).filter((a) => norm(a.name) === norm(ref.label))
  if (scripts.length === 1) return new ScriptRefObj(scripts[0])
  throw new ScriptError('not_found', { what: 'page', name: `@${ref.label}` })
}

/* ------------------------------------------------------------------ helpers */

/** An object with methods only (create, mail, http). */
class Namespace extends HostObject {
  constructor(
    readonly typeName: string,
    private readonly fns: Record<string, NativeFn>,
  ) {
    super()
  }
  method(name: string): NativeFn | undefined {
    const key = normName(name)
    return Object.prototype.hasOwnProperty.call(this.fns, key) ? this.fns[key] : undefined
  }
  member(name: string): Value | undefined {
    return this.method(name)
  }
  display(): string {
    return this.typeName
  }
  equals(other: Value): boolean {
    return other === this
  }
  toPlain(): unknown {
    return this.typeName
  }
}

const addresses = (v: Value): string[] =>
  (Array.isArray(v) ? v : v === null ? [] : [v])
    .flatMap((x) => (x instanceof PersonObj ? [] : toText(x).split(/[,;]/)))
    .map((x) => x.trim())
    .filter(Boolean)

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/

/** One line for the confirm list. */
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A script value as a formula value (custom functions). */
function toFormula(v: Value): FormulaPlain {
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (v instanceof SDate) return v.date
  if (v instanceof SDuration) return v.total / 86_400_000
  if (Array.isArray(v)) return v.map(toFormula)
  return toText(v)
}

function fromFormula(v: FormulaPlain): Value {
  if (v instanceof Date) return v.getHours() || v.getMinutes() ? SDate.at(v) : SDate.day(v)
  if (Array.isArray(v)) return v.map(fromFormula)
  return v
}

/* ------------------------------------------------------------------ the globals */

export function globalsFor(host: Host): Record<string, Value> {
  const page = native(
    'page',
    (args, ctx) => {
      const p = pageArg(argAt(args, 0), 'page')
      return new PageObj(hostOf(ctx), p.id)
    },
    {
      members: {
        current: () => {
          const id = host.contextPageId
          const p = id ? host.page(id) : null
          if (!p) throw new ScriptError('no_context')
          return objectFor(host, p)
        },
      },
    },
  )

  const db = native('db', (args, ctx) => {
    const v = argAt(args, 0)
    if (v instanceof QueryObj) return v
    const p = pageArg(v, 'database')
    if (p.kind !== 'database' || !ws().databases[p.id]) throw new ScriptError('not_found', { what: 'database', name: JSON.stringify(p.title) })
    return new QueryObj(hostOf(ctx), p.id)
  })

  const create = new Namespace('create', {
    page: native('page', async (args, ctx) => {
      const title = needText(argAt(args, 0, 'title'), ctx)
      const parent = argAt(args, 1, 'parent')
      let parentId: ID | null = null
      if (parent !== null) {
        const p = parent instanceof PageObj ? parent.page : pageArg(parent, 'page')
        if (p.kind === 'database') throw new ScriptError('bad_args', { name: 'create.page', detail: 'a database gets entries with db(@X).add(…)' })
        parentId = p.id
      }
      const markdown = argAt(args, 2, 'markdown')
      const id = await host.createPage({ title, parentId, markdown: markdown === null ? '' : needText(markdown, ctx) })
      return new PageObj(host, id)
    }),
  })

  const trash = native('trash', async (args, ctx) => {
    let n = 0
    for (const x of Array.isArray(argAt(args, 0)) ? (argAt(args, 0) as Value[]) : [argAt(args, 0)]) {
      await ctx.step()
      if (x instanceof PageObj) {
        if (await host.trash(x.page)) n++
      } else if (x instanceof QueryObj && !x.ops.length) {
        if (await host.trash(pageArg(x, 'database'))) n++
      } else if (x instanceof QueryObj) {
        for (const row of await x.items(ctx)) if (row instanceof PageObj && (await host.trash(row.page))) n++
      } else throw new ScriptError('bad_args', { name: 'trash', detail: `expected a page or row, got ${typeName(x)}` })
    }
    return n
  })

  const person = native('person', (args, ctx) => {
    const v = argAt(args, 0)
    if (v instanceof PersonObj) return v
    const name = needText(v, ctx)
    const hit = ws().people.filter((p) => p.id === name || norm(p.name) === norm(name))
    if (!hit.length) throw new ScriptError('not_found', { what: 'person', name: JSON.stringify(name) })
    return new PersonObj(hit[0])
  })

  const people = native('people', () => ws().people.map((p) => new PersonObj(p)))

  const me = native('me', () => {
    const s = ws()
    const c = useCloud.getState()
    if (c.active.kind === 'cloud') {
      const p = s.people.find((x) => x.id === c.user?.id)
      return p ? new PersonObj(p) : null
    }
    const name = norm(s.settings.userName)
    const p = (name && s.people.find((x) => norm(x.name) === name)) || s.people.find((x) => ['you', 'du'].includes(norm(x.name)))
    return p ? new PersonObj(p) : null
  })

  const signal = host.signal
  const modal = native('modal', async (args, ctx) => {
    const text = needText(argAt(args, 0, 'text'), ctx)
    const raw = argAt(args, 1, 'buttons')
    const buttons = (raw === null ? ['OK'] : needList(Array.isArray(raw) ? raw : [raw], ctx).map(toText)).filter(Boolean).slice(0, 6)
    return host.dialog('modal()', () => ctx.waitUser(host.ui.modal(text, buttons.length ? buttons : ['OK'], signal)), buttons[0] ?? 'OK')
  })
  const confirm = native('confirm', async (args, ctx) => {
    const text = needText(argAt(args, 0, 'text'), ctx)
    return host.dialog('confirm()', () => ctx.waitUser(host.ui.confirm(text, signal)), true)
  })
  const ask = native('ask', async (args, ctx) => {
    const text = needText(argAt(args, 0, 'text'), ctx)
    const def = argAt(args, 1, 'default')
    const d = def === null ? '' : toText(def)
    return host.dialog('ask()', () => ctx.waitUser(host.ui.ask(text, d, signal)), d)
  })
  const choose = native('choose', async (args, ctx) => {
    const text = needText(argAt(args, 0, 'text'), ctx)
    const options = needList(argAt(args, 1, 'options'), ctx).slice(0, 50)
    if (!options.length) throw new ScriptError('bad_args', { name: 'choose', detail: 'no options' })
    const labels = options.map(toText)
    const picked = await host.dialog('choose()', () => ctx.waitUser(host.ui.choose(text, labels, signal)), labels[0])
    const i = picked === null ? -1 : labels.indexOf(picked)
    return i >= 0 ? options[i] : null
  })
  const notify = native('notify', (args, ctx) => {
    host.notify(toText(argAt(args, 0, 'text')).slice(0, 500), ctx.pos)
    return null
  })
  const open = native('open', (args, ctx) => {
    const v = argAt(args, 0)
    if (v instanceof PageObj) host.open(v.id, ctx.pos)
    else if (v instanceof QueryObj) host.open(v.dbId, ctx.pos)
    else host.open(pageArg(v, 'page').id, ctx.pos)
    return null
  })

  const mail = new Namespace('mail', {
    send: native('send', async (args, ctx) => {
      const to = addresses(argAt(args, 0, 'to'))
      const cc = addresses(argAt(args, 99, 'cc'))
      const bcc = addresses(argAt(args, 99, 'bcc'))
      const subject = toText(argAt(args, 1, 'subject')).replace(/[\r\n]+/g, ' ').slice(0, 500)
      const body = toText(argAt(args, 2, 'body')).slice(0, 200_000)
      const bad = [...to, ...cc, ...bcc].find((a) => !EMAIL.test(a))
      if (!to.length) throw new ScriptError('bad_args', { name: 'mail.send', detail: 'no recipient (to:)' })
      if (bad) throw new ScriptError('bad_args', { name: 'mail.send', detail: `"${bad}" is not an e-mail address` })
      const out = await host.effect('mail.send', { to, cc, bcc, subject, body }, clip(`${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''} · ${subject || '—'}`), ctx.pos)
      return new SRecord([['status', out?.status ?? (host.mode === 'run' ? 'skipped' : 'dry')]])
    }),
  })

  const claude = native('claude', async (args, ctx) => {
    const prompt = needText(argAt(args, 0, 'prompt'), ctx).slice(0, 100_000)
    const context = argAt(args, 1, 'context')
    if (!prompt.trim()) throw new ScriptError('bad_args', { name: 'claude', detail: 'an empty prompt' })
    const out = await host.effect('claude', { prompt, context: context === null ? '' : toText(context).slice(0, 200_000) }, clip(prompt.replace(/\s+/g, ' ')), ctx.pos)
    return out ?? ''
  })

  const http = new Namespace('http', {
    post: native('post', async (args, ctx) => {
      const url = needText(argAt(args, 0, 'url'), ctx).trim()
      let parsed: URL | null = null
      try {
        parsed = new URL(url)
      } catch {
        parsed = null
      }
      if (!parsed || parsed.protocol !== 'https:') throw new ScriptError('bad_args', { name: 'http.post', detail: 'an https:// address' })
      const data = toPlain(argAt(args, 1, 'data'))
      const out = await host.effect('http.post', { url: parsed.href, data }, clip(`${parsed.host}${parsed.pathname}`), ctx.pos)
      if (!out) return null
      return new SRecord([
        ['status', out.status],
        ['body', plainToValue(out.body)],
      ])
    }),
  })

  return { page, db, create, trash, person, people, me, modal, confirm, ask, choose, notify, open, mail, claude, http }
}

/** JSON (an http answer) as script values. */
function plainToValue(v: unknown, depth = 0): Value {
  if (depth > 20) return null
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.slice(0, 10_000).map((x) => plainToValue(x, depth + 1))
  if (typeof v === 'object') return new SRecord(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainToValue(x, depth + 1)]))
  return null
}

/** The workspace's custom functions (MARGIN(…)) for names the script doesn't define. */
export function customFunction(name: string): Value | undefined {
  const f = formulaFunctions()
  const canonical = f?.resolve(name)
  if (!f || !canonical) return undefined
  return native(canonical, (args: Args, ctx: CallCtx) => {
    const res = f.call(canonical, args.pos.map(toFormula), { now: Date.now(), lang: ctx.lang })
    if (!res.ok) throw new ScriptError('bad_args', { name: canonical, detail: res.msg ?? res.code })
    return fromFormula(res.value)
  })
}
