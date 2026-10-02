import { AlertTriangle } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'

export function ConfirmModal({ title, body, danger, confirmLabel, onConfirm, onClose }: { title: string; body?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  const t = useT()
  const run = () => {
    onClose()
    onConfirm()
  }
  return (
    <Modal open onClose={onClose} width={440} bare className="confirm">
      <form
        className="confirm__body"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        {danger && <div className="confirm__stripes" aria-hidden />}
        <div className="confirm__label label">
          {danger && <AlertTriangle size={12} />}
          {danger ? t('shell.confirm.danger') : t('shell.confirm.check')}
        </div>
        <h2 className="confirm__title">{title}</h2>
        {body && <p className="confirm__text">{body}</p>}
        {/* DOM order decides initial focus: safe choice first for destructive actions */}
        <div className="confirm__actions" data-danger={danger || undefined}>
          {danger ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                {t('common.cancel')}
                <span className="kbd confirm__kbd">Esc</span>
              </button>
              <button type="submit" className="btn btn--danger-solid">
                {confirmLabel ?? t('common.confirm')}
              </button>
            </>
          ) : (
            <>
              <button type="submit" className="btn btn--ink">
                {confirmLabel ?? t('common.confirm')}
                <span className="kbd confirm__kbd">↵</span>
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                {t('common.cancel')}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
