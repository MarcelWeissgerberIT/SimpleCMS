/**
 * KitHost — mount once (shell/App.tsx): the refusals of `validate` scripts at their cells, and the
 * kit's dialogs (reviewing someone else's scripts, "Turn into list"), loaded when first needed.
 */
import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useT } from '../../i18n'
import { dismissRefusal, useRefusals } from './write'
import { useKitDialogs } from './review'
import './host.css'

const KitDialogs = lazy(() => import('./dialogs'))

export function KitHost() {
  const t = useT()
  const refusals = useRefusals((s) => s.list)
  const open = useKitDialogs((s) => !!s.review || !!s.toList)
  return (
    <>
      {refusals.length > 0 &&
        createPortal(
          refusals.map((r) => (
            <div
              key={r.id}
              className="kt-refusal"
              role="alert"
              data-testid="kt-refusal"
              style={{ left: Math.max(8, Math.min(r.rect!.x, window.innerWidth - 328)), top: Math.min(r.rect!.y + r.rect!.height + 4, window.innerHeight - 80) }}
            >
              <AlertTriangle size={14} strokeWidth={2} aria-hidden />
              <span className="kt-refusal__text">{r.message}</span>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.close')} onClick={() => dismissRefusal(r.id)}>
                <X size={12} aria-hidden />
              </button>
            </div>
          )),
          document.body,
        )}
      {open && (
        <Suspense fallback={null}>
          <KitDialogs />
        </Suspense>
      )}
    </>
  )
}
