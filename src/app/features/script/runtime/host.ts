/**
 * One Script runtime — the host of one run: its mode, the console, every write (done in a run,
 * planned in a dry run, refused in a query), the effects and what the person allowed, the dialogs,
 * and in a run the journal that undoing needs (each page as it was before the run first touched it).
 *
 * Writes go through the store actions only: properties with the database's own write
 * (writePropertyValue: two-way relations stay in step), content with setContent(…, 'script'),
 * a version-history snapshot before the first change of each existing page.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { COLOR_NAMES, type ColorName, type Database, type ID, type Page, type PropertyDef, type PropertyValue } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { navigate } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { propertyValueToText, writePropertyValue } from '../../../database'
import { markdownToDoc } from '../../../editor'
import { snapshotNow } from '../../history/snapshots'
import { ScriptError, type Pos, type Value } from '../lang'
import { coerceProp, propByName, type Coerced } from './props'
import { effectImpl, type EffectInputs, type EffectName, type EffectOutputs } from './effects'
import type { ChangeItem, ConfirmItem, EffectItem, EffectKind, LogLine, PropDiff, ResultTable, RunMode, RunUI } from './types'

export const SCRIPT_ORIGIN = 'script'
export const LOG_MAX = 500
const PALETTE = COLOR_NAMES.filter((c) => c !== 'default') as ColorName[]

export interface HostOptions {
  mode: RunMode
  scriptId: ID | null
  scriptName: string
  contextPageId: ID | null
  ui: RunUI
  signal: AbortSignal
  lang: 'en' | 'de'
  onLog?: (line: LogLine) => void
  /** run: what the person allowed upfront (keys) and the labels they saw then */
  approved?: { keys: Set<string>; labels: Map<string, string> } | null
  /** only these pages are reachable (a custom agent's scope); null = all */
  scope?: ((id: ID) => boolean) | null
}

const EFFECT_KIND: Record<EffectName, EffectKind> = { 'mail.send': 'mail', claude: 'claude', 'http.post': 'http' }

export class Host {
  readonly mode: RunMode
  readonly scriptId: ID | null
  readonly scriptName: string
  readonly contextPageId: ID | null
  readonly ui: RunUI
  readonly signal: AbortSignal
  readonly lang: 'en' | 'de'
  /** only these pages are reachable (a custom agent's scope); null = all */
  readonly scope: ((id: ID) => boolean) | null
  readonly started = Date.now()
  readonly log: LogLine[] = []
  readonly changes: ChangeItem[] = []
  readonly effects: EffectItem[] = []
  /** check pass: what the person will be asked to allow */
  readonly confirmItems: ConfirmItem[] = []
  /** run: each touched page as it was before the run (null = created by the run) */
  readonly before = new Map<ID, Page | null>()
  private readonly onLog?: (line: LogLine) => void
  private readonly approved: { keys: Set<string>; labels: Map<string, string> } | null
  private readonly counts = new Map<string, number>()
  /** kinds the person allowed for the rest of this run ("Allow all") */
  private readonly allowedKinds = new Set<string>()
  /** check pass: the script asked the person something (its plan depends on the answers) */
  usedDialogs = false
  private readonly drafts = new Map<ID, Page>()
  private draftSeq = 0
  /** the line currently running (log lines) */
  line: number | undefined

  constructor(o: HostOptions) {
    this.mode = o.mode
    this.scriptId = o.scriptId
    this.scriptName = o.scriptName
    this.contextPageId = o.contextPageId
    this.ui = o.ui
    this.signal = o.signal
    this.lang = o.lang
    this.onLog = o.onLog
    this.approved = o.approved ?? null
    this.scope = o.scope ?? null
  }

  /** Is this page inside the run's scope (always, without one)? */
  sees(id: ID): boolean {
    return !this.scope || this.scope(id)
  }

  /* ---------------------------------------------------------------- console */

  write(kind: LogLine['kind'], text: string, pos?: Pos | null, table?: ResultTable): void {
    if (this.log.length >= LOG_MAX) return
    const line: LogLine = { kind, text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text, at: Date.now() - this.started }
    const ln = pos?.line ?? this.line
    if (ln) line.line = ln
    if (table) line.table = table
    if (this.log.length === LOG_MAX - 1) line.text = '…'
    this.log.push(line)
    this.onLog?.(line)
  }

  /* ---------------------------------------------------------------- pages */

  /** A page by id: the store's (live, not trashed), or a draft of this dry run. */
  page(id: ID): Page | null {
    const d = this.drafts.get(id)
    if (d) return d
    const p = useWorkspace.getState().pages[id]
    return p && !p.trashed && this.sees(id) ? p : null
  }

  isDraft(id: ID): boolean {
    return this.drafts.has(id)
  }

  /* ---------------------------------------------------------------- write guard */

  /** Throws when this run may not write (a query; a workspace the person can only view). */
  guard(what: string): void {
    if (this.mode === 'query') throw new ScriptError('read_only', { what })
    if (this.mode === 'run' && useCloud.getState().readOnly) throw new ScriptError('no_write')
  }

  private get real(): boolean {
    return this.mode === 'run'
  }

  /** The first change of an existing page in a run: keep it as it was (undo) and as a version (history). */
  private async touch(id: ID): Promise<void> {
    if (!this.real || this.before.has(id)) return
    const p = useWorkspace.getState().pages[id]
    this.before.set(id, p ?? null)
    if (p) {
      try {
        await snapshotNow(id, 'manual')
      } catch {
        /* history is best effort */
      }
    }
  }

  private noteSet(page: Page, diffs: PropDiff[], title: string | null): void {
    const prior = this.changes.find((c) => c.pageId === page.id && (c.kind === 'create' || c.kind === 'set'))
    if (!prior) {
      this.changes.push({ kind: 'set', pageId: page.id, title: page.title, dbId: page.databaseId, props: diffs })
      return
    }
    // several set() calls on one page: one entry (the first "before", the last "after")
    const props = (prior.props ??= [])
    for (const d of diffs) {
      const cur = props.find((x) => x.name === d.name)
      if (cur) cur.after = d.after
      else props.push(d)
    }
    if (prior.kind === 'create' && title !== null) prior.title = title
  }

  /* ---------------------------------------------------------------- properties */

  /** `.set(Name: value, …)` on a page or row: coerced first (nothing is written when one value doesn't fit). */
  async setProps(page: Page, entries: Array<[string, Value]>): Promise<void> {
    this.guard('set()')
    const s = useWorkspace.getState()
    const db = page.databaseId ? s.databases[page.databaseId] : undefined
    const coerced: Coerced[] = []
    let title: string | null = null
    for (const [name, value] of entries) {
      const prop = db ? propByName(db, name) : undefined
      if (!prop || prop.type === 'title') {
        if (prop || name.trim().toLowerCase() === 'title') {
          title = coerceProp(db ?? { id: '', properties: [], views: [], nextUniqueId: 1 }, { id: 'title', name: 'title', type: 'title' }, value).text
          continue
        }
        throw new ScriptError('unknown_prop', { db: db ? s.pages[db.id]?.title || '—' : page.title || '—', name })
      }
      coerced.push(coerceProp(db!, prop, value))
    }
    const diffs: PropDiff[] = []
    if (title !== null) diffs.push({ name: db?.properties.find((p) => p.type === 'title')?.name ?? 'title', before: page.title, after: title })
    for (const c of coerced) diffs.push({ name: c.prop.name, before: this.isDraft(page.id) ? '' : safeText(db!, c.prop, page), after: c.text })
    if (this.real) {
      await this.touch(page.id)
      if (title !== null) s.updatePage(page.id, { title })
      for (const c of coerced) await this.writeOne(db!, page.id, c)
    } else if (this.isDraft(page.id)) {
      const d = this.drafts.get(page.id)!
      const props = { ...d.properties }
      for (const c of coerced) props[c.prop.id] = draftValue(c)
      this.drafts.set(page.id, { ...d, title: title ?? d.title, properties: props })
    }
    this.noteSet(page, diffs, title)
  }

  /** Write one coerced value (run). New select options are created first. */
  private async writeOne(db: Database, rowId: ID, c: Coerced): Promise<void> {
    let value: PropertyValue = c.value
    if (c.names) {
      const ids = this.ensureOptions(db.id, c.prop, c.names)
      value = c.prop.type === 'multi_select' ? ids : (ids[0] ?? null)
    }
    if (c.prop.type === 'relation') {
      // the related rows change too (two-way relations): keep them for undo
      const cur = (useWorkspace.getState().pages[rowId]?.properties[c.prop.id] as ID[] | undefined) ?? []
      for (const id of new Set([...cur, ...((value as ID[]) ?? [])])) await this.touch(id)
    }
    writePropertyValue(db.id, c.prop, rowId, value)
  }

  private ensureOptions(dbId: ID, prop: PropertyDef, names: string[]): ID[] {
    const s = useWorkspace.getState()
    const live = s.databases[dbId]?.properties.find((p) => p.id === prop.id)
    const opts = [...(live?.options ?? [])]
    const before = opts.length
    const ids = names.map((n) => {
      let o = opts.find((x) => x.name.trim().toLowerCase() === n.trim().toLowerCase())
      if (!o) {
        o = { id: newId(), name: n, color: PALETTE[opts.length % PALETTE.length] }
        opts.push(o)
      }
      return o.id
    })
    if (opts.length !== before) s.updateProperty(dbId, prop.id, { options: opts })
    return ids
  }

  /* ---------------------------------------------------------------- content */

  async writeContent(page: Page, markdown: string, how: 'append' | 'prepend' | 'replace'): Promise<void> {
    this.guard(`${how}()`)
    const md = markdown.slice(0, 500_000)
    const existing = this.changes.find((c) => c.pageId === page.id && c.kind === 'content')
    if (existing) existing.how = how === 'replace' || existing.how === 'replace' ? 'replace' : existing.how
    else if (!this.changes.some((c) => c.pageId === page.id && c.kind === 'create')) this.changes.push({ kind: 'content', pageId: page.id, title: page.title, dbId: page.databaseId, how })
    if (!this.real) {
      if (this.isDraft(page.id)) {
        const d = this.drafts.get(page.id)!
        this.drafts.set(page.id, { ...d, content: joinDocs(d.content, markdownToDoc(md), how) })
      }
      return
    }
    await this.touch(page.id)
    const cur = useWorkspace.getState().pages[page.id]
    if (!cur) return
    useWorkspace.getState().setContent(page.id, joinDocs(cur.content, markdownToDoc(md), how), SCRIPT_ORIGIN)
  }

  /* ---------------------------------------------------------------- create */

  /** A new page (under `parentId`; null = the top level) with an optional body. */
  async createPage(input: { title: string; parentId: ID | null; markdown: string }): Promise<ID> {
    this.guard('create.page()')
    const title = input.title.replace(/\s*\n\s*/g, ' ').slice(0, 2000)
    if (!this.real) {
      const id = `draft-${++this.draftSeq}`
      const now = Date.now()
      const draft = { id, kind: 'page', title, icon: null, cover: null, parentId: input.parentId, databaseId: null, properties: {}, content: input.markdown ? markdownToDoc(input.markdown) : null, contentRev: 0, contentOrigin: null, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 0, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false } } satisfies Page
      this.drafts.set(id, draft)
      this.changes.push({ kind: 'create', pageId: id, title, dbId: null, parentId: input.parentId })
      return id
    }
    const s = useWorkspace.getState()
    const id = s.createPage({ parentId: input.parentId, title })
    this.before.set(id, null)
    if (input.markdown) s.setContent(id, markdownToDoc(input.markdown.slice(0, 500_000)), SCRIPT_ORIGIN)
    this.changes.push({ kind: 'create', pageId: id, title, dbId: null, parentId: input.parentId })
    return id
  }

  /** A new row with a title and property values (all coerced before anything is created). */
  async createRow(db: Database, title: string, entries: Array<[string, Value]>): Promise<ID> {
    this.guard('add()')
    const s = useWorkspace.getState()
    const coerced: Coerced[] = []
    let name = title
    for (const [k, v] of entries) {
      const prop = propByName(db, k)
      if (!prop) {
        if (k.trim().toLowerCase() === 'title') {
          name = coerceProp(db, { id: 'title', name: 'title', type: 'title' }, v).text
          continue
        }
        throw new ScriptError('unknown_prop', { db: s.pages[db.id]?.title || '—', name: k })
      }
      if (prop.type === 'title') {
        name = coerceProp(db, prop, v).text
        continue
      }
      coerced.push(coerceProp(db, prop, v))
    }
    const props: PropDiff[] = coerced.map((c) => ({ name: c.prop.name, before: '', after: c.text }))
    if (!this.real) {
      const id = `draft-${++this.draftSeq}`
      const now = Date.now()
      const properties: Record<ID, PropertyValue> = {}
      for (const c of coerced) properties[c.prop.id] = draftValue(c)
      const draft = { id, kind: 'page', title: name, icon: null, cover: null, parentId: db.id, databaseId: db.id, properties, content: null, contentRev: 0, contentOrigin: null, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 0, settings: { fullWidth: false, smallText: false, font: 'sans', locked: false } } satisfies Page
      this.drafts.set(id, draft)
      this.changes.push({ kind: 'create', pageId: id, title: name, dbId: db.id, parentId: db.id, props })
      return id
    }
    // plain values go in with the row; relations through the database's write (two-way partners)
    const plain: Record<ID, PropertyValue> = {}
    const later: Coerced[] = []
    for (const c of coerced) {
      if (c.prop.type === 'relation') later.push(c)
      else if (c.names) {
        const ids = this.ensureOptions(db.id, c.prop, c.names)
        plain[c.prop.id] = c.prop.type === 'multi_select' ? ids : (ids[0] ?? null)
      } else plain[c.prop.id] = c.value
    }
    const id = s.createRow(db.id, { title: name, properties: plain })
    this.before.set(id, null)
    for (const c of later) await this.writeOne(db, id, c)
    this.changes.push({ kind: 'create', pageId: id, title: name, dbId: db.id, parentId: db.id, props })
    return id
  }

  /* ---------------------------------------------------------------- trash */

  /** Move a page / row to the trash (asked like an effect in a run; Undo restores it). */
  async trash(page: Page): Promise<boolean> {
    this.guard('trash()')
    const label = page.title.trim() || '—'
    const allowed = await this.allow('trash', label)
    if (!allowed) {
      this.changes.push({ kind: 'trash', pageId: page.id, title: page.title, dbId: page.databaseId, skipped: true })
      this.write('warn', `trash: ${label} — skipped`)
      return false
    }
    this.changes.push({ kind: 'trash', pageId: page.id, title: page.title, dbId: page.databaseId })
    if (this.real) {
      await this.touch(page.id)
      useWorkspace.getState().trashPage(page.id)
    } else if (this.isDraft(page.id)) this.drafts.delete(page.id)
    return true
  }

  /* ---------------------------------------------------------------- effects */

  /**
   * Whether a thing that leaves One (or goes to the trash) may happen now. Check pass: it is listed and
   * allowed; dry run: never happens (listed); run: allowed upfront with the same label, else asked.
   */
  private async allow(kind: ConfirmItem['kind'], label: string): Promise<boolean> {
    const n = (this.counts.get(kind) ?? 0) + 1
    this.counts.set(kind, n)
    const key = `${kind}#${n}`
    const item: ConfirmItem = { key, kind, label, on: kind !== 'http' }
    if (this.mode === 'check') {
      this.confirmItems.push(item)
      return true
    }
    if (this.mode === 'dry') return true
    if (this.mode !== 'run') return false
    if (this.approved && this.approved.labels.get(key) === label) return this.approved.keys.has(key)
    if (this.allowedKinds.has(kind)) return true
    const answer = await this.ui.allowOne(item, this.scriptName, this.signal)
    if (this.signal.aborted) throw new ScriptError('stopped')
    if (answer === 'all') this.allowedKinds.add(kind)
    return answer === true || answer === 'all'
  }

  async effect<K extends EffectName>(name: K, input: EffectInputs[K], label: string, pos?: Pos | null): Promise<EffectOutputs[K] | null> {
    if (this.mode === 'query') throw new ScriptError('read_only', { what: name })
    const kind = EFFECT_KIND[name]
    const key = `${kind}#${(this.counts.get(kind) ?? 0) + 1}`
    const allowed = await this.allow(kind, label)
    if (this.mode === 'check') return null
    if (this.mode === 'dry') {
      this.effects.push({ kind, key, label, status: 'planned' })
      this.write('effect', `${name}: ${label}`, pos)
      return null
    }
    if (!allowed) {
      this.effects.push({ kind, key, label, status: 'skipped' })
      this.write('warn', `${name}: ${label} — ${kind === 'http' ? 'refused' : 'skipped'}`, pos)
      return null
    }
    try {
      const out = await effectImpl(name)(input, { signal: this.signal, scriptName: this.scriptName, lang: this.lang })
      this.effects.push({ kind, key, label, status: 'done' })
      this.write('effect', `${name}: ${label}`, pos)
      return out
    } catch (e) {
      if (this.signal.aborted) throw new ScriptError('stopped')
      const detail = String((e as Error)?.message ?? e).slice(0, 300)
      this.effects.push({ kind, key, label, status: 'failed', detail })
      throw new ScriptError('effect_failed', { name, detail })
    }
  }

  /* ---------------------------------------------------------------- dialogs */

  async dialog<T>(what: string, show: () => Promise<T>, fallback: T): Promise<T> {
    if (this.mode === 'query') throw new ScriptError('read_only', { what })
    if (this.mode === 'check') {
      this.usedDialogs = true
      return fallback
    }
    const answer = await show()
    if (this.signal.aborted) throw new ScriptError('stopped')
    return answer
  }

  notify(text: string, pos?: Pos | null): void {
    if (this.mode === 'query') throw new ScriptError('read_only', { what: 'notify()' })
    if (this.mode === 'check') return
    if (this.mode === 'dry') {
      this.write('info', `notify: ${text}`, pos)
      return
    }
    this.ui.notify(text)
  }

  open(id: ID, pos?: Pos | null): void {
    if (this.mode === 'query') throw new ScriptError('read_only', { what: 'open()' })
    if (this.mode === 'check') return
    if (this.mode === 'dry' || this.isDraft(id)) {
      this.write('info', `open: ${this.page(id)?.title || id}`, pos)
      return
    }
    navigate({ name: 'page', id })
  }
}

function safeText(db: Database, prop: PropertyDef, row: Page): string {
  try {
    return propertyValueToText(db, prop, row)
  } catch {
    return ''
  }
}

/** A draft row's stored value (existing options only — new ones don't exist in a dry run). */
function draftValue(c: Coerced): PropertyValue {
  if (!c.names) return c.value
  const ids = c.names.map((n) => c.prop.options?.find((o) => o.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x)
  return c.prop.type === 'multi_select' ? ids : (ids[0] ?? null)
}

/** The page body with Markdown added at the end / start, or replaced. */
function joinDocs(cur: JSONContent | null, add: JSONContent, how: 'append' | 'prepend' | 'replace'): JSONContent {
  const addBlocks = (add.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length) || (add.content ?? []).length === 1)
  if (how === 'replace' || !cur?.content?.length) return { type: 'doc', content: addBlocks.length ? addBlocks : [{ type: 'paragraph' }] }
  const old = [...cur.content]
  // an empty last paragraph (the editor keeps one) gives way to what is appended
  while (how === 'append' && old.length && old[old.length - 1].type === 'paragraph' && !old[old.length - 1].content?.length) old.pop()
  return { type: 'doc', content: how === 'append' ? [...old, ...addBlocks] : [...addBlocks, ...old] }
}
