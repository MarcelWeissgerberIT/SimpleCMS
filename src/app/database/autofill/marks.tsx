/**
 * AI autofill — small marks inside the database UI: the "AI" glyph, the header tag of an
 * autofilled property, the per-cell state (queued / running / error) with a "fill this cell"
 * button, and the same for the row page's property panel.
 */
import type { ID, PropertyDef } from '../../store/types'
import { useT } from '../../i18n'
import { Tooltip } from '../../ui/Tooltip'
import { autofillOf } from './config'
import { cellKey, jobKey, startFill, useAutofill } from './store'
import './autofill.css'

/** Mono "AI" keycap used as the menu icon. */
export function AiGlyph() {
  const t = useT()
  return (
    <span className="af-glyph" aria-hidden>
      {t('database.autofill.tag')}
    </span>
  )
}

/** Header tag: "AI" + LED (lit while a run is going or results wait for review). */
export function AutofillTag({ dbId, prop }: { dbId: ID; prop: PropertyDef }) {
  const t = useT()
  const phase = useAutofill((s) => s.jobs[jobKey(dbId, prop.id)]?.phase)
  const cfg = autofillOf(prop)
  if (!cfg) return null
  const state = phase === 'running' ? 'running' : phase === 'review' ? 'review' : cfg.auto ? 'auto' : 'idle'
  const sr = [t('database.autofill.tag.sr'), t(`database.autofill.preset.${cfg.preset}`), state === 'running' ? t('database.autofill.tag.running') : state === 'review' ? t('database.autofill.tag.review') : cfg.auto ? t('database.autofill.tag.auto') : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <span className="af-tag" data-state={state} title={sr}>
      <span aria-hidden>{t('database.autofill.tag')}</span>
      {state !== 'idle' && <span className="af-tag__led" aria-hidden />}
      <span className="visually-hidden">{sr}</span>
    </span>
  )
}

/** Cell overlay: state LED + "fill this cell" button (visible on hover / active cell). */
export function AutofillCellMark({ dbId, prop, rowId }: { dbId: ID; prop: PropertyDef; rowId: ID }) {
  const t = useT()
  const cell = useAutofill((s) => s.cells[cellKey(prop.id, rowId)])
  const busy = cell?.state === 'queued' || cell?.state === 'running'
  return (
    <span className="af-cell" data-state={cell?.state ?? 'idle'} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {cell?.state === 'error' && (
        <Tooltip label={t('database.autofill.cell.error', { msg: cell.message })}>
          <span className="af-cell__led af-cell__led--err" role="img" aria-label={t('database.autofill.cell.error', { msg: cell.message })} />
        </Tooltip>
      )}
      {busy && <span className="af-cell__led" role="img" data-state={cell.state} aria-label={t(`database.autofill.cell.${cell.state}`)} />}
      {!busy && (
        <button type="button" className="af-cell__btn" tabIndex={-1} aria-label={t('database.autofill.cell.fill')} title={`${t('database.autofill.cell.fill')} (Alt+Enter)`} onClick={() => void startFill(dbId, prop.id, 'cell', [rowId])}>
          {t('database.autofill.tag')}
        </button>
      )}
    </span>
  )
}

/** Row page: state + a focusable "fill" button next to the value. */
export function AutofillRowControl({ dbId, prop, rowId }: { dbId: ID; prop: PropertyDef; rowId: ID }) {
  const t = useT()
  const cell = useAutofill((s) => s.cells[cellKey(prop.id, rowId)])
  const busy = cell?.state === 'queued' || cell?.state === 'running'
  const label = cell?.state === 'error' ? t('database.autofill.cell.error', { msg: cell.message }) : busy ? t(`database.autofill.cell.${cell.state}`) : t('database.autofill.cell.fill')
  return (
    <Tooltip label={label}>
      <button type="button" className="af-rowbtn" data-state={cell?.state ?? 'idle'} disabled={busy} aria-label={label} onClick={() => void startFill(dbId, prop.id, 'cell', [rowId])}>
        <span className="af-rowbtn__led" aria-hidden />
        {t('database.autofill.tag')}
      </button>
    </Tooltip>
  )
}
