/**
 * Below the notes: where the data goes (honest privacy line), "Make tasks" — the top-level to-dos of the notes become
 * task blocks in one step (toItems.ts; a toast with Undo) — and "Send action items to a database" — a searchable list
 * of databases; one row per open to-do, linked back in the notes.
 */
import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowRight, ShieldCheck, SquareCheckBig } from 'lucide-react'
import { editAs, meetingAttrs } from '../../../editor'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed, pageTitle, sortPages } from '../../../store/selectors'
import { toast } from '../../../store/ui'
import { openPage } from '../../../lib/router'
import { Popover } from '../../../ui/Popover'
import { MenuList, type MenuEntry } from '../../../ui/Menu'
import { PageIcon } from '../../../ui/PageIcon'
import { speechSupported, speechVendor } from './recognition'
import { actionItemsIn } from './notes'
import { missingFields, sendActionItems } from './toDatabase'
import { makeItems, topTodos } from './toItems'
import { canCreateItems } from '../../workitems'
import { editorPageId } from './write'
import { destinationOf } from '../core/status'
import { CreatePropertiesDialog, canCreateProperties, type PropertySuggestion } from '../../../database'

export function MeetingFoot({ editor, node, editable }: { editor: Editor; node: PMNode; editable: boolean }) {
  const t = useT()
  const attrs = useMemo(() => meetingAttrs(node), [node])
  const pending = useMemo(() => actionItemsIn(node).filter((a) => a.text && !a.linked).length, [node])
  /** "Make tasks": the to-dos directly in the notes (the count is exactly what the key makes) */
  const todos = useMemo(() => topTodos(node).length, [node])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // the picked database lacks a person / date property for what the items carry: offer to create it
  const [ask, setAsk] = useState<{ dbId: string; suggestions: PropertySuggestion[] } | null>(null)
  if (!editable) return null
  const dbName = (dbId: string) => pageTitle(useWorkspace.getState().pages[dbId], t('common.untitled'))
  const send = (dbId: string) => {
    if (!attrs.id) return
    const n = sendActionItems(editor, attrs.id, editorPageId(editor), dbId)
    if (!n) return
    const db = dbName(dbId)
    toast({
      message: n === 1 ? t('features.meeting.db.sentOne', { db }) : t('features.meeting.db.sent', { n, db }),
      kind: 'success',
      action: { label: t('features.meeting.db.open'), run: () => openPage(dbId) },
    })
  }
  const vendor = speechSupported() ? speechVendor() : null
  const settled = attrs.status === 'done' || attrs.status === 'idle'
  const showSend = !!attrs.id && pending > 0 && settled
  const showItems = !!attrs.id && todos > 0 && settled && canCreateItems()
  const make = () => {
    if (!attrs.id) return
    const n = makeItems(editor, attrs.id, { kind: 'you', via: 'ui' })
    if (!n) return
    // the key goes with the to-dos: the caret back in the text (⌘Z works there), never focus on the body
    if (!editor.isDestroyed) editor.commands.focus()
    const after = editor.state.doc
    toast({
      message: n === 1 ? t('features.meeting.items.madeOne') : t('features.meeting.items.made', { n }),
      kind: 'success',
      // touch has no ⌘Z: the toast's key undoes it, written as the person's Undo — only while the page is as Make tasks
      // left it (typing since: ⌘Z would take that back first)
      action: {
        label: t('features.workItems.undo'),
        run: () => {
          if (editor.isDestroyed) return
          if (editor.state.doc.eq(after)) editAs(editor, { kind: 'you', via: 'undo' }, () => editor.commands.undo())
          else toast({ message: t('features.meeting.items.undoLate'), kind: 'info' })
        },
      },
    })
  }
  return (
    <div
      className="mtg__foot"
      contentEditable={false}
      suppressContentEditableWarning
      // Tab from the selected notes reaches these keys (editor/extensions/blockTools.ts); Escape goes back to the text
      data-block-tools=""
      onKeyDown={(e) => {
        // only from the foot's own keys (a popover or dialog opened from here handles its own Escape)
        const own = e.target instanceof HTMLElement && e.target.parentElement === e.currentTarget
        if (e.key !== 'Escape' || !own || anchor || ask) return
        e.preventDefault()
        e.stopPropagation()
        editor.commands.focus()
      }}
    >
      <p className="mtg__privacy">
        <ShieldCheck size={13} strokeWidth={1.75} aria-hidden />
        <span>
          {vendor ? `${t(`features.meeting.privacy.${vendor}`)} · ` : ''}
          {t('features.meeting.privacy.claude', { company: destinationOf('meeting.summary').company })}
        </span>
      </p>
      {showItems && (
        <button type="button" className="btn btn--sm mtg__items" data-meeting-key="items" onMouseDown={(e) => e.preventDefault()} onClick={make}>
          <SquareCheckBig size={13} strokeWidth={1.9} aria-hidden />
          {t('features.meeting.items.action', { n: todos })}
        </button>
      )}
      {showSend && (
        <button
          type="button"
          className="btn btn--sm mtg__send"
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          data-meeting-key="send"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        >
          <ArrowRight size={13} strokeWidth={1.9} aria-hidden />
          {pending === 1 ? t('features.meeting.db.sendOne') : t('features.meeting.db.send', { n: pending })}
        </button>
      )}
      {anchor && attrs.id && (
        <DatabasePick
          anchor={anchor}
          onClose={() => setAnchor(null)}
          onPick={(dbId) => {
            setAnchor(null)
            const miss = missingFields(editor, attrs.id!, dbId)
            const suggestions: PropertySuggestion[] = []
            const count = (key: string, n: number) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n })
            if (miss.owner) suggestions.push({ key: 'owner', name: t('features.meeting.db.owner'), type: 'person', fixedType: true, detail: count('features.meeting.db.ownerDetail', miss.owner) })
            if (miss.due) suggestions.push({ key: 'due', name: t('features.meeting.db.due'), type: 'date', fixedType: true, detail: count('features.meeting.db.dueDetail', miss.due) })
            if (suggestions.length && canCreateProperties(dbId)) setAsk({ dbId, suggestions })
            else send(dbId)
          }}
        />
      )}
      {ask && (
        <CreatePropertiesDialog
          dbId={ask.dbId}
          suggestions={ask.suggestions}
          label={t('features.meeting.db.missingLabel')}
          title={t('features.meeting.db.missingTitle', { db: dbName(ask.dbId) })}
          intro={t('features.meeting.db.missingIntro', { db: dbName(ask.dbId) })}
          confirmLabel={t('features.meeting.db.createSend')}
          skipLabel={t('features.meeting.db.sendWithout')}
          onClose={() => setAsk(null)}
          onSkip={() => {
            setAsk(null)
            send(ask.dbId)
          }}
          onConfirm={() => {
            setAsk(null)
            send(ask.dbId)
          }}
        />
      )}
    </div>
  )
}

function DatabasePick({ anchor, onClose, onPick }: { anchor: HTMLElement; onClose: () => void; onPick: (dbId: string) => void }) {
  const t = useT()
  const entries = useMemo<MenuEntry[]>(() => {
    const { pages, databases } = useWorkspace.getState()
    const dbs = sortPages(Object.values(pages).filter((p) => p.kind === 'database' && databases[p.id] && !p.trashed && !isEffectivelyTrashed(pages, p.id)))
    if (!dbs.length) return [{ label: t('features.meeting.db.none'), disabled: true }]
    return [
      { kind: 'section', label: t('features.meeting.db.pick') },
      ...dbs.map(
        (p): MenuEntry => ({
          id: p.id,
          label: pageTitle(p, t('common.untitled')),
          icon: <PageIcon icon={p.icon} kind="database" size={16} />,
          onSelect: () => onPick(p.id),
        }),
      ),
    ]
  }, [t, onPick])
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="top-end" offset={6} style={{ width: 300 }} role="dialog" aria-label={t('features.meeting.db.pick')}>
      <MenuList entries={entries} onClose={onClose} searchable searchPlaceholder={t('features.meeting.db.search')} emptyLabel={t('features.meeting.db.empty')} />
    </Popover>
  )
}
