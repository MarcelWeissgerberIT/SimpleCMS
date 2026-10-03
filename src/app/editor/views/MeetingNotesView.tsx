/**
 * Meeting notes block — the frame. The controls (transport, transcript, Claude) come from the
 * features area (MeetingDeck above the notes, MeetingFoot below); the notes in between are
 * ProseMirror content: normal, editable blocks. A failing deck never takes the notes down.
 */
import { Component, useEffect, useReducer, type CSSProperties, type ReactNode } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { MeetingDeck, MeetingFoot } from '../../features'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { asStatus } from '../schema/meetingNotes'
import './meeting.css'

class DeckGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[editor] meeting controls failed', err)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function MeetingNotesView({ node, editor }: ReactNodeViewProps) {
  const t = useT()
  // locking the page (or a viewer role) flips the editor's editable flag without a transaction:
  // follow the inputs and read the flag again once PageEditor has applied it
  const pageId = editor.view.dom.getAttribute('data-page-id')
  const locked = useWorkspace((s) => !!pageId && !!s.pages[pageId]?.settings.locked)
  const viewer = useCloud((s) => s.readOnly)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = window.setTimeout(bump, 0)
    return () => window.clearTimeout(id)
  }, [locked, viewer])
  const editable = !editor.isDestroyed && editor.isEditable && !locked
  const status = asStatus(node.attrs.status)
  const first = node.firstChild
  const blank = editable && node.childCount === 1 && !!first && first.type.name === 'paragraph' && first.content.size === 0
  const style = { '--mtg-hint': JSON.stringify(t('features.meeting.notesHint')) } as CSSProperties
  return (
    <NodeViewWrapper className={`mtg is-${status}${blank ? ' is-blank' : ''}`} data-type="meeting-notes" data-status={status} style={style}>
      <DeckGuard>
        <MeetingDeck editor={editor} node={node} editable={editable} />
      </DeckGuard>
      <NodeViewContent className="mtg__notes" />
      <DeckGuard>
        <MeetingFoot editor={editor} node={node} editable={editable} />
      </DeckGuard>
    </NodeViewWrapper>
  )
}

/** The deck and foot belong to React (keys, inputs, menus); the notes to ProseMirror. */
export const meetingViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('.mtg__deck, .mtg__foot'),
}
