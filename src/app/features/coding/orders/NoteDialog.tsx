/**
 * "Prüfen lassen …" (spec §1.2): the one-line note — "Worauf soll geachtet werden?" — then the request (send.ts: the
 * note goes into the row above the page mention, then planning starts). ↵ sends, Esc closes (nothing is made).
 */
import { useState } from 'react'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { sendToOrders } from './send'
import './orders.css'

export default function OrderNoteDialog({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const title = useWorkspace((s) => s.pages[pageId]?.title.trim() || t('common.untitled'))
  const [note, setNote] = useState('')
  const go = () => {
    onClose()
    sendToOrders(pageId, { note })
  }
  return (
    <Modal
      open
      onClose={onClose}
      label={`§ ${t('features.coding.order.short')} — ${t('features.coding.order.note.code')}`}
      title={t('features.coding.order.note.title')}
      width={480}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="orn-form" className="btn btn--primary" data-testid="order-note-go">
            {t('features.coding.order.note.go')}
            <span className="kbd" aria-hidden>
              ↵
            </span>
          </button>
        </>
      }
    >
      <p className="orn__intro">{t('features.coding.guide.note')}</p>
      <form
        id="orn-form"
        className="orn"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <p className="orn__page label" title={title}>
          {title}
        </p>
        <label className="orn__field">
          <span className="label">{t('features.coding.order.note.label')}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t('features.coding.order.note.placeholder')} autoFocus data-testid="order-note" />
        </label>
      </form>
    </Modal>
  )
}
