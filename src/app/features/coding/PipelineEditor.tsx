/**
 * The pipeline editor: the stages of the Coding database (= the options of its Stage select) — name, kind,
 * whether the worker takes tasks there by itself, Claude Code's permission mode and turns, the git action,
 * the stage that follows, the stage's instructions; add, reorder, remove. A locked database shows them
 * read-only. Saved with savePipeline (options + Database.pipeline together).
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Switch } from '../../ui/controls'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ColorName, PipelineStage, SelectOption } from '../../store/types'
import { newId } from '../../lib/ids'
import { useT } from '../../i18n'
import { GIT_ACTIONS, PERMISSION_MODES, STAGE_KINDS, type StageKind } from './protocol'
import { DOC_OUTPUTS, KIND_TEMPLATES, kindOfDb, readPipeline, savePipeline, templatePipeline, type PipelineTemplate } from './schema'
import { keepTrust } from './trust'
import { allTasks } from './tasks'

interface Draft {
  option: SelectOption
  stage: PipelineStage
}

const COLOR: Record<StageKind, ColorName> = { queue: 'gray', import: 'red', analyze: 'yellow', plan: 'blue', doc: 'pink', gate: 'orange', implement: 'purple', test: 'yellow', git: 'brown', done: 'green' }

export function PipelineEditor({ dbId, locked, onClose }: { dbId: string; locked: boolean; onClose: () => void }) {
  const t = useT()
  const db = useWorkspace((s) => s.databases[dbId])
  const initial = useMemo<Draft[]>(() => readPipeline(db).map(({ name, color, index: _i, ...stage }) => ({ option: { id: stage.id, name, color }, stage })), [db])
  const [rows, setRows] = useState<Draft[]>(initial)
  const [open, setOpen] = useState<string | null>(null)
  const ro = locked
  const kind = kindOfDb(dbId) ?? 'coding'

  const patch = (i: number, p: Partial<PipelineStage>, name?: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { option: name === undefined ? r.option : { ...r.option, name }, stage: { ...r.stage, ...p } } : r)))
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  const add = () => {
    const id = newId()
    setRows((rs) => [...rs, { option: { id, name: t('features.coding.pipeline.newStage'), color: 'gray' }, stage: { id, kind: 'queue', auto: false } }])
    setOpen(id)
  }
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i))
  // a template replaces the draft (nothing is saved until Save); stages of the same kind keep their ids
  const useTemplate = (which: PipelineTemplate) => {
    setRows((rs) => templatePipeline(which, rs.map((r) => ({ id: r.stage.id, kind: r.stage.kind }))))
    setOpen(null)
  }
  const ok = rows.length > 0 && rows.every((r) => r.option.name.trim())

  const save = async () => {
    const clean = rows.map((r) => ({ option: { ...r.option, name: r.option.name.trim().slice(0, 60), color: r.option.color ?? COLOR[r.stage.kind] }, stage: r.stage }))
    let saved = false
    // a pipeline edited on this device keeps this device's confirmed tasks confirmed
    await keepTrust(
      allTasks().map((x) => x.row.id),
      () => {
        saved = savePipeline(dbId, clean)
      },
    )
    useUI.getState().toast({ message: saved ? t('features.coding.pipeline.saved') : t('features.coding.pipeline.locked'), kind: saved ? 'success' : 'error' })
    if (saved) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      label="§ CD — PIPELINE"
      title={t('features.coding.pipeline.title')}
      width={760}
      footer={
        ro ? (
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={add}>
              <Plus size={14} strokeWidth={1.8} aria-hidden /> {t('features.coding.pipeline.add')}
            </button>
            <span className="cpe-spacer" />
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--primary" disabled={!ok} onClick={() => void save()} data-testid="coding-pipeline-save">
              {t('common.save')}
            </button>
          </>
        )
      }
    >
      {ro && <p className="cpe-note">{t('features.coding.pipeline.lockedNote')}</p>}
      <p className="cpe-lead">{t('features.coding.pipeline.lead')}</p>
      {!ro && (
        <div className="cpe-templates" role="group" aria-label={t('features.coding.template.label')}>
          <span className="label">{t('features.coding.template.label')}</span>
          {[...KIND_TEMPLATES[kind]]
            .sort((a, b) => Number(a === 'standard') - Number(b === 'standard'))
            .map((w) => (
              <button key={w} type="button" className={w === 'standard' ? 'btn btn--sm btn--ghost' : 'btn btn--sm'} onClick={() => useTemplate(w)} data-testid={`coding-template-${w}`} title={t(`features.coding.template.${w}Hint`)}>
                {t(`features.coding.template.${w}`)}
              </button>
            ))}
        </div>
      )}
      <ol className="cpe" data-testid="coding-pipeline">
        {rows.map((r, i) => {
          const s = r.stage
          const expanded = open === s.id
          const claude = s.kind === 'plan' || s.kind === 'implement' || s.kind === 'doc'
          return (
            <li key={s.id} className="cpe-row" data-kind={s.kind}>
              <div className="cpe-main">
                <span className="cpe-n label">ST-{String(i + 1).padStart(2, '0')}</span>
                <input className="input cpe-name" value={r.option.name} onChange={(e) => patch(i, {}, e.target.value)} disabled={ro} aria-label={t('features.coding.pipeline.name')} maxLength={60} />
                <select className="input cpe-kind" value={s.kind} disabled={ro} aria-label={t('features.coding.pipeline.kind')} onChange={(e) => {
                  const kind = e.target.value as StageKind
                  patch(i, { kind, auto: kind === 'gate' || kind === 'done' || kind === 'import' ? false : s.auto, ...(kind === 'git' && !s.gitAction ? { gitAction: 'pr' as const } : {}), ...(kind !== 'doc' ? { output: undefined } : {}) })
                }}>
                  {STAGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`features.coding.kind.${k}`)}
                    </option>
                  ))}
                </select>
                <span className="cpe-auto">
                  <Switch checked={s.auto} onChange={(v) => patch(i, { auto: v })} disabled={ro || s.kind === 'gate' || s.kind === 'done' || s.kind === 'import'} label={t('features.coding.pipeline.auto')} />
                  <span className="label">{t('features.coding.pipeline.autoShort')}</span>
                </span>
                <span className="cpe-keys">
                  <button type="button" className="icon-btn icon-btn--sm" disabled={ro || i === 0} onClick={() => move(i, -1)} aria-label={t('features.coding.pipeline.up')}>
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" disabled={ro || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('features.coding.pipeline.down')}>
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" disabled={ro || rows.length <= 1} onClick={() => remove(i)} aria-label={t('features.coding.pipeline.remove')}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm cpe-more" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)} aria-label={t('features.coding.pipeline.details')}>
                    <ChevronRight size={14} strokeWidth={1.75} />
                  </button>
                </span>
              </div>
              {expanded && (
                <div className="cpe-detail">
                  <p className="cpe-kindhint">{t(`features.coding.kind.${s.kind}.hint`)}</p>
                  {claude && (
                    <div className="cpe-grid">
                      {s.kind === 'doc' ? (
                        <label>
                          <span className="label">{t('features.coding.pipeline.output')}</span>
                          <select className="input" value={s.output ?? ''} disabled={ro} onChange={(e) => patch(i, { output: (DOC_OUTPUTS as readonly string[]).includes(e.target.value) ? (e.target.value as PipelineStage['output']) : undefined })} data-testid="coding-pipeline-output">
                            <option value="">{t('features.coding.pipeline.output.page')}</option>
                            {DOC_OUTPUTS.map((o) => (
                              <option key={o} value={o}>
                                {t(`features.coding.pipeline.output.${o}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                      <label>
                        <span className="label">{t('features.coding.pipeline.mode')}</span>
                        <select className="input" value={s.kind === 'plan' ? 'plan' : (s.permissionMode ?? 'acceptEdits')} disabled={ro || s.kind === 'plan'} onChange={(e) => patch(i, { permissionMode: e.target.value as PipelineStage['permissionMode'] })}>
                          {PERMISSION_MODES.map((m) => (
                            <option key={m} value={m}>
                              {t(`features.coding.mode.${m}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      )}
                      <label>
                        <span className="label">{t('features.coding.pipeline.turns')}</span>
                        <input className="input" type="number" min={1} max={200} value={s.maxTurns ?? (s.kind === 'plan' ? 20 : 40)} disabled={ro} onChange={(e) => patch(i, { maxTurns: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
                      </label>
                    </div>
                  )}
                  {s.kind === 'git' && (
                    <label className="cpe-grid1">
                      <span className="label">{t('features.coding.pipeline.gitAction')}</span>
                      <select className="input" value={s.gitAction ?? 'pr'} disabled={ro} onChange={(e) => patch(i, { gitAction: e.target.value as PipelineStage['gitAction'] })}>
                        {GIT_ACTIONS.map((a) => (
                          <option key={a} value={a}>
                            {t(`features.coding.gitAction.${a}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="cpe-grid1">
                    <span className="label">{t('features.coding.pipeline.next')}</span>
                    <select className="input" value={s.next ?? ''} disabled={ro} onChange={(e) => patch(i, { next: e.target.value || null })}>
                      <option value="">{t('features.coding.pipeline.nextDefault')}</option>
                      {rows
                        .filter((o) => o.stage.id !== s.id)
                        .map((o) => (
                          <option key={o.stage.id} value={o.stage.id}>
                            {o.option.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {claude && (
                    <label className="cpe-grid1">
                      <span className="label">{t('features.coding.pipeline.instructions')}</span>
                      <textarea className="input cpe-text" rows={4} value={s.instructions ?? ''} disabled={ro} placeholder={t(`features.coding.pipeline.instructionsPh.${s.kind}`)} onChange={(e) => patch(i, { instructions: e.target.value })} />
                    </label>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </Modal>
  )
}
