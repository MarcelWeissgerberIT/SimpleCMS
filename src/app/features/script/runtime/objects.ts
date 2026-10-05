/**
 * One Script runtime — One's objects as script values:
 *  - PageObj: a page, a database page or a row (rows: their properties by name — `t.Status`,
 *    `t["Due date"]`, inside where / sort / select as plain names)
 *  - QueryObj: a database and the steps of a query (where · sort · limit · select …), evaluated when
 *    its rows are needed (count, for … in, a table)
 *  - PersonObj, AgentObj, ScriptRefObj: people, agents, scripts (read only)
 */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed, selectChildren } from '../../../store/selectors'
import type { CustomAgent, Database, ID, OneScript, Page, Person } from '../../../store/types'
import { docToMarkdown, stripPrivate } from '../../../editor'
import { t } from '../../../i18n'
import {
  HostObject,
  SDate,
  SRecord,
  ScriptError,
  aggregate,
  argAt,
  checkList,
  groupBy,
  native,
  needNumber,
  needText,
  normName,
  selectFrom,
  sortBy,
  toText,
  whereIn,
  type Args,
  type CallCtx,
  type NativeFn,
  type Thunk,
  type Value,
} from '../lang'
import type { Host } from './host'
import { propByName, readProp, type Makers } from './props'

/** The run's host (natives reach it through ctx.host). */
export const hostOf = (ctx: CallCtx): Host => ctx.host as Host

const ws = () => useWorkspace.getState()
const untitled = () => t('common.untitled')

/** Link that opens a page in this One. */
export function pageUrl(id: ID): string {
  return typeof window === 'undefined' ? `#/p/${id}` : `${window.location.origin}${window.location.pathname}#/p/${id}`
}

/** A page a script may reach: there, not in the trash, not part of a template. */
export function reachable(id: ID): Page | null {
  const { pages } = ws()
  const p = pages[id]
  if (!p || p.trashed || isEffectivelyTrashed(pages, id) || inTemplate(pages, id)) return null
  return p
}

export function makers(host: Host): Makers {
  return {
    row: (p) => new PageObj(host, p.id),
    person: (p) => new PersonObj(p),
  }
}

/** Entries of `{…}` / named arguments for set() / add(). */
export function namedEntries(args: Args): Array<[string, Value]> {
  const out: Array<[string, Value]> = [...args.named]
  for (const v of args.pos) if (v instanceof SRecord) out.push(...v.fields)
  return out
}

/* ------------------------------------------------------------------ pages and rows */

/** Built-in names a row also answers inside where / sort / select (others stay the script's variables). */
const SCOPE_BUILTINS = new Set(['title', 'id', 'url', 'created', 'edited'])

export class PageObj extends HostObject {
  constructor(
    readonly host: Host,
    readonly id: ID,
  ) {
    super()
  }

  get typeName(): string {
    const p = this.host.page(this.id)
    return p?.kind === 'database' ? 'database page' : p?.databaseId ? 'row' : 'page'
  }

  /** The page now (throws when it is gone). */
  get page(): Page {
    const p = this.host.page(this.id)
    if (!p) throw new ScriptError('not_found', { what: 'page', name: this.id })
    return p
  }

  get db(): Database | null {
    const p = this.host.page(this.id)
    return p?.databaseId ? (ws().databases[p.databaseId] ?? null) : null
  }

  display(): string {
    return this.host.page(this.id)?.title.trim() || untitled()
  }

  equals(other: Value): boolean {
    return other instanceof PageObj && other.id === this.id
  }

  matchText(): string[] {
    return [this.display(), this.id]
  }

  toPlain(): unknown {
    return { id: this.id, title: this.display() }
  }

  /** A row's property by name (exact first, then ignoring case). */
  private prop(name: string): Value | undefined {
    const db = this.db
    if (!db) return undefined
    const prop = propByName(db, name)
    return prop ? readProp(db, prop, this.page, makers(this.host)) : undefined
  }

  /** Names inside where / sort / select: the row's properties, then title / id / created / edited. */
  scope(name: string): Value | undefined {
    const db = this.db
    if (db) {
      const exact = db.properties.find((p) => p.name === name)
      if (exact) return readProp(db, exact, this.page, makers(this.host))
      const v = this.prop(name)
      if (v !== undefined) return v
    }
    return SCOPE_BUILTINS.has(normName(name)) ? this.builtin(name) : undefined
  }

  unknownName(name: string): ScriptError | undefined {
    const db = this.db
    return db ? new ScriptError('unknown_prop', { db: ws().pages[db.id]?.title || untitled(), name }) : undefined
  }

  method(name: string): NativeFn | undefined {
    const n = normName(name)
    const host = this.host
    const self = this
    switch (n) {
      case 'set':
        return native(name, async (args) => {
          await host.setProps(self.page, namedEntries(args))
          return self
        })
      case 'append':
      case 'prepend':
      case 'replace':
        return native(name, async (args, ctx) => {
          await host.writeContent(self.page, needText(argAt(args, 0), ctx), n as 'append' | 'prepend' | 'replace')
          return self
        })
      case 'open':
        return native(name, () => {
          host.open(self.id)
          return self
        })
      case 'trash':
        return native(name, async () => host.trash(self.page))
    }
    return undefined
  }

  private builtin(name: string): Value | undefined {
    const p = this.page
    switch (normName(name)) {
      case 'title':
      case 'name':
        return p.title
      case 'id':
        return this.id
      case 'url':
        return pageUrl(this.id)
      case 'kind':
        return p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page'
      case 'icon':
        return p.icon?.type === 'emoji' ? p.icon.value : p.icon ? `${p.icon.type}:${p.icon.value}` : null
      case 'markdown':
        return p.content ? docToMarkdown(stripPrivate(p.content)).trim() : ''
      case 'text':
        return p.plain ?? ''
      case 'props': {
        const db = this.db
        const rec = new SRecord()
        if (db) for (const prop of db.properties) rec.fields.set(prop.name, readProp(db, prop, p, makers(this.host)))
        return rec
      }
      case 'children':
        return this.host.isDraft(this.id) ? [] : selectChildren(ws().pages, this.id).filter((c) => !inTemplate(ws().pages, c.id)).map((c) => (ws().databases[c.id] ? new QueryObj(this.host, c.id) : new PageObj(this.host, c.id)))
      case 'parent': {
        const parentId = p.parentId
        if (!parentId) return null
        const parent = this.host.page(parentId)
        if (!parent) return null
        return ws().databases[parentId] && p.databaseId === parentId ? new QueryObj(this.host, parentId) : new PageObj(this.host, parentId)
      }
      case 'database':
        return p.databaseId && ws().databases[p.databaseId] ? new QueryObj(this.host, p.databaseId) : null
      case 'created':
        return SDate.at(new Date(p.createdAt))
      case 'edited':
        return SDate.at(new Date(p.updatedAt))
    }
    return undefined
  }

  member(name: string): Value | undefined {
    const db = this.db
    // a property spelled exactly wins (a property "Text" is not the page's text)
    if (db) {
      const exact = db.properties.find((p) => p.name === name)
      if (exact) return readProp(db, exact, this.page, makers(this.host))
    }
    const b = this.builtin(name)
    if (b !== undefined) return b
    const m = this.method(name)
    if (m) return m
    const v = this.prop(name)
    if (v !== undefined) return v
    if (db) throw new ScriptError('unknown_prop', { db: ws().pages[db.id]?.title || untitled(), name })
    return undefined
  }

  async setMember(name: string, value: Value): Promise<void> {
    await this.host.setProps(this.page, [[name, value]])
  }
}

/* ------------------------------------------------------------------ databases and queries */

type Op = { kind: 'where'; thunks: Thunk[] } | { kind: 'sort'; args: Args } | { kind: 'limit'; n: number } | { kind: 'skip'; n: number } | { kind: 'select'; args: Args }

export class QueryObj extends HostObject {
  constructor(
    readonly host: Host,
    readonly dbId: ID,
    readonly ops: readonly Op[] = [],
  ) {
    super()
  }

  get typeName(): string {
    return this.ops.length ? 'query' : 'database'
  }

  get db(): Database {
    const db = ws().databases[this.dbId]
    if (!db || !reachable(this.dbId)) throw new ScriptError('not_found', { what: 'database', name: this.dbId })
    return db
  }

  get title(): string {
    return ws().pages[this.dbId]?.title.trim() || untitled()
  }

  /** select(…) was used: the result is records, no longer rows */
  get selected(): Op | undefined {
    return this.ops.find((o) => o.kind === 'select')
  }

  display(): string {
    return this.title
  }

  equals(other: Value): boolean {
    return other instanceof QueryObj && other.dbId === this.dbId && other.ops.length === 0 && this.ops.length === 0
  }

  matchText(): string[] {
    return [this.title]
  }

  toPlain(): unknown {
    return { database: this.title, id: this.dbId }
  }

  private with(op: Op): QueryObj {
    return new QueryObj(this.host, this.dbId, [...this.ops, op])
  }

  /** The database's live rows in their manual order (then created). */
  baseRows(): Page[] {
    this.db
    return Object.values(ws().pages)
      .filter((p) => p.databaseId === this.dbId && !p.trashed)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  }

  /** Run the query: rows (PageObj) — or records after select. */
  async items(ctx: CallCtx): Promise<Value[]> {
    let list: Value[] = this.baseRows().map((p) => new PageObj(this.host, p.id))
    for (const op of this.ops) {
      if (op.kind === 'where') list = await whereIn(list, op.thunks, ctx)
      else if (op.kind === 'sort') list = await sortBy(list, op.args, ctx)
      else if (op.kind === 'limit') list = list.slice(0, op.n)
      else if (op.kind === 'skip') list = list.slice(op.n)
      else list = await selectFrom(list, op.args, ctx)
    }
    return checkList(list, ctx)
  }

  async iterate(ctx: CallCtx): Promise<Value[]> {
    return this.items(ctx)
  }

  /** Columns a table of this query shows: select's, else the title + the first view's properties. */
  columns(): string[] {
    const sel = this.selected
    if (sel?.kind === 'select') return [...sel.args.thunks.map((th) => (th.node.type === 'Ident' || th.node.type === 'Member' ? (th.node.type === 'Ident' ? th.node.name : th.node.name) : th.text.trim())), ...sel.args.namedThunks.keys()]
    const db = this.db
    const title = db.properties.find((p) => p.type === 'title')
    const view = db.views[0]
    const visible = (view?.visibleProperties ?? []).map((id) => db.properties.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p && p.type !== 'title')
    return [title?.name ?? 'Name', ...visible.slice(0, 5).map((p) => p.name)]
  }

  method(name: string): NativeFn | undefined {
    const n = normName(name)
    const self = this
    switch (n) {
      case 'where':
      case 'filter':
        return native(name, (args) => self.with({ kind: 'where', thunks: args.thunks }), { lazy: true })
      case 'sort':
        return native(name, (args) => self.with({ kind: 'sort', args }), { lazy: true })
      case 'select':
        return native(name, (args) => self.with({ kind: 'select', args }), { lazy: true })
      case 'limit':
      case 'take':
        return native(name, (args, ctx) => self.with({ kind: 'limit', n: Math.max(0, Math.floor(needNumber(argAt(args, 0), ctx))) }))
      case 'skip':
        return native(name, (args, ctx) => self.with({ kind: 'skip', n: Math.max(0, Math.floor(needNumber(argAt(args, 0), ctx))) }))
      case 'count':
        return native(name, async (args, ctx) => (args.thunks.length ? (await whereIn(await self.items(ctx), args.thunks, ctx)).length : (await self.items(ctx)).length), { lazy: true })
      case 'sum':
      case 'avg':
      case 'min':
      case 'max':
        return native(name, async (args, ctx) => aggregate[n as 'sum'](await self.items(ctx), args.thunks[0], ctx), { lazy: true })
      case 'group':
        return native(name, async (args, ctx) => groupBy(await self.items(ctx), args.thunks[0], ctx), { lazy: true })
      case 'find':
        return native(
          name,
          async (args, ctx) => {
            const hit = await whereIn(await self.items(ctx), args.thunks, ctx)
            return hit[0] ?? null
          },
          { lazy: true },
        )
      case 'map':
        return native(
          name,
          async (args, ctx) => {
            const out: Value[] = []
            for (const item of await self.items(ctx)) out.push(await ctx.evalFor(args.thunks[0], item))
            return out
          },
          { lazy: true },
        )
      case 'add':
        return native(name, async (args, ctx) => {
          if (self.ops.length) throw new ScriptError('bad_args', { name, detail: 'add() works on the database itself: db(@X).add(…)' })
          const first = args.pos[0]
          const title = typeof first === 'string' ? first : ''
          const id = await self.host.createRow(self.db, title, namedEntries(args))
          return new PageObj(self.host, id)
        })
      case 'open':
        return native(name, () => {
          self.host.open(self.dbId)
          return self
        })
    }
    return undefined
  }

  async member(name: string, ctx: CallCtx): Promise<Value | undefined> {
    switch (normName(name)) {
      case 'rows':
      case 'items':
      case 'list':
        return this.items(ctx)
      case 'count':
      case 'length':
        return (await this.items(ctx)).length
      case 'first': {
        const items = await this.items(ctx)
        return items[0] ?? null
      }
      case 'last': {
        const items = await this.items(ctx)
        return items[items.length - 1] ?? null
      }
      case 'title':
      case 'name':
        return this.title
      case 'id':
        return this.dbId
      case 'url':
        return pageUrl(this.dbId)
      case 'page':
        return new PageObj(this.host, this.dbId)
      case 'schema':
      case 'properties':
        return this.db.properties.map(
          (p) =>
            new SRecord([
              ['name', p.name],
              ['type', p.type],
              ['options', (p.options ?? []).map((o) => o.name)],
            ]),
        )
    }
    return this.method(name)
  }
}

/* ------------------------------------------------------------------ people, agents, scripts */

export class PersonObj extends HostObject {
  readonly typeName = 'person'
  constructor(readonly person: Person) {
    super()
  }
  member(name: string): Value | undefined {
    switch (normName(name)) {
      case 'name':
        return this.person.name
      case 'id':
        return this.person.id
    }
    return undefined
  }
  display(): string {
    return this.person.name
  }
  equals(other: Value): boolean {
    return other instanceof PersonObj && other.person.id === this.person.id
  }
  matchText(): string[] {
    return [this.person.name, this.person.id]
  }
  toPlain(): unknown {
    return { id: this.person.id, name: this.person.name }
  }
}

export class AgentObj extends HostObject {
  readonly typeName = 'agent'
  constructor(readonly agent: CustomAgent) {
    super()
  }
  member(name: string): Value | undefined {
    switch (normName(name)) {
      case 'name':
        return this.agent.name
      case 'id':
        return this.agent.id
      case 'enabled':
        return this.agent.enabled
    }
    return undefined
  }
  display(): string {
    return this.agent.name
  }
  equals(other: Value): boolean {
    return other instanceof AgentObj && other.agent.id === this.agent.id
  }
  toPlain(): unknown {
    return { id: this.agent.id, name: this.agent.name }
  }
}

export class ScriptRefObj extends HostObject {
  readonly typeName = 'script'
  constructor(readonly script: OneScript) {
    super()
  }
  member(name: string): Value | undefined {
    switch (normName(name)) {
      case 'name':
        return this.script.name
      case 'id':
        return this.script.id
      case 'kind':
        return this.script.kind
    }
    return undefined
  }
  display(): string {
    return this.script.name
  }
  equals(other: Value): boolean {
    return other instanceof ScriptRefObj && other.script.id === this.script.id
  }
  toPlain(): unknown {
    return { id: this.script.id, name: this.script.name }
  }
}

/** A value as text for messages ("Anna", "Website relaunch", "3"). */
export const shown = (v: Value): string => toText(v)
