/**
 * Custom agents — the questions over the editor of a mirror draft (mirror.ts `created`: what the setup made).
 *  - MirrorDiscard: closing it unsaved (Cancel, Esc, ×, the scrim) when the setup created something asks instead of
 *    dropping the draft. Keep editing (the safe choice, focused; Esc, × and the scrim mean it too) · Discard the agent,
 *    keep what was made (the next setup for that name takes the database and its page again) · Discard and move what
 *    THIS setup made to the trash (toast with Undo; a page a saved agent uses by then stays, and the toast says so).
 *    Set up for a database that was there, only the new report page made for it is named — the database is never
 *    offered for the trash. Nothing made: the editor closes without asking (AgentsView).
 *  - MirrorUndoAsk: the note's Undo on a draft that was changed (any field) asks before the changes are lost — Keep
 *    editing (safe, focused; Esc, × and the scrim mean it) · Undo, discard changes. An unchanged draft is undone at once.
 */
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { madeKind, type MirrorMade } from './mirror'
import './mirror.css'

type Made = Pick<MirrorMade, 'name' | 'reportTitle' | 'created' | 'dbId'>

export function MirrorDiscard({ made, onKeep, onDiscard }: { made: Made; onKeep: () => void; onDiscard: (trash: boolean) => void }) {
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

export function MirrorUndoAsk({ made, onKeep, onUndo }: { made: Made; onKeep: () => void; onUndo: () => void }) {
  const t = useT()
  // only the report page was made (the database was there): only that page goes
  const k = madeKind(made) === 'both' ? '' : 'Report'
  return (
    <Modal
      open
      onClose={onKeep}
      label="§ AG"
      title={t('features.agents.mirror.undoAsk.title')}
      width={560}
      className="agx-discard agx-undoask"
      footer={
        <div className="agx-editor__foot agx-discard__foot">
          <button type="button" className="btn btn--danger" onClick={onUndo}>
            {t('features.agents.mirror.undoAsk.undo')}
          </button>
          <span className="agx-spacer" />
          <button type="button" className="btn btn--ink" onClick={onKeep} data-autofocus="">
            {t('features.agents.mirror.discard.keep')}
          </button>
        </div>
      }
    >
      <p className="agx-discard__body" data-testid="agx-undoask-body">
        {t(`features.agents.mirror.undoAsk.body${k}`, { name: made.name, report: made.reportTitle })}
      </p>
    </Modal>
  )
}
