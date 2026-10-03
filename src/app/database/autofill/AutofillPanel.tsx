/**
 * AI autofill panel for one property: configure (preset, options, updates) → run (meter, cancel)
 * → review (current → proposed, accept / reject per row) → done. One instance at a time, rendered by
 * the first mounted <AutofillHost/> (database views and row pages mount one).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { AutofillConfig, Database, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { autofillOf, canAutofill, defaultConfig } from './config'
import { closeAutofillPanel, jobKey, saveAutofillConfig, startFill, useAutofill, useAutofillHost } from './store'
import { startAutofillWatch } from './watch'
import { ConfigStage } from './ConfigStage'
import { DoneStage, ReviewStage, RunStage } from './stages'
import './autofill.css'

/** Mount point for the panel (and the auto-update watcher). Safe to render more than once. */
export function AutofillHost() {
  const primary = useAutofillHost()
  const panel = useAutofill((s) => s.panel)
  useEffect(() => startAutofillWatch(), [])
  if (!primary || !panel) return null
  return <AutofillPanel key={jobKey(panel.dbId, panel.propId)} dbId={panel.dbId} propId={panel.propId} />
}

function AutofillPanel({ dbId, propId }: { dbId: string; propId: string }) {
  const db = useWorkspace((s) => s.databases[dbId])
  const prop = db?.properties.find((p) => p.id === propId)
  const ok = !!db && !!prop && canAutofill(prop)
  useEffect(() => {
    if (!ok) closeAutofillPanel()
  }, [ok])
  if (!ok) return null
  return <PanelBody db={db} prop={prop} />
}

function PanelBody({ db, prop }: { db: Database; prop: PropertyDef }) {
  const t = useT()
  const key = jobKey(db.id, prop.id)
  const job = useAutofill((s) => s.jobs[key])
  const live = autofillOf(prop)
  const [draft, setDraft] = useState<AutofillConfig>(() => live ?? defaultConfig(prop))
  const dirty = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const commit = useCallback(() => {
    if (!dirty.current) return
    dirty.current = false
    saveAutofillConfig(db.id, prop.id, draftRef.current)
  }, [db.id, prop.id])

  const update = (patch: Partial<AutofillConfig>) => {
    dirty.current = true
    setDraft((d) => ({ ...d, ...patch }))
  }

  const close = () => {
    commit()
    closeAutofillPanel()
  }

  const run = (mode: 'all' | 'empty') => {
    dirty.current = true
    commit()
    void startFill(db.id, prop.id, mode)
  }

  const turnOff = () => {
    dirty.current = false
    saveAutofillConfig(db.id, prop.id, null)
    closeAutofillPanel()
  }

  const turnOn = () => {
    dirty.current = true
    close()
  }

  const cancel = () => {
    dirty.current = false
    closeAutofillPanel()
  }

  const stage = !job ? 'config' : job.phase === 'running' ? 'run' : job.phase === 'review' ? 'review' : 'done'
  const status = !live ? t('database.autofill.status.off') : live.auto ? t('database.autofill.status.auto') : t('database.autofill.status.on')

  return (
    <Modal open onClose={close} bare width={680} className="af" ariaLabel={t('database.autofill.title', { name: prop.name })}>
      <header className="af-head">
        <div className="af-head__bar label">
          <span className={`led${live ? ' led--on' : ''}${stage === 'run' ? ' af-blink' : ''}`} aria-hidden />
          <span>{t('database.autofill.label')}</span>
          <span className="af-head__dim">· {t(`database.type.${prop.type}`)}</span>
          <span className="af-spacer" />
          <span className="af-head__status">{status}</span>
          <button type="button" className="icon-btn af-head__close" onClick={close} aria-label={t('database.autofill.close')}>
            <X size={16} />
          </button>
        </div>
        <h2 className="af-head__title" data-modal-title>
          {prop.name}
        </h2>
      </header>
      {stage === 'config' && <ConfigStage db={db} prop={prop} draft={draft} update={update} onRun={run} on={!!live} onTurnOff={turnOff} onTurnOn={turnOn} onCancel={cancel} onDone={close} />}
      {stage === 'run' && job && <RunStage job={job} prop={prop} />}
      {stage === 'review' && job && <ReviewStage job={job} prop={prop} />}
      {stage === 'done' && job && <DoneStage job={job} onDone={close} />}
    </Modal>
  )
}
