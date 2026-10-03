/**
 * Locked database (model/lock): the toolbar plate (one click unlocks — anyone who can edit; viewers
 * see the same plate, inert) and the note on filter / sort panels that they only apply to this tab.
 */
import { Lock, LockOpen } from 'lucide-react'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import type { DbModel } from '../hooks'
import { resetSessionQuery, setDbLocked } from '../model/lock'

export function LockPlate({ m }: { m: DbModel }) {
  const t = useT()
  if (m.readOnly)
    return (
      <Tooltip label={t('database.lock.hint')}>
        <span className="db-lockplate" tabIndex={0} role="note" aria-label={t('database.lock.hint')} data-testid="db-locked">
          <span className="led led--on" aria-hidden />
          <Lock size={11} strokeWidth={2.2} aria-hidden />
          <span className="db-lockplate__text">{t('database.lock.plate')}</span>
        </span>
      </Tooltip>
    )
  return (
    <Tooltip label={t('database.lock.unlockHint')}>
      <button type="button" className="db-lockplate db-lockplate--btn" data-testid="db-locked" aria-label={t('database.lock.unlock')} onClick={() => setDbLocked(m.db.id, false)}>
        <span className="led led--on" aria-hidden />
        <Lock size={11} strokeWidth={2.2} className="db-lockplate__closed" aria-hidden />
        <LockOpen size={11} strokeWidth={2.2} className="db-lockplate__open" aria-hidden />
        <span className="db-lockplate__text">{t('database.lock.plate')}</span>
      </button>
    </Tooltip>
  )
}

/** Locked database: filters and sorts are this tab's own, never saved. */
export function SessionNote({ m }: { m: DbModel }) {
  const t = useT()
  return (
    <div className="db-sessionnote" role="note">
      <Lock size={12} strokeWidth={2} aria-hidden />
      <span className="db-sessionnote__text">{t('database.lock.sessionOnly')}</span>
      <button type="button" className="db-panel__link" onClick={() => resetSessionQuery(m.db.id)}>
        {t('database.lock.reset')}
      </button>
    </div>
  )
}
