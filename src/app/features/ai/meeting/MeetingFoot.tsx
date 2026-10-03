/**
 * Below the notes: where the data goes (honest privacy line) and "Send action items to a
 * database" — a searchable list of databases; one row per open to-do, linked back in the notes.
 */
import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { meetingAttrs } from '../../../editor'
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
import { sendActionItems } from './toDatabase'
import { editorPageId } from './write'

export function MeetingFoot({ editor, node, editable }: { editor: Editor; node: PMNode; editable: boolean }) {
  const t = useT()
  const attrs = useMemo(() => meetingAttrs(node), [node])
  const pending = useMemo(() => actionItemsIn(node).filter((a) => a.text && !a.linked).length, [node])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!editable) return null
  const vendor = speechSupported() ? speechVendor() : null
  const showSend = !!attrs.id && pending > 0 && (attrs.status === 'done' || attrs.status === 'idle')
  return (
    <div className="mtg__foot" contentEditable={false} suppressContentEditableWarning>
      <p className="mtg__privacy">
        <ShieldCheck size={13} strokeWidth={1.75} aria-hidden />
        <span>
          {vendor ? `${t(`features.meeting.privacy.${vendor}`)} · ` : ''}
          {t('features.meeting.privacy.claude')}
        </span>
      </p>
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
            const n = sendActionItems(editor, attrs.id!, editorPageId(editor), dbId)
            if (!n) return
            const db = pageTitle(useWorkspace.getState().pages[dbId], t('common.untitled'))
            toast({
              message: n === 1 ? t('features.meeting.db.sentOne', { db }) : t('features.meeting.db.sent', { n, db }),
              kind: 'success',
              action: { label: t('features.meeting.db.open'), run: () => openPage(dbId) },
            })
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
