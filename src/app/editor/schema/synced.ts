/**
 * Synced block: `syncedBlock` (attrs: syncId, sourcePageId; content: blocks) — the same content
 * on several pages, edited anywhere, changed everywhere.
 *
 *  - sourcePageId null = the ORIGINAL (its content is the truth). A page id = a REFERENCE (on
 *    another page, or the same one): its content is a cached copy of the original's, so every
 *    page still renders, searches, exports and shares on its own.
 *  - The synced-block service (../synced/service.ts) keeps the copies in step through the store
 *    (setContent origin 'synced'). This file is the schema plus the editor rules:
 *      · no synced block inside a synced block (Notion's rule): pasting / dropping one into a
 *        synced block is refused or unwrapped; anything still nested is flattened (content kept)
 *      · a pasted ORIGINAL whose original still lives becomes a REFERENCE (copy = synced copy);
 *        moved ones (drag, cut + paste) keep their role
 *      · two originals of one group in a doc (duplicate block): the later becomes a reference
 *      · a reference whose original is gone is read-only ("Original deleted — content kept")
 *  - HTML: <div data-type="synced-block" data-sync-id data-source-page-id> + content.
 *    Markdown: the content only. stripSynced(doc): plain blocks, for docs leaving the workspace.
 */
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { t } from '../../i18n'
import { toast } from '../../store/ui'
import { canonContent, hasOrphans, isOrphanGroup, liveSourceOf } from '../synced/state'

export const SYNCED = 'syncedBlock'
/** Transaction meta of deliberate structural changes (unsync …): never blocked. */
export const SYNCED_META = 'oneSynced'

const isSynced = (n: PMNode | null | undefined): boolean => !!n && n.type.name === SYNCED
const attrStr = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** The synced block around a position (they never nest, so there is at most one). */
export function syncedAround($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let d = $pos.depth; d > 0; d--) if (isSynced($pos.node(d))) return { pos: $pos.before(d), node: $pos.node(d) }
  return null
}

function hasSynced(f: Fragment): boolean {
  let found = false
  f.descendants((n) => {
    if (found) return false
    if (isSynced(n)) found = true
    return !found && !n.isTextblock
  })
  return found
}

/** Every synced block in a fragment replaced by its content. */
function unwrapAll(f: Fragment): Fragment {
  if (!hasSynced(f)) return f
  const out: PMNode[] = []
  f.forEach((n) => {
    if (isSynced(n)) unwrapAll(n.content).forEach((c) => out.push(c))
    else out.push(n.isTextblock || n.isLeaf ? n : n.copy(unwrapAll(n.content)))
  })
  return Fragment.from(out)
}

/** Depth of the synced block on a slice edge (within its open depth), -1 when there is none. */
function edgeDepth(f: Fragment, open: number, start: boolean): number {
  let node = start ? f.firstChild : f.lastChild
  for (let d = 0; d < open && node; d++) {
    if (isSynced(node)) return d
    node = start ? node.firstChild : node.lastChild
  }
  return -1
}

/** The fragment with the node at `depth` on its first / last edge replaced by that node's content. */
function unwrapOnEdge(f: Fragment, depth: number, start: boolean): Fragment {
  const at = start ? 0 : f.childCount - 1
  const node = f.child(at)
  const inner = depth === 0 ? node.content : Fragment.from(node.copy(unwrapOnEdge(node.content, depth - 1, start)))
  const kids: PMNode[] = []
  f.forEach((c, _o, i) => (i === at ? inner.forEach((k) => kids.push(k)) : kids.push(c)))
  return Fragment.from(kids)
}

/** A synced block cut open by the selection was copied in part: paste that part, not the block. */
function unwrapCutEdges(slice: Slice): Slice {
  let { content, openStart, openEnd } = slice
  const s = edgeDepth(content, openStart, true)
  const e = edgeDepth(content, openEnd, false)
  if (s < 0 && e < 0) return slice
  if (s >= 0) {
    content = unwrapOnEdge(content, s, true)
    openStart--
  }
  if (e >= 0) {
    const e2 = edgeDepth(content, openEnd, false)
    // the same block on both edges is unwrapped already
    if (e2 >= 0) content = unwrapOnEdge(content, e2, false)
    openEnd--
  }
  return new Slice(content, openStart, openEnd)
}

/** Does this doc hold an original of the group? */
function docHasOriginal(doc: PMNode, syncId: string): boolean {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (isSynced(n)) {
      if (n.attrs.syncId === syncId && !n.attrs.sourcePageId) found = true
      return false
    }
    return !n.isTextblock
  })
  return found
}

/** Pasted (not moved) synced blocks: copies of a living original become references to it. */
function asReferences(view: EditorView, f: Fragment, pageId: string | null): Fragment {
  const out: PMNode[] = []
  let changed = false
  f.forEach((n) => {
    if (!isSynced(n)) {
      const inner = n.isTextblock || n.isLeaf ? n.content : asReferences(view, n.content, pageId)
      if (inner !== n.content) changed = true
      out.push(inner === n.content ? n : n.copy(inner))
      return
    }
    const syncId = attrStr(n.attrs.syncId)
    if (!syncId) return void out.push(n)
    let source = attrStr(n.attrs.sourcePageId)
    if (!source) {
      const here = docHasOriginal(view.state.doc, syncId)
      const live = liveSourceOf(syncId)
      // the index still names this page, but the original isn't in it any more: it was cut — a move
      source = live && (live !== pageId || here) ? live : here ? pageId : null
    }
    if (!source) return void out.push(n)
    let content = n.content
    const canon = canonContent(syncId)
    if (canon) {
      try {
        content = Fragment.fromJSON(view.state.schema, canon)
      } catch {
        /* keep the pasted copy */
      }
    }
    changed = true
    out.push(n.type.create({ ...n.attrs, sourcePageId: source }, content, n.marks))
  })
  return changed ? Fragment.from(out) : f
}

/** Steps of the transaction that land inside the content of a reference whose original is gone. */
function touchesOrphan(tr: Transaction, doc: PMNode): boolean {
  const ranges: Array<{ from: number; to: number }> = []
  doc.descendants((n, pos) => {
    if (isSynced(n)) {
      const id = attrStr(n.attrs.syncId)
      if (id && n.attrs.sourcePageId && isOrphanGroup(id)) ranges.push({ from: pos + 1, to: pos + n.nodeSize - 1 })
      return false
    }
    return !n.isTextblock
  })
  if (!ranges.length) return false
  let rs = ranges
  for (const step of tr.steps) {
    const map = step.getMap()
    let hit = false
    const check = (from: number, to: number) => {
      for (const r of rs) {
        // replacing the whole block (delete, unsync) is fine; anything inside it is not
        if (from <= r.from - 1 && to >= r.to + 1) continue
        if (from <= r.to && to >= r.from) hit = true
      }
    }
    map.forEach((from, to) => check(from, to))
    const s = step as unknown as { from?: number; to?: number; pos?: number }
    if (typeof s.from === 'number' && typeof s.to === 'number') check(s.from, s.to)
    // attribute / node-mark steps (setNodeAttribute …) map nothing: the node they change starts at `pos`
    if (typeof s.pos === 'number') check(s.pos, s.pos)
    if (hit) return true
    rs = rs.map((r) => ({ from: map.map(r.from, 1), to: map.map(r.to, -1) }))
  }
  return false
}

const QUIET_META = ['preventUpdate', 'y-sync$', 'history$', '__uniqueIDTransaction', SYNCED_META]

function insertsSynced(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as unknown as { slice?: Slice }).slice
    return !!slice && hasSynced(slice.content)
  })
}

export const SyncedBlock = Node.create({
  name: SYNCED,
  group: 'block',
  content: 'block+',
  isolating: true,
  draggable: false,
  // replacing all of its content keeps the block; a copied piece of it doesn't drag it along
  extendNodeSchema(extension) {
    return extension.name === SYNCED ? { definingForContent: true } : {}
  },
  addAttributes() {
    return {
      syncId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-sync-id'),
        renderHTML: (a) => (a.syncId ? { 'data-sync-id': String(a.syncId) } : {}),
      },
      sourcePageId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-source-page-id') || null,
        renderHTML: (a) => (a.sourcePageId ? { 'data-source-page-id': String(a.sourcePageId) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="synced-block"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'synced-block', class: 'synced-block' }), 0]
  },
  renderMarkdown(node, h) {
    return h.renderChildren(node.content ?? [], '\n\n')
  },

  addProseMirrorPlugins() {
    let pageId: string | null = null
    return [
      new Plugin({
        key: new PluginKey('syncedBlock'),
        view(view) {
          pageId = view.dom.getAttribute('data-page-id')
          return {}
        },
        filterTransaction(tr, state) {
          if (!tr.docChanged || !hasOrphans() || QUIET_META.some((m) => tr.getMeta(m))) return true
          return !touchesOrphan(tr, state.doc)
        },
        props: {
          transformPasted(pasted, view) {
            if (!hasSynced(pasted.content)) return pasted
            const slice = unwrapCutEdges(pasted)
            if (!hasSynced(slice.content)) return slice
            if (syncedAround(view.state.selection.$from)) {
              toast({ message: t('editor.synced.noNestingPaste'), kind: 'info' })
              // (no synced block sits on an open edge any more: the depths stay as they are)
              return new Slice(unwrapAll(slice.content), slice.openStart, slice.openEnd)
            }
            // a block moved by dragging keeps its role
            if ((view as unknown as { dragging?: { move?: boolean } | null }).dragging?.move) return slice
            const content = asReferences(view, slice.content, pageId)
            return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd)
          },
          handleDrop(view, event, slice) {
            if (!hasSynced(slice.content)) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!at || !syncedAround(view.state.doc.resolve(at.pos))) return false
            toast({ message: t('editor.synced.noDrop'), kind: 'info' })
            return true
          },
        },
        // nested synced blocks are flattened; a second original of a group becomes a reference
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('y-sync$') || tr.getMeta('preventUpdate'))) return null
          if (!trs.some(insertsSynced)) return null
          const nested: Array<{ pos: number; node: PMNode }> = []
          const dupes: number[] = []
          const originals = new Set<string>()
          state.doc.descendants((n, pos) => {
            if (!isSynced(n)) return !n.isTextblock
            const id = attrStr(n.attrs.syncId)
            if (id && !n.attrs.sourcePageId) {
              if (originals.has(id) && pageId) dupes.push(pos)
              originals.add(id)
            }
            n.descendants((inner, ip) => {
              if (isSynced(inner)) {
                nested.push({ pos: pos + 1 + ip, node: inner })
                return false
              }
              return !inner.isTextblock
            })
            return false
          })
          if (!nested.length && !dupes.length) return null
          const tr = state.tr
          for (const pos of dupes) tr.setNodeAttribute(pos, 'sourcePageId', pageId)
          for (const { pos, node } of nested.reverse()) tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), node.content)
          return tr.setMeta(SYNCED_META, true)
        },
      }),
    ]
  },
})

/** JSON of a new, empty original. */
export function newSyncedJson(syncId: string): JSONContent {
  return { type: SYNCED, attrs: { syncId, sourcePageId: null }, content: [{ type: 'paragraph' }] }
}

/** The doc with every synced block replaced by its content (for anything that leaves the workspace). Same object when there are none. */
export function stripSynced(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    if (!n.content || n.type === 'text') return n
    let changed = false
    const kids: JSONContent[] = []
    for (const c of n.content) {
      if (c?.type === SYNCED) {
        changed = true
        kids.push(...(c.content ?? []).map(walk))
        continue
      }
      const w = c ? walk(c) : c
      if (w !== c) changed = true
      kids.push(w)
    }
    return changed ? { ...n, content: kids.length ? kids : [{ type: 'paragraph' }] } : n
  }
  return walk(doc)
}
