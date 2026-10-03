/**
 * A large, realistic workspace for performance work (tests/e2e/perf-budget.spec.ts and manual
 * profiling) — a test helper, never shipped seed.
 *
 * Shape (defaults): 3,000 pages in a nested tree, 500 of them with rich content (30–200 blocks:
 * headings, lists, task lists, toggles, tables, images, code, callouts, page / person / date
 * mentions with reminders, comment marks + threads, synced blocks shared between pages), and
 * 25 databases × 400 rows (status, tags, person, date with reminders, number, checkbox, a relation
 * to the next database + a rollup over it, a formula, sub-items). One page has exactly 200 blocks
 * ("Perf · Big page") and one database is the 400-row "Perf · Big table".
 *
 * Everything is generated inside the page (deterministic PRNG), handed to the store in ONE
 * replaceAll() (the persistence layer then writes it like any other change), saved, and the app
 * is reloaded so the measurements start from a cold boot of the stored workspace.
 */
import type { Page } from '@playwright/test'
import { flush, openApp, waitForApp } from '../fixtures'

export interface BigOptions {
  pages: number
  richPages: number
  databases: number
  rowsPerDb: number
  /** synced-block groups (original + 2–4 references each) */
  syncedGroups: number
  /** pages with comment threads */
  commentedPages: number
  seed: number
}

export interface BigInfo {
  bigPageId: string
  bigPageBlocks: number
  bigTableId: string
  bigTableRows: number
  /** a word that occurs in the body text of rich pages only (⌘K content search) */
  bodyWord: string
  /** a title fragment many pages share (⌘K title search) */
  titleWord: string
  pages: number
  rows: number
  /** JSON size of the generated pages + databases (characters) */
  jsonChars: number
}

export const BIG_DEFAULTS: BigOptions = { pages: 3000, richPages: 500, databases: 25, rowsPerDb: 400, syncedGroups: 40, commentedPages: 100, seed: 7 }

/**
 * Runs in the browser (serialised by page.evaluate): self-contained, no closures over this module.
 * Returns the generated pages + databases and what the measurements need to find.
 */
export function generateBigWorkspace(o: BigOptions): { pages: Record<string, unknown>; databases: Record<string, unknown>; people: unknown[]; info: BigInfo } {
  /* ---------- deterministic randomness ---------- */
  let state = o.seed >>> 0 || 1
  const rnd = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  let seq = 0
  const id = (prefix: string) => `${prefix}${(seq++).toString(36)}${Math.floor(rnd() * 1e9).toString(36)}`
  const bid = () => id('b')

  const WORDS =
    'measure signal paper carbon dial gauge index ledger column rule margin draft review launch budget quarter roadmap meeting notes research sketch prototype release vendor contract invoice partner campaign onboarding backlog sprint retro hiring offsite policy handbook archive metrics funnel churn pricing feature bug design system token spacing grid type scale'.split(' ')
  const sentence = (n = int(6, 18)) => {
    const w: string[] = []
    for (let i = 0; i < n; i++) w.push(pick(WORDS))
    const s = w.join(' ')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
  }
  const BODY_WORD = 'zephyrquartz'
  const TITLE_WORD = 'Ledger'

  const now = Date.now()
  const DAY = 86_400_000
  const isoDay = (offset: number) => {
    const d = new Date(now + offset * DAY)
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const REMINDERS = [null, null, 'at', '-15m', '-1h', '-1d', '-2d', '-1w']
  const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
  const COVERS = ['dunes', 'glass', 'ink', 'night', 'paper-folds', 'concrete', 'grain', 'aluminum']

  /* ---------- people ---------- */
  const people = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dieter', 'Ken', 'Barbara', 'Edsger'].map((name, i) => ({ id: `bw-person-${i}`, name, color: COLORS[i % COLORS.length] }))

  /* ---------- page skeletons ---------- */
  type J = { type: string; attrs?: Record<string, unknown>; content?: J[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }
  type P = Record<string, unknown> & { id: string; title: string; parentId: string | null; content: J | null; order: number }
  const pages: Record<string, P> = {}
  const order = new Map<string, number>()
  const nextOrder = (parent: string | null) => {
    const k = parent ?? ''
    const n = (order.get(k) ?? 0) + 1
    order.set(k, n)
    return n
  }
  const makePage = (input: { id?: string; title: string; parentId: string | null; kind?: 'page' | 'database'; databaseId?: string | null; properties?: Record<string, unknown> }): P => {
    const created = now - int(1, 365) * DAY - int(0, DAY)
    const p: P = {
      id: input.id ?? id('p'),
      kind: input.kind ?? 'page',
      title: input.title,
      icon: rnd() < 0.3 ? { type: 'emoji', value: pick(['📄', '📌', '🧭', '📐', '🗂️', '🧪', '🛠️']) } : null,
      cover: rnd() < 0.05 ? { type: 'image', value: `assets/covers/${pick(COVERS)}.webp`, positionY: 50 } : null,
      parentId: input.parentId,
      databaseId: input.databaseId ?? null,
      properties: input.properties ?? {},
      content: null,
      contentRev: 0,
      contentOrigin: null,
      favorite: false,
      trashed: false,
      trashedAt: null,
      createdAt: created,
      updatedAt: created + int(0, 30) * DAY,
      order: nextOrder(input.parentId),
      settings: { fullWidth: false, smallText: false, font: 'sans', locked: false },
      plain: '',
    }
    pages[p.id] = p
    return p
  }

  // the tree: 30 areas at the top, every other page under a random earlier page (depth ≤ 6)
  const depth = new Map<string, number>()
  const plainIds: string[] = []
  for (let i = 0; i < o.pages; i++) {
    let parent: string | null = null
    if (i >= 30) {
      for (let tries = 0; tries < 5; tries++) {
        const cand = plainIds[Math.floor(Math.pow(rnd(), 0.7) * plainIds.length)]
        if ((depth.get(cand) ?? 0) < 6) {
          parent = cand
          break
        }
      }
    }
    const title = i === 0 ? 'Perf · Big page' : `${pick([TITLE_WORD, 'Notes', 'Plan', 'Spec', 'Review', 'Draft', 'Log'])} ${pick(WORDS)} ${i}`
    const p = makePage({ title, parentId: i === 0 ? null : parent })
    depth.set(p.id, parent ? (depth.get(parent) ?? 0) + 1 : 0)
    plainIds.push(p.id)
  }
  const bigPageId = plainIds[0]
  const richIds = plainIds.slice(0, o.richPages)

  /* ---------- content ---------- */
  const txt = (t: string, marks?: J['marks']): J => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
  const para = (...inline: J[]): J => ({ type: 'paragraph', attrs: { id: bid() }, content: inline })
  const pageMention = (): J => {
    const target = pages[pick(plainIds)]
    return { type: 'mention', attrs: { id: target.id, label: target.title, kind: 'page' } }
  }
  const personMention = (): J => {
    const p = pick(people)
    return { type: 'mention', attrs: { id: p.id, label: p.name, kind: 'person' } }
  }
  const dateMention = (): J => {
    const iso = isoDay(int(-60, 120))
    const reminder = pick(REMINDERS)
    return { type: 'mention', attrs: { id: iso, label: iso, kind: 'date', ...(reminder ? { reminder } : {}) } }
  }
  const richPara = (body: boolean): J => {
    const inline: J[] = [txt(`${sentence()} `)]
    const r = rnd()
    if (r < 0.15) inline.push(pageMention(), txt(' '))
    else if (r < 0.25) inline.push(personMention(), txt(' '))
    else if (r < 0.35) inline.push(txt('due '), dateMention(), txt(' '))
    if (rnd() < 0.2) inline.push(txt(sentence(4), [{ type: 'bold' }]), txt(' '))
    if (rnd() < 0.1) inline.push(txt('a link', [{ type: 'link', attrs: { href: `#/p/${pick(plainIds)}` } }]), txt(' '))
    inline.push(txt(body && rnd() < 0.3 ? `${sentence()} ${BODY_WORD}.` : sentence()))
    return para(...inline)
  }
  const list = (type: 'bulletList' | 'orderedList'): J => ({ type, attrs: { id: bid() }, content: Array.from({ length: int(2, 5) }, () => ({ type: 'listItem', attrs: { id: bid() }, content: [para(txt(sentence(int(3, 10))))] })) })
  const tasks = (): J => ({ type: 'taskList', attrs: { id: bid() }, content: Array.from({ length: int(2, 5) }, () => ({ type: 'taskItem', attrs: { id: bid(), checked: rnd() < 0.4 }, content: [para(txt(sentence(int(3, 8))))] })) })
  const toggle = (): J => ({
    type: 'details',
    attrs: { id: bid() },
    content: [
      { type: 'detailsSummary', content: [txt(sentence(int(3, 6)))] },
      { type: 'detailsContent', content: [richPara(false), para(txt(sentence()))] },
    ],
  })
  const table = (): J => {
    const cols = int(2, 4)
    return {
      type: 'table',
      attrs: { id: bid() },
      content: Array.from({ length: int(3, 6) }, (_, r) => ({
        type: 'tableRow',
        content: Array.from({ length: cols }, () => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [para(txt(sentence(int(1, 4))))] })),
      })),
    }
  }
  const image = (): J => ({ type: 'image', attrs: { id: bid(), src: `assets/covers/${pick(COVERS)}.webp`, alt: sentence(3) } })
  const code = (): J => ({ type: 'codeBlock', attrs: { id: bid(), language: 'ts' }, content: [txt(`const ${pick(WORDS)} = ${int(1, 999)}\nexport function ${pick(WORDS)}() {\n  return ${int(1, 99)}\n}`)] })
  const callout = (): J => ({ type: 'callout', attrs: { id: bid(), icon: '💡', color: pick(COLORS) }, content: [richPara(false)] })
  const heading = (): J => ({ type: 'heading', attrs: { id: bid(), level: int(1, 3) }, content: [txt(sentence(int(2, 5)).replace(/\.$/, ''))] })

  const block = (): J => {
    const r = rnd()
    if (r < 0.45) return richPara(true)
    if (r < 0.55) return heading()
    if (r < 0.63) return list(rnd() < 0.7 ? 'bulletList' : 'orderedList')
    if (r < 0.7) return tasks()
    if (r < 0.77) return toggle()
    if (r < 0.81) return table()
    if (r < 0.84) return image()
    if (r < 0.88) return code()
    if (r < 0.92) return callout()
    if (r < 0.95) return { type: 'blockquote', attrs: { id: bid() }, content: [para(txt(sentence()))] }
    return { type: 'horizontalRule', attrs: { id: bid() } }
  }

  // synced groups: the original on one rich page, identical references on 2–4 others
  const syncedOn = new Map<string, J[]>()
  for (let g = 0; g < o.syncedGroups; g++) {
    const syncId = `bw-sync-${g}`
    const holders = new Set<string>()
    while (holders.size < int(3, 5)) holders.add(pick(richIds.slice(1)))
    const [source, ...refs] = [...holders]
    const body = [para(txt(`Synced ${g}: ${sentence()}`)), para(txt('Owner '), personMention(), txt(' — next check '), dateMention())]
    const make = (src: string | null): J => ({
      type: 'syncedBlock',
      attrs: { id: bid(), syncId, sourcePageId: src },
      content: body.map((b) => ({ ...b, attrs: { ...b.attrs, id: bid() } })),
    })
    syncedOn.set(source, [...(syncedOn.get(source) ?? []), make(null)])
    for (const r of refs) syncedOn.set(r, [...(syncedOn.get(r) ?? []), make(source)])
  }

  // comment threads (anchored by `comment` marks in the first paragraph)
  const commented = new Set(richIds.slice(1, 1 + o.commentedPages))

  let bigPageBlocks = 0
  for (const pid of plainIds) {
    const p = pages[pid]
    const rich = richIds.includes(pid)
    const blocks: J[] = []
    if (pid === bigPageId) {
      for (let i = 0; i < 200; i++) blocks.push(i % 25 === 0 ? heading() : i % 7 === 3 ? list('bulletList') : richPara(true))
      bigPageBlocks = blocks.length
    } else if (rich) {
      const n = int(30, 200)
      for (let i = 0; i < n; i++) blocks.push(block())
      const synced = syncedOn.get(pid)
      if (synced) for (const s of synced) blocks.splice(int(0, blocks.length), 0, s)
      if (commented.has(pid)) {
        const threads = Array.from({ length: int(1, 3) }, (_, k) => {
          const cid = id('c')
          const quote = `commented ${k}`
          blocks.splice(int(0, Math.min(5, blocks.length)), 0, para(txt('See '), txt(quote, [{ type: 'comment', attrs: { id: cid } }]), txt(` — ${sentence()}`)))
          const at = now - int(1, 60) * DAY
          return {
            id: cid,
            quote,
            body: sentence(),
            author: pick(people).name,
            createdAt: at,
            updatedAt: at,
            resolved: rnd() < 0.3,
            replies: Array.from({ length: int(0, 3) }, () => ({ id: id('r'), author: pick(people).name, body: sentence(), createdAt: at + DAY, updatedAt: at + DAY })),
          }
        })
        p.comments = threads
      }
    } else if (rnd() < 0.7) {
      for (let i = 0, n = int(1, 6); i < n; i++) blocks.push(para(txt(sentence())))
    }
    if (blocks.length) p.content = { type: 'doc', content: blocks }
  }

  /* ---------- databases ---------- */
  const databases: Record<string, unknown> = {}
  const dbIds: string[] = []
  for (let d = 0; d < o.databases; d++) dbIds.push(`bw-db-${d}`)
  let bigTableId = ''
  for (let d = 0; d < o.databases; d++) {
    const dbId = dbIds[d]
    const next = dbIds[(d + 1) % dbIds.length]
    const P = (k: string) => `${dbId}-${k}`
    const statusOpts = [
      { id: P('s1'), name: 'Not started', color: 'gray', group: 'todo' },
      { id: P('s2'), name: 'In progress', color: 'blue', group: 'in_progress' },
      { id: P('s3'), name: 'Done', color: 'green', group: 'done' },
    ]
    const tagOpts = ['Ops', 'Design', 'Eng', 'Sales', 'Legal', 'Infra'].map((name, i) => ({ id: P(`t${i}`), name, color: COLORS[i] }))
    const properties = [
      { id: P('name'), name: 'Name', type: 'title' },
      { id: P('status'), name: 'Status', type: 'status', options: statusOpts },
      { id: P('tags'), name: 'Tags', type: 'multi_select', options: tagOpts },
      { id: P('owner'), name: 'Owner', type: 'person' },
      { id: P('due'), name: 'Due', type: 'date' },
      { id: P('est'), name: 'Estimate', type: 'number' },
      { id: P('done'), name: 'Done', type: 'checkbox' },
      { id: P('notes'), name: 'Notes', type: 'text' },
      { id: P('link'), name: 'Linked', type: 'relation', relationDatabaseId: next },
      { id: P('total'), name: 'Linked estimate', type: 'rollup', rollup: { relationPropertyId: P('link'), targetPropertyId: `${next}-est`, fn: 'sum' } },
      { id: P('score'), name: 'Score', type: 'formula', formula: 'prop("Estimate") * 2' },
      { id: P('parent'), name: 'Parent item', type: 'relation', relationDatabaseId: dbId },
      { id: `${P('parent')}.2way`, name: 'Sub-items', type: 'relation', relationDatabaseId: dbId },
    ]
    const visible = properties.filter((p) => p.type !== 'title').map((p) => p.id)
    databases[dbId] = {
      id: dbId,
      properties,
      views: [
        { id: P('v-table'), name: 'Table', type: 'table', filter: null, sorts: [], visibleProperties: visible, openIn: 'peek' },
        { id: P('v-board'), name: 'Board', type: 'board', filter: null, sorts: [], visibleProperties: visible, groupBy: P('status'), openIn: 'peek' },
      ],
      nextUniqueId: 1,
      inline: false,
      subItems: { enabled: true, parentPropertyId: P('parent'), childPropertyId: `${P('parent')}.2way` },
    }
    const title = d === 0 ? 'Perf · Big table' : `${pick(['Tasks', 'Projects', 'Contacts', 'Assets', 'Content', 'Bugs'])} ${d}`
    const dbPage = makePage({ id: dbId, title, kind: 'database', parentId: d < 5 ? null : pick(plainIds.slice(0, 200)) })
    dbPage.content = null
    if (d === 0) bigTableId = dbId
  }
  // rows (a second pass: relations point at rows of the next database)
  const rowsOf = new Map<string, string[]>()
  for (let d = 0; d < o.databases; d++) rowsOf.set(dbIds[d], Array.from({ length: o.rowsPerDb }, () => id('r')))
  for (let d = 0; d < o.databases; d++) {
    const dbId = dbIds[d]
    const nextRows = rowsOf.get(dbIds[(d + 1) % dbIds.length])!
    const ids = rowsOf.get(dbId)!
    const P = (k: string) => `${dbId}-${k}`
    const children = new Map<string, string[]>()
    ids.forEach((rowId, i) => {
      const parent = i > 20 && rnd() < 0.2 ? ids[int(0, i - 1)] : null
      const reminder = rnd() < 0.15 ? pick(REMINDERS.filter(Boolean)) : null
      const properties: Record<string, unknown> = {
        [P('status')]: P(`s${int(1, 3)}`),
        [P('tags')]: Array.from(new Set([P(`t${int(0, 5)}`), P(`t${int(0, 5)}`)])),
        [P('owner')]: [pick(people).id],
        [P('due')]: rnd() < 0.7 ? { start: isoDay(int(-90, 120)), ...(reminder ? { reminder } : {}) } : null,
        [P('est')]: int(1, 13),
        [P('done')]: rnd() < 0.3,
        [P('notes')]: rnd() < 0.5 ? sentence(int(3, 9)) : '',
        [P('link')]: Array.from(new Set([pick(nextRows), pick(nextRows)])),
      }
      if (parent) {
        properties[P('parent')] = [parent]
        children.set(parent, [...(children.get(parent) ?? []), rowId])
      }
      const row = makePage({ id: rowId, title: `${pick(['Task', 'Item', 'Entry', TITLE_WORD])} ${pick(WORDS)} ${d}-${i}`, parentId: dbId, databaseId: dbId, properties })
      if (rnd() < 0.1) row.content = { type: 'doc', content: [para(txt(sentence())), para(txt(sentence()))] }
    })
    for (const [parent, kids] of children) (pages[parent].properties as Record<string, unknown>)[`${P('parent')}.2way`] = kids
  }

  /* ---------- plain text cache (store.plainText's rules) ---------- */
  const plainOf = (node: J | null): string => {
    if (!node) return ''
    let out = ''
    const walk = (n: J) => {
      if (out.length > 20000) return
      if (n.type === 'text' && n.text) out += n.text
      else if (n.type === 'mention' && n.attrs?.label) out += `@${String(n.attrs.label)}`
      if (n.content) {
        for (const c of n.content) walk(c)
        if (n.type !== 'text' && n.type !== 'doc') out += '\n'
      }
    }
    walk(node)
    return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000)
  }
  for (const p of Object.values(pages)) p.plain = plainOf(p.content)

  const rows = o.databases * o.rowsPerDb
  const jsonChars = JSON.stringify(pages).length + JSON.stringify(databases).length
  return {
    pages,
    databases,
    people,
    info: { bigPageId, bigPageBlocks, bigTableId, bigTableRows: o.rowsPerDb, bodyWord: BODY_WORD, titleWord: TITLE_WORD, pages: Object.keys(pages).length, rows, jsonChars },
  }
}

/**
 * Open the app (fresh context → demo seed), add the big workspace on top of it through the store,
 * save it and reload, so the caller starts from a cold boot of the stored big workspace.
 */
export async function loadBigWorkspace(page: Page, opts: Partial<BigOptions> = {}): Promise<BigInfo> {
  await openApp(page)
  const info = await page.evaluate(
    ({ src, o }) => {
      // eslint-disable-next-line no-new-func
      const gen = new Function(`return (${src})`)() as (o: unknown) => { pages: Record<string, unknown>; databases: Record<string, unknown>; people: unknown[]; info: BigInfo }
      const out = gen(o)
      const ws = window.__one.workspace
      const s = ws.getState()
      s.replaceAll({
        version: s.version,
        epoch: s.epoch,
        pages: { ...s.pages, ...out.pages },
        databases: { ...s.databases, ...out.databases },
        people: [...s.people, ...out.people],
        settings: s.settings,
        recent: s.recent,
      })
      return out.info
    },
    { src: generateBigWorkspace.toString(), o: { ...BIG_DEFAULTS, ...opts } },
  )
  await flush(page)
  await page.reload()
  await waitForApp(page)
  return info
}
