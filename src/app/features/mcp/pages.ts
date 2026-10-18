/**
 * One MCP — one_create_page (spec § 2.2): one page, or a batch (`pages`, ≤ 50, ≤ 600,000 characters) whose pages may
 * hang under each other ("$<index>" = an earlier page of the list: a tree in one call); its place among its siblings
 * (before / after / index, one page); the member's Private section (`private`, team only — a local workspace has none
 * and says so); a link to each new page at the end of its parent's text (`linkInParent`: a page link block or a mention
 * line, refused into a locked page). Staged through the agent's create_page (each page's text through the settle gate,
 * ids minted now), applied as ONE call: one card, one Undo — which takes back the links and puts every page the call
 * made into the trash while nobody changed it since (spec § 3.2).
 */
import type { JSONContent } from '@tiptap/core'
import { t } from '../../i18n'
import type { ID, Page, PageIcon } from '../../store/types'
import { useCloud } from '../../cloud'
import { contentKey, snapshotNow } from '../history/snapshots'
import { pagePrivate } from '../ai/agent/workItems'
import { mcpError } from '../../../shared/mcp/errors'
import { MCP_LIMITS } from '../../../shared/mcp/tables'
import { applyStaged, assertStageWritable, callStage, itemPlan, stageWith } from './stage'
import { assertNotSystem } from './system'
import { iconText, live, McpToolError, pageUrl, pathOf, q, titleOf, ws } from './values'
import { atPath, chars, checkFileScope, pageOrThrow, parseIcon, preview, str, tasksOf, type PlanLine, type WritePlan } from './plan'
import { withWriter } from '../../store/writer'
import { bodyLine, rowNo, sideEffects, sideHold, type SideEffects } from './rows'
import { stripRefLabels } from '../../../shared/mcp/refs'
import { withoutNodes } from './undoNodes'

type Parent = { kind: 'none' } | { kind: 'page'; page: Page } | { kind: 'batch'; index: number }

interface Item {
  title: string
  markdown: string
  icon: PageIcon | null | undefined
  parent: Parent
}

const LINKS = ['none', 'block', 'mention'] as const
type LinkMode = (typeof LINKS)[number]

const isEmptyDoc = (doc: JSONContent | null | undefined) => (doc?.content ?? []).every((b) => b.type === 'paragraph' && !(b.content ?? []).length)

/** A parent as a call names it: a live page or row (never a database, a template or One's own databases), or "$<n>". */
function parentOf(raw: string, path: string, index: number, batch: boolean): Parent {
  if (raw.startsWith('$')) {
    const n = Number(raw.slice(1))
    if (!batch || !/^\$\d{1,2}$/.test(raw) || n >= index) throw new McpToolError(mcpError('bad_argument', path, `${q(raw)} is no earlier page of this list${batch && index ? ` ("$0" … "$${index - 1}")` : ''}`))
    return { kind: 'batch', index: n }
  }
  let page: Page
  try {
    page = pageOrThrow(raw, path)
    // nothing new below a row of One's own databases
    assertNotSystem(page.id)
  } catch (e) {
    atPath(e, path)
  }
  if (page.kind === 'database') throw new McpToolError(mcpError('bad_argument', path, `${q(titleOf(page))} is a database: its entries are rows`, 'Add a row with one_create_row.'))
  return { kind: 'page', page }
}

/** Where a single page goes among its siblings: the store's index (all non-trashed siblings) and the card's words. */
function placeOf(args: Record<string, unknown>, parentId: ID | null): { storeIndex: number; label: string } | null {
  const anchors = ['before', 'after', 'index'].filter((k) => args[k] !== undefined && args[k] !== null)
  if (!anchors.length) return null
  if (anchors.length > 1) throw new McpToolError(mcpError('bad_argument', anchors[1]!, 'pass at most one of "before", "after" and "index"'))
  const { pages } = ws()
  // siblings as people see them (no hidden pages, nothing in the trash)
  const sibs = Object.values(pages)
    .filter((p) => p.parentId === parentId && live(p.id) && !p.hidden)
    .sort((a, b) => a.order - b.order)
  const all = Object.values(pages)
    .filter((p) => p.parentId === parentId && !p.trashed)
    .sort((a, b) => a.order - b.order)
  const storeAt = (at: number) => (at >= sibs.length ? all.length : all.findIndex((p) => p.id === sibs[at]!.id))
  const key = anchors[0]!
  if (key === 'index') {
    const n = typeof args.index === 'number' ? args.index : Number(args.index)
    if (!Number.isInteger(n) || n < 0) throw new McpToolError(mcpError('bad_argument', 'index', 'a whole number ≥ 0 is expected (0 = first)'))
    const at = Math.min(n, sibs.length)
    return { storeIndex: storeAt(at), label: at === 0 ? t('features.mcp.plan.first') : at >= sibs.length ? t('features.mcp.plan.last') : t('features.mcp.plan.at', { n: at + 1 }) }
  }
  const sibId = str(args[key], key, { max: 80 }).trim()
  const i = sibs.findIndex((p) => p.id === sibId)
  if (i < 0)
    throw new McpToolError(
      mcpError('not_found', key, `${q(sibId)} is no page next to it under ${parentId ? q(titleOf(pages[parentId])) : 'the top level'}`, `Siblings: ${sibs.slice(0, 12).map((p) => `${q(titleOf(p))} (${p.id})`).join(', ') || 'none'}.`),
    )
  return { storeIndex: storeAt(key === 'before' ? i : i + 1), label: t(`features.mcp.plan.${key}`, { title: titleOf(sibs[i]) }) }
}

/**
 * A batch's summary sentence (the one the person reads before Approve): where the pages go, from their own parents —
 * one parent: its title; several: how many ("under 2 pages", or "in 3 places" when some go to the top level); the top
 * level only when none has a parent. Pages under an earlier page of the list go where that one goes.
 */
function batchSummary(items: Item[]): string {
  const roots = new Set(items.map((it) => (it.parent.kind === 'page' ? it.parent.page.id : it.parent.kind === 'none' ? '' : null)).filter((x): x is string => x !== null))
  const n = chars(items.length)
  const one = items.length === 1
  if (roots.size === 1) {
    const [only] = [...roots]
    const where = only ? titleOf(ws().pages[only]) : t('features.mcp.plan.topLevel')
    return t(one ? 'features.mcp.sum.createPages.one' : 'features.mcp.sum.createPages.other', { n, where })
  }
  return roots.has('') ? t('features.mcp.sum.createPagesPlaces', { n, places: chars(roots.size) }) : t('features.mcp.sum.createPagesUnder', { n, parents: chars(roots.size) })
}

export function planCreatePage(args: Record<string, unknown>): WritePlan {
  const batch = args.pages !== undefined && args.pages !== null
  const team = useCloud.getState().active.kind === 'cloud'
  if (args.private !== undefined && args.private !== null && typeof args.private !== 'boolean') throw new McpToolError(mcpError('bad_argument', 'private', 'true or false is expected'))
  const wantPrivate = args.private === true
  const link: LinkMode = args.linkInParent === undefined || args.linkInParent === null ? 'none' : (args.linkInParent as LinkMode)
  if (!LINKS.includes(link)) throw new McpToolError(mcpError('bad_argument', 'linkInParent', `one of ${LINKS.join(', ')} is expected`))
  const shared = str(args.parentId, 'parentId', { max: 80 }).trim()

  // the pages of the call, checked before anything is staged (one bad page makes none)
  let items: Item[]
  if (batch) {
    const mixed = ['title', 'markdown', 'icon', 'before', 'after', 'index'].find((k) => args[k] !== undefined && args[k] !== null)
    if (mixed) throw new McpToolError(mcpError('bad_argument', mixed, `with "pages" each page carries its own title, markdown and icon; a batch comes in list order`))
    const raw = args.pages
    if (!Array.isArray(raw) || !raw.length) throw new McpToolError(mcpError('bad_argument', 'pages', `a list of 1–${MCP_LIMITS.pages} pages is expected`))
    if (raw.length > MCP_LIMITS.pages) throw new McpToolError(mcpError('too_large', 'pages', `${raw.length} pages (at most ${MCP_LIMITS.pages} per call)`, `Send the first ${MCP_LIMITS.pages}, then the rest in a second call.`))
    items = (raw as unknown[]).map((r, i) => {
      const path = `pages[${i}]`
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new McpToolError(mcpError('bad_argument', path, 'an object {title, parentId?, markdown?, icon?} is expected'))
      const o = r as Record<string, unknown>
      const title = str(o.title, `${path}.title`, { max: MCP_LIMITS.title }).replace(/\s+/g, ' ').trim()
      if (!title) throw new McpToolError(mcpError('bad_argument', `${path}.title`, 'a page needs a title'))
      let icon: PageIcon | null | undefined
      try {
        icon = parseIcon(o.icon)
      } catch (e) {
        atPath(e, `${path}.icon`)
      }
      const own = str(o.parentId, `${path}.parentId`, { max: 80 }).trim()
      const parentRaw = own || shared
      return { title, markdown: stripRefLabels(str(o.markdown, `${path}.markdown`, { max: MCP_LIMITS.text })), icon, parent: parentRaw ? parentOf(parentRaw, own ? `${path}.parentId` : 'parentId', i, true) : { kind: 'none' } }
    })
    const total = items.reduce((n, p) => n + p.markdown.length, 0)
    if (total > MCP_LIMITS.pagesChars) throw new McpToolError(mcpError('too_large', 'pages', `the pages hold ${total.toLocaleString('en')} characters in all (at most ${MCP_LIMITS.pagesChars.toLocaleString('en')})`, 'Split them over two calls.'))
  } else {
    const title = str(args.title, 'title', { required: true, max: MCP_LIMITS.title }).replace(/\s+/g, ' ').trim()
    if (!title) throw new McpToolError(mcpError('bad_argument', 'title', 'a page needs a title (or pass "pages")'))
    items = [{ title, markdown: stripRefLabels(str(args.markdown, 'markdown', { max: MCP_LIMITS.text })), icon: parseIcon(args.icon), parent: shared ? parentOf(shared, 'parentId', 0, false) : { kind: 'none' } }]
  }

  // privacy: a page under a private page is private; `private` puts top-level pages into the member's Private section
  const priv: boolean[] = []
  items.forEach((it, i) => {
    const p = it.parent
    if (p.kind === 'batch') priv.push(priv[p.index]!)
    else if (p.kind === 'page') {
      const own = pagePrivate(p.page.id)
      if (wantPrivate && team && !own)
        throw new McpToolError(mcpError('private_scope', batch ? `pages[${i}].parentId` : 'parentId', `${q(titleOf(p.page))} is seen by the whole workspace: a private page goes at the top of Private or under a private page`))
      priv.push(own)
    } else priv.push(wantPrivate && team)
  })
  items.forEach((it, i) => checkFileScope(it.markdown, priv[i]!, q(it.title)))

  // a link in the parent's text: the parent takes it (not locked)
  if (link !== 'none') {
    if (!items.some((it) => it.parent.kind !== 'none')) throw new McpToolError(mcpError('bad_argument', 'linkInParent', 'the new pages have no parent to link them in'))
    for (const it of items)
      if (it.parent.kind === 'page' && it.parent.page.settings.locked)
        throw new McpToolError(mcpError('locked', 'linkInParent', `${q(titleOf(it.parent.page))} is locked in One: no link can be added to its text`, 'Leave linkInParent out, or ask the person to unlock it.'))
  }
  const place = batch ? null : placeOf(args, items[0]!.parent.kind === 'page' ? items[0]!.parent.page.id : null)

  // staged in list order: a "$n" parent is a page staged before (the agent's create_page takes its id)
  const stage = callStage()
  const ids: ID[] = []
  items.forEach((it, i) => {
    const parentId = it.parent.kind === 'page' ? it.parent.page.id : it.parent.kind === 'batch' ? ids[it.parent.index]! : ''
    try {
      stageWith(stage, 'create_page', { title: it.title, markdown: it.markdown, ...(parentId ? { parent_id: parentId } : {}) })
    } catch (e) {
      atPath(e, batch ? `pages[${i}]` : '')
    }
    const c = stage.changes.filter((x) => x.kind === 'create_page').at(-1)!
    if (it.parent.kind === 'none' && priv[i]) stage.update(c.id, { privateRoot: true })
    ids.push(c.pageId)
  })
  assertStageWritable(stage.changes)
  const parentIdOf = (i: number): ID | null => {
    const p = items[i]!.parent
    return p.kind === 'page' ? p.page.id : p.kind === 'batch' ? ids[p.index]! : null
  }
  const titleIn = (i: number) => {
    const p = items[i]!.parent
    return p.kind === 'page' ? titleOf(p.page) : p.kind === 'batch' ? items[p.index]!.title : t('features.mcp.plan.topLevel')
  }

  // the card
  const lines: PlanLine[] = []
  const callParent = shared && !shared.startsWith('$') ? ws().pages[shared] : undefined
  const where = callParent ? [pathOf(callParent.id), titleOf(callParent)].filter(Boolean).join(' / ') : t('features.mcp.plan.topLevel')
  if (!batch || callParent) lines.push({ k: 'fact', label: t('features.mcp.plan.in'), value: batch ? where : items[0]!.parent.kind === 'page' ? [pathOf(parentIdOf(0)!), titleIn(0)].filter(Boolean).join(' / ') : where })
  if (batch) {
    items.forEach((it, i) => {
      const own = it.parent.kind === 'batch' || (it.parent.kind === 'page' && it.parent.page.id !== callParent?.id)
      // the number counts from 01 as people count (Claude's "$<index>" stays in its arguments); the parent by title
      lines.push({ k: 'fact', label: rowNo(i), value: `${it.icon ? `${iconText(it.icon)} ` : ''}${it.title}${own ? ` · ${t('features.mcp.plan.under', { title: titleIn(i) })}` : ''}` })
      // the text of each page under its line (not only the first one's: the person approves what they saw)
      lines.push(...bodyLine(it.title, it.markdown))
    })
  } else {
    const it = items[0]!
    if (it.icon) lines.push({ k: 'fact', label: t('features.mcp.plan.icon'), value: iconText(it.icon) ?? '' })
    if (place) lines.push({ k: 'fact', label: t('features.mcp.plan.position'), value: place.label })
    if (it.markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(it.markdown.trim().length) }), value: preview(it.markdown) })
  }
  if (wantPrivate && team) lines.push({ k: 'fact', label: t('features.mcp.plan.private'), value: t('features.mcp.plan.privateYes') })
  // a link written into a ROW's text changes that row's text: what fills again on it (autofill on the text, as
  // one_update_page on a row) is named, and from MCP_LIMITS.rowsAsk such rows the call is always asked (sideHold)
  const sides: SideEffects[] = []
  if (link !== 'none') {
    const parents = [...new Set(items.map((_, i) => (parentIdOf(i) ? titleIn(i) : '')).filter(Boolean))]
    lines.push({ k: 'fact', label: t('features.mcp.plan.link'), value: t(`features.mcp.plan.link.${link}`, { title: parents.join(', ') }) })
    const rowsByDb = new Map<ID, Set<ID>>()
    for (const it of items) {
      const dbId = it.parent.kind === 'page' ? it.parent.page.databaseId : null
      if (dbId && it.parent.kind === 'page') rowsByDb.set(dbId, (rowsByDb.get(dbId) ?? new Set()).add(it.parent.page.id))
    }
    for (const [dbId, rows] of rowsByDb) {
      const db = ws().databases[dbId]
      if (db) sides.push(sideEffects(db, rows.size, { text: true, props: new Set() }))
    }
    for (const side of sides) lines.push(...side.lines)
  }
  const hold = sideHold(sides)
  lines.push(...hold.lines)
  const tasks = itemPlan(stage.changes)
  lines.push(...tasks.lines)
  const note = wantPrivate && !team ? 'This is a local workspace: it has no Private section, so the pages are normal pages (only on this device anyway).' : undefined

  return {
    tool: 'one_create_page',
    verb: t(batch ? 'features.mcp.verb.createPages' : 'features.mcp.verb.createPage'),
    summary: batch ? batchSummary(items) : t('features.mcp.sum.createPage', { title: items[0]!.title, where: items[0]!.parent.kind === 'page' ? titleIn(0) : t('features.mcp.plan.topLevel') }),
    target: batch ? (callParent ? titleOf(callParent) : t('features.mcp.plan.topLevel')) : items[0]!.title,
    lines,
    ...(tasks.holds.length || hold.alwaysAsk ? { alwaysAsk: true } : {}),
    async apply(writer) {
      // a parent locked while the card waited takes no link (spec § 3.3): refused before anything is made
      if (link !== 'none')
        for (const it of items)
          if (it.parent.kind === 'page' && ws().pages[it.parent.page.id]?.settings.locked)
            throw new McpToolError(mcpError('locked', 'linkInParent', `${q(titleOf(it.parent.page))} was locked meanwhile: no link can be added to its text`, 'Leave linkInParent out, or ask the person to unlock it.'))
      // every page staged — their tasks settled again, their parents first (applyOrder)
      const { undo: stagedUndo } = await applyStaged(stage.changes, writer)
      const undos: Array<() => boolean> = []
      /** the links written into each parent's text (linkInParent): the text before, its revision and key after */
      const links: Array<{ parentId: ID; prev: JSONContent | null | undefined; rev: number | undefined; key: string; kids: ID[] }> = []
      // icons, then the place of a single page (both taken back first by the Undo, so the pages read as made)
      withWriter(writer, () => {
        items.forEach((it, i) => {
          if (!it.icon) return
          const id = ids[i]!
          ws().updatePage(id, { icon: it.icon })
          undos.push(() => {
            const now = ws().pages[id]
            if (!now || iconText(now.icon) !== iconText(it.icon)) return false
            ws().updatePage(id, { icon: null })
            return true
          })
        })
        if (place) ws().movePage(ids[0]!, parentIdOf(0), place.storeIndex)
      })
      // the links: per parent, at the end of its text, in list order — one write per parent (a version first)
      if (link !== 'none') {
        const byParent = new Map<ID, number[]>()
        items.forEach((_, i) => {
          const p = parentIdOf(i)
          if (p) byParent.set(p, [...(byParent.get(p) ?? []), i])
        })
        for (const [parentId, kids] of byParent) {
          if (!live(parentId)) continue
          if (!ids.includes(parentId)) await snapshotNow(parentId, 'ai')
          const page = ws().pages[parentId]
          if (!page) continue
          const prev = page.content
          const add: JSONContent[] = kids.map((i) =>
            link === 'block' ? { type: 'pageLink', attrs: { pageId: ids[i] } } : { type: 'paragraph', content: [{ type: 'mention', attrs: { id: ids[i], label: priv[i] ? null : items[i]!.title, kind: 'page' } }] },
          )
          withWriter(writer, () => ws().setContent(parentId, { type: 'doc', content: isEmptyDoc(prev) ? add : [...(prev?.content ?? []), ...add] }, 'ai'))
          const rev = ws().pages[parentId]?.contentRev
          const key = contentKey(ws().pages[parentId]?.content)
          links.push({ parentId, prev, rev, key, kids: kids.map((i) => ids[i]!) })
        }
      }
      const result = batch
        ? { pages: items.map((it, i) => ({ index: i, id: ids[i]!, title: it.title, url: pageUrl(ids[i]!), parentId: parentIdOf(i) })), ...tasksOf(tasks.created) }
        : { id: ids[0]!, title: items[0]!.title, url: pageUrl(ids[0]!), parentId: parentIdOf(0), path: pathOf(ids[0]!), ...(priv[0] ? { private: true } : {}), ...tasksOf(tasks.created) }
      return {
        result: note ? { ...result, note } : result,
        // icons, the text of a parent the call made itself and nobody wrote in since first (its text as it was: it reads
        // as made, stage.ts), then the pages (each to the trash while nobody changed it since); after that, in every
        // parent only the call's links to pages that went go — a link to a page kept stays with it, whether or not
        // someone wrote in the parent since (an untouched parent whose pages all went gets its text back exactly)
        undo: () => {
          const own = (gone: ReadonlySet<ID>) => (n: JSONContent) => {
            // the call's own shapes: a page link block, a line holding only the page's mention
            if (n.type === 'pageLink') return gone.has(n.attrs?.pageId)
            const only = n.type === 'paragraph' && n.content?.length === 1 ? n.content[0]! : null
            return !!only && only.type === 'mention' && only.attrs?.kind === 'page' && gone.has(only.attrs?.id)
          }
          const untouched = (l: (typeof links)[number]) => {
            const now = ws().pages[l.parentId]
            return !!now && (now.contentRev === l.rev || contentKey(now.content) === l.key)
          }
          // made parents written back first: the text as the call left it, for the links of pages kept after all
          const madeFirst = new Map<ID, JSONContent | null | undefined>()
          for (const l of links) {
            if (!ids.includes(l.parentId) || !untouched(l)) continue
            madeFirst.set(l.parentId, ws().pages[l.parentId]!.content)
            ws().setContent(l.parentId, l.prev ?? null, 'ai')
          }
          const ok = [...undos.reverse().map((u) => u()), stagedUndo()]
          for (const l of links) {
            const now = ws().pages[l.parentId]
            if (!now) continue
            const gone = new Set(l.kids.filter((id) => !live(id)))
            const all = gone.size === l.kids.length
            if (madeFirst.has(l.parentId)) {
              // its text went back already; a page of it kept (and so the parent with it): its link comes back
              if (!all && live(l.parentId)) {
                const next = withoutNodes(madeFirst.get(l.parentId), own(gone)) ?? madeFirst.get(l.parentId)
                ws().setContent(l.parentId, next ?? null, 'ai')
              }
              continue
            }
            if (all && untouched(l)) {
              ws().setContent(l.parentId, l.prev ?? null, 'ai')
              continue
            }
            if (!gone.size) continue
            const next = withoutNodes(now.content, own(gone))
            if (next) ws().setContent(l.parentId, next, 'ai')
          }
          return ok.every(Boolean)
        },
      }
    },
  }
}
