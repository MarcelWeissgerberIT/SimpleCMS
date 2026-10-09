/**
 * Custom agents — closing the editor of a mirror draft unsaved (Cancel, Esc, ×, the scrim): the setup already made the
 * database and its report page, so it asks instead of dropping the draft. Keep editing (the safe choice, focused; Esc,
 * × and the scrim mean it too) · Discard the agent, keep both · Discard and move both to the trash (toast with Undo).
 */
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import type { MirrorMade } from './mirror'
import './mirror.css'

export function MirrorDiscard({ made, onKeep, onDiscard }: { made: Pick<MirrorMade, 'name' | 'reportTitle'>; onKeep: () => void; onDiscard: (trash: boolean) => void }) {
  const t = useT()
  return (
    <Modal
      open
      onClose={onKeep}
      label="§ AG"
      title={t('features.agents.mirror.discard.title')}
      width={640}
      className="agx-discard"
      footer={
        // the safe choice on the right (and on top on a phone), focused
        <div className="agx-editor__foot agx-discard__foot">
          <button type="button" className="btn btn--danger" onClick={() => onDiscard(true)}>
            {t('features.agents.mirror.discard.trash')}
          </button>
          <span className="agx-spacer" />
          <button type="button" className="btn" onClick={() => onDiscard(false)}>
            {t('features.agents.mirror.discard.leave')}
          </button>
          <button type="button" className="btn btn--ink" onClick={onKeep} data-autofocus="">
            {t('features.agents.mirror.discard.keep')}
          </button>
        </div>
      }
    >
      <p className="agx-discard__body">{t('features.agents.mirror.discard.body', { name: made.name, report: made.reportTitle })}</p>
    </Modal>
  )
}
