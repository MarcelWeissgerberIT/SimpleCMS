/**
 * Custom agents — closing the editor of a mirror draft unsaved (Cancel, Esc, ×, the scrim) when the setup created
 * something (mirror.ts `created`): it asks instead of dropping the draft. Keep editing (the safe choice, focused; Esc,
 * × and the scrim mean it too) · Discard the agent, keep what was made · Discard and move what THIS setup made to the
 * trash (toast with Undo). Set up for a database that was there, only a report page made again is named — the
 * database is never offered for the trash. Nothing made: the editor closes without asking (AgentsView).
 */
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { madeKind, type MirrorMade } from './mirror'
import './mirror.css'

export function MirrorDiscard({ made, onKeep, onDiscard }: { made: Pick<MirrorMade, 'name' | 'reportTitle' | 'created' | 'dbId'>; onKeep: () => void; onDiscard: (trash: boolean) => void }) {
  const t = useT()
  // only the report page was made (the database was there): the prompt speaks of that page only
  const k = madeKind(made) === 'both' ? '' : 'Report'
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
            {t(`features.agents.mirror.discard.trash${k}`)}
          </button>
          <span className="agx-spacer" />
          <button type="button" className="btn" onClick={() => onDiscard(false)}>
            {t(`features.agents.mirror.discard.leave${k}`)}
          </button>
          <button type="button" className="btn btn--ink" onClick={onKeep} data-autofocus="">
            {t('features.agents.mirror.discard.keep')}
          </button>
        </div>
      }
    >
      <p className="agx-discard__body" data-testid="agx-discard-body">
        {t(`features.agents.mirror.discard.body${k}`, { name: made.name, report: made.reportTitle })}
      </p>
    </Modal>
  )
}
