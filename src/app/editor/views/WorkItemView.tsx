/**
 * Task block (`workItem`) — the node view: the read-only placard chrome (status key, spec label, chips)
 * around the block's own content (title line + notes, ProseMirror: editable as usual). In this release
 * nothing on the placard is a control; read-only renders (share, history, slides) use StaticWorkItemView.
 */
import { useMemo } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { itemAttrs } from '../workitem/attrs'
import { PlacardChips, PlacardHead, usePlacardModel } from '../workitem/Placard'

function Placard({ node }: Pick<ReactNodeViewProps, 'node'>) {
  const attrs = useMemo(() => itemAttrs(node), [node])
  const model = usePlacardModel(attrs)
  return (
    <NodeViewWrapper className="workitem" data-type="work-item" data-status={attrs.status} data-late={model.due?.late ? '' : undefined}>
      <PlacardHead model={model} />
      <NodeViewContent className="workitem__body" />
      <PlacardChips model={model} />
    </NodeViewWrapper>
  )
}

export function WorkItemView({ node }: ReactNodeViewProps) {
  return <Placard node={node} />
}

/** Share links, history previews, slides: the same placard (never a control). */
export function StaticWorkItemView({ node }: ReactNodeViewProps) {
  return <Placard node={node} />
}

/** The chrome is React's (no caret, no mutations); the title and notes are ProseMirror's. */
export const workItemViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('.workitem__chips'),
}
