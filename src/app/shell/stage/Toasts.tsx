import { X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'

export function Toasts() {
  const t = useT()
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label={t('shell.toast.region')}>
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-kind={toast.kind ?? 'info'} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast__led" aria-hidden />
          <span className="toast__msg">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action!.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast__close" aria-label={t('common.close')} onClick={() => dismiss(toast.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
