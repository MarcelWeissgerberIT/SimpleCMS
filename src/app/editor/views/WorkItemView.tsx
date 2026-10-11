/**
 * Task block (`workItem`) — the node view: the placard chrome (status key, spec label, ⋯, chips, lock line) around
 * the block's own content (title line + notes, ProseMirror: editable as usual).
 *
 *  - Interactive on an editable page (`editor.isEditable`, a bridge, the page not locked, not read-only in a team):
 *    the key + ⌄, the label (copies the task's link), ⋯ (the task's menu), chips that open their pickers, ghost keys.
 *  - Otherwise (a locked page, a viewer, a template editor, history previews, slides): the same placard without keys —
 *    the LED an image (its title says why), chips as text with titles and states from the index.
 *  - Share links and exports carry no ids (frozen): the static placard with counts (P0's PlacardChips).
 * What the placard shows beyond the node's attrs comes from the workspace index (`useItemView`, identity per
 * instance: a keystroke in one task re-renders no other placard). Compact inside a list item (its parent is a
 * listItem / taskItem): one line, avatars only.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { templateRootOf } from '../../store/selectors'
import { toast } from '../../store/ui'
import { pageHref } from '../../lib/router'
import { useCloud } from '../../cloud'
import { useItemView, useNowMinute } from '../../features/workitems'
import { itemAttrs, type WorkItemAttrs } from '../workitem/attrs'
import { PlacardChips, PlacardHead, usePlacardModel } from '../workitem/Placard'
import { ItemChips, LockLine } from '../workitem/Chips'
import { StatusKeys } from '../workitem/StatusKey'
import { itemCounters } from '../workitem/lookup'
import { todoProgress } from '../workitem/text'
import { commitItem, focusFirstNote, itemTargetAt, openItemPickerAt } from '../workitem/keys'
import { bridgeOf } from '../context/redo'
import { hoverRefCard, leaveRefCard } from '../workitem/ItemPickers'
import type { PlacardComputed } from '../workitem/format'
import { newItemId } from '../../lib/itemIds'

const COMPACT_PARENTS = new Set(['listItem', 'taskItem'])

function pageIdOf(editor: Editor): string | null {
  return editor.isDestroyed ? null : editor.view.dom.getAttribute('data-page-id')
}

function Placard({ node, editor, getPos, allowKeys }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'> & { allowKeys: boolean }) {
  itemCounters.renders++
  const t = useT()
  // the same attrs object while the node's attrs are unchanged (typing in the title keeps them)
  const attrs = useMemo(() => itemAttrs(node.attrs), [node.attrs])
  const pageId = pageIdOf(editor)
  const locked = useWorkspace((s) => !!pageId && !!s.pages[pageId]?.settings.locked)
  const template = useWorkspace((s) => !!pageId && !!s.pages[pageId] && templateRootOf(s.pages, pageId) !== null)
  const viewer = useCloud((s) => s.readOnly)
  // locking the page (or a viewer role) flips the editor's editable flag without a transaction: render once more
  // after such a CHANGE (never on mount — opening a page of 300 tasks would render each placard twice for nothing)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const flags = useRef({ locked, viewer })
  useEffect(() => {
    if (flags.current.locked === locked && flags.current.viewer === viewer) return
    flags.current = { locked, viewer }
    const id = window.setTimeout(bump, 0)
    return () => window.clearTimeout(id)
  }, [locked, viewer])
  const bridge = allowKeys && !editor.isDestroyed ? bridgeOf(editor) : null
  const templateEditor = !editor.isDestroyed && editor.view.dom.hasAttribute('data-template-editor')
  const interactive = allowKeys && !editor.isDestroyed && editor.isEditable && !!bridge && !locked && !viewer && !templateEditor
  const view = useItemView(attrs, pageId)
  const now = useNowMinute()
  const computed = useMemo<PlacardComputed>(
    () => ({ blocked: view.blocked, afterAll: view.afterAll, blockers: view.blockers.length, template, duplicate: view.duplicate === 'loser' }),
    [view.blocked, view.afterAll, view.blockers.length, template, view.duplicate],
  )
  const model = usePlacardModel(attrs, computed, now)
  const pos = typeof getPos === 'function' ? getPos() : undefined
  const compact = typeof pos === 'number' && !editor.isDestroyed && pos <= editor.state.doc.content.size && COMPACT_PARENTS.has(editor.state.doc.resolve(pos).parent.type.name)
  const progress = useMemo(() => todoProgress(node), [node])
  const hasNotes = node.childCount > 1
  const readonlyWhy = !interactive && allowKeys ? (locked ? t('editor.workItem.readonly.locked') : viewer ? t('editor.workItem.readonly.viewer') : null) : null

  const at = () => {
    const p = typeof getPos === 'function' ? getPos() : undefined
    return typeof p === 'number' ? p : null
  }
  const open = (kind: Parameters<typeof openItemPickerAt>[2], _el: HTMLElement | null, extra?: { ref?: string; hover?: boolean }) => {
    const p = at()
    if (p === null) return
    if (extra?.hover && bridge) return hoverRefCard(editor, bridge, p, extra.ref!)
    openItemPickerAt(editor, p, kind, kind === 'ref' ? 'chip' : 'chip', extra)
  }
  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}${pageHref(pageId ?? '', attrs.id ?? undefined)}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ message: t('editor.workItem.linkCopied'), kind: 'success' })
    } catch {
      toast({ message: url })
    }
  }
  const newId = () => {
    const p = at()
    const target = p === null ? null : itemTargetAt(editor, p)
    if (target) commitItem(editor, target, { itemId: newItemId() }, { by: 'person' })
  }
  const data = {
    'data-type': 'work-item',
    'data-status': attrs.status,
    'data-late': model.due?.late ? '' : undefined,
    'data-state': model.computed ?? undefined,
    'data-compact': compact ? '' : undefined,
    'data-interactive': interactive ? '' : undefined,
  }
  return (
    <NodeViewWrapper className="workitem" {...data}>
      <PlacardHead
        model={model}
        keys={<StatusKeys editor={editor} getPos={() => at() ?? undefined} attrs={attrs} openBlockers={view.openBlockers} interactive={interactive} statusText={model.statusText} readonlyWhy={readonlyWhy} />}
        onCopyLink={interactive && attrs.id ? copyLink : undefined}
        onMore={interactive ? () => bridge && at() !== null && bridge.setState({ blockMenu: { pos: at()! } }) : undefined}
        onNewId={interactive && model.computed === 'duplicate' ? newId : undefined}
      />
      <NodeViewContent className="workitem__body" />
      <ItemChips
        model={model}
        attrs={attrs}
        view={view}
        progress={progress}
        hasNotes={hasNotes}
        interactive={interactive}
        compact={compact}
        open={open}
        leave={bridge ? () => leaveRefCard(bridge) : undefined}
        onNote={() => {
          const p = at()
          if (p !== null) focusFirstNote(editor, p)
        }}
        onUnlink={(id) => {
          const p = at()
          const target = p === null ? null : itemTargetAt(editor, p)
          if (target) commitItem(editor, target, attrs.blockedBy.includes(id) ? { blockedBy: { remove: [id] } } : { related: { remove: [id] } }, { by: 'person' })
        }}
      />
      {view.blocked && !compact && <LockLine open={view.openBlockers} total={view.blockers.length} />}
    </NodeViewWrapper>
  )
}

/** Share links / exports (frozen: names and counts, no ids) — the static placard. */
function FrozenPlacard({ attrs }: { attrs: WorkItemAttrs }) {
  const model = usePlacardModel(attrs)
  return (
    <NodeViewWrapper className="workitem" data-type="work-item" data-status={attrs.status} data-late={model.due?.late ? '' : undefined}>
      <PlacardHead model={model} />
      <NodeViewContent className="workitem__body" />
      <PlacardChips model={model} />
    </NodeViewWrapper>
  )
}

export function WorkItemView({ node, editor, getPos }: ReactNodeViewProps) {
  return <Placard node={node} editor={editor} getPos={getPos} allowKeys />
}

/** History previews, slides: the placard without keys (titles from the index); share links: the frozen one. */
export function StaticWorkItemView({ node, editor, getPos }: ReactNodeViewProps) {
  const attrs = useMemo(() => itemAttrs(node.attrs), [node.attrs])
  if (attrs.frozen || !attrs.itemId) return <FrozenPlacard attrs={attrs} />
  return <Placard node={node} editor={editor} getPos={getPos} allowKeys={false} />
}

/** The chrome is React's (no caret, no mutations); the title and notes are ProseMirror's. Drags pass through. */
const CHROME = '.workitem__head button, .workitem__chips, .workitem__more, .workitem__lock'
export const workItemViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.(CHROME),
}
