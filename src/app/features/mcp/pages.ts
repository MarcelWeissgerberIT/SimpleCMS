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
import { stripRefLabels } from '../../../shared/mcp/refs'

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
      const title = str(o.title, `${path}.title`, { max: 300 }).replace(/\s+/g, ' ').trim()
      if (!title) throw new McpToolError(mcpError('bad_argument', `${path}.title`, 'a page needs a title'))
      let icon: PageIcon | null | undefined
      try {
        icon = parseIcon(o.icon)
      } catch (e) {
        atPath(e, `${path}.icon`)
      }
      const own = str(o.parentId, `${path}.parentId`, { max: 80 }).trim()
      const parentRaw = own || shared
      return { title, markdown: stripRefLabels(str(o.markdown, `${path}.markdown`, { max: 200_000 })), icon, parent: parentRaw ? parentOf(parentRaw, own ? `${path}.parentId` : 'parentId', i, true) : { kind: 'none' } }
    })
    const total = items.reduce((n, p) => n + p.markdown.length, 0)
    if (total > MCP_LIMITS.pagesChars) throw new McpToolError(mcpError('too_large', 'pages', `the pages hold ${total.toLocaleString('en')} characters in all (at most ${MCP_LIMITS.pagesChars.toLocaleString('en')})`, 'Split them over two calls.'))
  } else {
    const title = str(args.title, 'title', { required: true, max: 300 }).replace(/\s+/g, ' ').trim()
    if (!title) throw new McpToolError(mcpError('bad_argument', 'title', 'a page needs a title (or pass "pages")'))
    items = [{ title, markdown: stripRefLabels(str(args.markdown, 'markdown', { max: 200_000 })), icon: parseIcon(args.icon), parent: shared ? parentOf(shared, 'parentId', 0, false) : { kind: 'none' } }]
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
      lines.push({ k: 'fact', label: `$${i}`, value: `${it.icon ? `${iconText(it.icon)} ` : ''}${it.title}${own ? ` · ${t('features.mcp.plan.under', { title: titleIn(i) })}` : ''}` })
    })
    const first = items.find((it) => it.markdown.trim())
    if (first) lines.push({ k: 'md', label: t('features.mcp.plan.contentOf', { title: first.title, n: chars(first.markdown.trim().length) }), value: preview(first.markdown) })
  } else {
    const it = items[0]!
    if (it.icon) lines.push({ k: 'fact', label: t('features.mcp.plan.icon'), value: iconText(it.icon) ?? '' })
    if (place) lines.push({ k: 'fact', label: t('features.mcp.plan.position'), value: place.label })
    if (it.markdown.trim()) lines.push({ k: 'md', label: t('features.mcp.plan.content', { n: chars(it.markdown.trim().length) }), value: preview(it.markdown) })
  }
  if (wantPrivate && team) lines.push({ k: 'fact', label: t('features.mcp.plan.private'), value: t('features.mcp.plan.privateYes') })
  if (link !== 'none') {
    const parents = [...new Set(items.map((_, i) => (parentIdOf(i) ? titleIn(i) : '')).filter(Boolean))]
    lines.push({ k: 'fact', label: t('features.mcp.plan.link'), value: t(`features.mcp.plan.link.${link}`, { title: parents.join(', ') }) })
  }
  const tasks = itemPlan(stage.changes)
  lines.push(...tasks.lines)
  const note = wantPrivate && !team ? 'This is a local workspace: it has no Private section, so the pages are normal pages (only on this device anyway).' : undefined

  return {
    tool: 'one_create_page',
    verb: t(batch ? 'features.mcp.verb.createPages' : 'features.mcp.verb.createPage'),
    summary: batch ? t('features.mcp.sum.createPages', { n: chars(items.length), where: callParent ? titleOf(callParent) : t('features.mcp.plan.topLevel') }) : t('features.mcp.sum.createPage', { title: items[0]!.title, where: items[0]!.parent.kind === 'page' ? titleIn(0) : t('features.mcp.plan.topLevel') }),
    target: batch ? (callParent ? titleOf(callParent) : t('features.mcp.plan.topLevel')) : items[0]!.title,
    lines,
    ...(tasks.holds.length ? { alwaysAsk: true } : {}),
    async apply(writer) {
      // every page staged — their tasks settled again, their parents first (applyOrder)
      const { undo: stagedUndo } = await applyStaged(stage.changes, writer)
      const undos: Array<() => boolean> = []
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
          undos.push(() => {
            const now = ws().pages[parentId]
            if (!now || (now.contentRev !== rev && contentKey(now.content) !== key)) return false
            ws().setContent(parentId, prev, 'ai')
            return true
          })
        }
      }
      const result = batch
        ? { pages: items.map((it, i) => ({ index: i, id: ids[i]!, title: it.title, url: pageUrl(ids[i]!), parentId: parentIdOf(i) })), ...tasksOf(tasks.created) }
        : { id: ids[0]!, title: items[0]!.title, url: pageUrl(ids[0]!), parentId: parentIdOf(0), path: pathOf(ids[0]!), ...(priv[0] ? { private: true } : {}), ...tasksOf(tasks.created) }
      return {
        result: note ? { ...result, note } : result,
        // links and icons first, then the pages (each to the trash while nobody changed it since — stage.ts)
        undo: () => [...undos.reverse().map((u) => u()), stagedUndo()].every(Boolean),
      }
    },
  }
}
