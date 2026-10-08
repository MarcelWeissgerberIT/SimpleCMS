/**
 * Settings → Claude AI → "One memory": where it lives (open the memory and its log, or set it up),
 * and three switches for this device — use the memory, proposals after AI-terminal tasks, the usage log.
 */
import { useId } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { Led, Switch } from '../../../ui/controls'
import { HelpLink } from '../../../help'
import { ensureMemoryDb, inTeam, logDbId, memoryDbId, memoryReadOnly } from './schema'
import { memorySettings, setMemorySettings } from './settings'
import { openMemoryDb, openMemoryLog } from './open'
import { readMemories } from './read'
import './memory.css'

const tn = (t: ReturnType<typeof useT>, key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

export function MemorySettings() {
  const t = useT()
  const headId = useId()
  const raw = useWorkspace((s) => s.settings.memory)
  const m = memorySettings({ memory: raw })
  // what exists: the memory (its entries) and the log (its rows)
  const dbId = useWorkspace(() => memoryDbId())
  const count = useWorkspace(() => (memoryDbId() ? readMemories().length : 0))
  const logRows = useWorkspace((s) => {
    const id = logDbId()
    return id ? Object.values(s.pages).filter((p) => p.databaseId === id && !p.trashed).length : 0
  })
  const readOnly = memoryReadOnly()
  const proposals = m.explicit ? m.proposals : !!dbId
  const close = () => useUI.getState().closeModal()

  const setup = () => {
    try {
      ensureMemoryDb()
    } catch {
      useUI.getState().toast({ message: t('features.memory.settings.readOnly'), kind: 'error' })
    }
  }

  const rows: Array<{ key: string; label: string; hint: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }> = [
    { key: 'enabled', label: t('features.memory.settings.enabled'), hint: t('features.memory.settings.enabledHint'), on: m.enabled, set: (v) => setMemorySettings({ enabled: v }) },
    { key: 'proposals', label: t('features.memory.settings.proposals'), hint: t('features.memory.settings.proposalsHint'), on: m.enabled && proposals, set: (v) => setMemorySettings({ proposals: v }), disabled: !m.enabled },
    { key: 'log', label: t('features.memory.settings.log'), hint: t('features.memory.settings.logHint'), on: m.log, set: (v) => setMemorySettings({ log: v }) },
  ]

  return (
    <section className="mems" aria-labelledby={headId} data-testid="memory-settings">
      <header className="mems__head">
        <div className="mems__heading">
          <span className="label mems__code">§ {t('features.memory.settings.code')}</span>
          <h4 className="mems__title" id={headId}>
            {t('features.memory.settings.title')}
            <HelpLink id="memory" />
          </h4>
        </div>
      </header>
      <p className="mems__lead">{t('features.memory.settings.lead')}</p>
      <div className="mems__status" role="status">
        <Led state={dbId ? (m.enabled ? 'ok' : 'on') : 'off'} />
        <span className="label">
          {dbId ? `${tn(t, 'features.memory.settings.count', count)} · ${tn(t, 'features.memory.settings.logCount', logRows)}` : t('features.memory.settings.none')}
        </span>
        {dbId ? (
          <>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                close()
                openMemoryDb()
              }}
            >
              {t('features.memory.settings.open')}
            </button>
            {logDbId() && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  close()
                  openMemoryLog()
                }}
              >
                {t('features.memory.settings.openLog')}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn--sm btn--primary" onClick={setup} disabled={readOnly}>
            {t('features.memory.settings.setup')}
          </button>
        )}
      </div>
      <ul className="mems__rows">
        {rows.map((r) => (
          <li key={r.key} className="mems__row">
            <span className="mems__row-text">
              <span className="mems__row-k">{r.label}</span>
              <span className="mems__row-hint">{r.hint}</span>
            </span>
            <Switch seed={r.key} checked={r.on} onChange={r.set} label={r.label} disabled={r.disabled} />
          </li>
        ))}
      </ul>
      <p className="mems__note">{readOnly ? t('features.memory.settings.readOnly') : inTeam() ? t('features.memory.settings.private') : ''}</p>
    </section>
  )
}
