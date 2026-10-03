/**
 * Per-block fault isolation: a node view that throws while rendering is replaced by a small
 * "broken block · remove" plate instead of taking the whole page (or share link) down.
 */
import { Component, type ComponentType } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { TriangleAlert, Trash2 } from 'lucide-react'
import { useT } from '../../i18n'

type View = ComponentType<ReactNodeViewProps>

function BrokenBlock({ node, editor, deleteNode, selected, inline }: ReactNodeViewProps & { inline: boolean }) {
  const t = useT()
  return (
    <NodeViewWrapper
      as={inline ? 'span' : 'div'}
      className={`broken-block${inline ? ' broken-block--inline' : ''}${selected ? ' is-selected' : ''}`}
      data-type={node.type.name}
      contentEditable={false}
      role="alert"
    >
      <TriangleAlert size={inline ? 12 : 14} strokeWidth={1.75} aria-hidden />
      <span className="label">
        {t('editor.broken.label')} · {node.type.name}
      </span>
      {editor.isEditable && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => deleteNode()} title={t('editor.broken.remove')} aria-label={t('editor.broken.remove')}>
          <Trash2 size={12} />
          {!inline && t('editor.broken.remove')}
        </button>
      )}
    </NodeViewWrapper>
  )
}

interface BoundaryProps {
  view: View
  inline: boolean
  viewProps: ReactNodeViewProps
}

class ViewBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err: unknown) {
    console.warn(`[editor] "${this.props.viewProps.node.type.name}" block failed to render`, err)
  }

  componentDidUpdate(prev: BoundaryProps) {
    // new attrs (undo, sync, an edit elsewhere) get a fresh attempt
    if (this.state.failed && prev.viewProps.node !== this.props.viewProps.node) this.setState({ failed: false })
  }

  render() {
    const { view: View, viewProps, inline } = this.props
    return this.state.failed ? <BrokenBlock {...viewProps} inline={inline} /> : <View {...viewProps} />
  }
}

/** Wrap an atom node view (no NodeViewContent) so a render error stays inside its block. */
export function guardView(view: View, opts: { inline?: boolean } = {}): View {
  const inline = !!opts.inline
  function GuardedView(props: ReactNodeViewProps) {
    return <ViewBoundary view={view} inline={inline} viewProps={props} />
  }
  GuardedView.displayName = `Guarded(${view.displayName || view.name || 'View'})`
  return GuardedView
}
