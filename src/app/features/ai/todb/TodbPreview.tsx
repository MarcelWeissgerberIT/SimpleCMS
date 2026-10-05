/**
 * The preview of "Turn into database" inside the AI panel: a spec line, the title, the columns (each
 * with a switch to drop it), Group by + Board | Table, the first entries and what stays as text.
 * Everything here only changes the draft; nothing is written before Convert.
 */
import { useId } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Check } from 'lucide-react'
import { Switch } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { TypeIcon } from '../../../database'
import { blockGist, effectiveView, liveColumns, liveGroup, TITLE_NAME, type CellValue, type PlanColumn, type TableDraft, type TablePlan, type TodbView } from './plan'
import './todb.css'

const SAMPLE = 5

export interface TodbPreviewProps {
  plan: TablePlan
  draft: TableDraft
  onDraft: (draft: TableDraft) => void
  /** the blocks Claude read (for "Kept as text") */
  blocks: PMNode[]
  /** Enter in the title field */
  onConvert: () => void
}

/** "16 ENTRIES · 6 COLUMNS · 2 BLOCKS KEPT" */
export function specLine(t: ReturnType<typeof useT>, plan: TablePlan, draft: TableDraft): string {
  const n = plan.entries.length
  const c = liveColumns(plan, draft).length
  const k = plan.keep.length
  return [
    n === 1 ? t('features.ai.todb.entriesOne') : t('features.ai.todb.entries', { n }),
    c === 1 ? t('features.ai.todb.columnsOne') : t('features.ai.todb.columnsN', { n: c }),
    k === 1 ? t('features.ai.todb.keptOne') : t('features.ai.todb.keptN', { n: k }),
  ].join(' · ')
}

export function TodbPreview({ plan, draft, onDraft, blocks, onConvert }: TodbPreviewProps) {
  const t = useT()
  const ids = useId()
  const cols = liveColumns(plan, draft)
  const selects = cols.filter((c) => c.type === 'select')
  const group = liveGroup(plan, draft)
  const view: TodbView = effectiveView(plan, draft)
  const set = (patch: Partial<TableDraft>) => onDraft({ ...draft, ...patch })

  const toggle = (col: PlanColumn, on: boolean) => {
    const dropped = on ? draft.dropped.filter((n) => n !== col.name) : [...draft.dropped, col.name]
    // the group column switched off: no grouping (a board falls back to the table)
    const groupBy = !on && draft.groupBy === col.name ? null : draft.groupBy
    set({ dropped, groupBy })
  }

  const kept = plan.keep.map((i) => blocks[i]).filter((b): b is PMNode => !!b)
  const rest = plan.entries.length - SAMPLE

  return (
    <div className="todb" role="group" aria-label={t('features.ai.todb.preview')} data-testid="todb-preview">
      <div className="todb__spec label" data-testid="todb-spec">
        {specLine(t, plan, draft)}
      </div>

      <div className="todb__field">
        <label className="todb__label label" htmlFor={`${ids}-title`}>
          {t('features.ai.todb.title')}
        </label>
        <input
          id={`${ids}-title`}
          className="input todb__title"
          value={draft.title}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            onConvert()
          }}
        />
      </div>

      <div className="todb__label label" id={`${ids}-cols`}>
        {t('features.ai.todb.columns')}
      </div>
      <ul className="todb__cols" aria-labelledby={`${ids}-cols`}>
        <li className="todb__col" data-fixed="">
          <span className="todb__ico">
            <TypeIcon type="title" />
          </span>
          <span className="todb__name">{TITLE_NAME}</span>
          <span className="todb__type label">{t('features.ai.todb.entryTitle')}</span>
          <span className="todb__lock" aria-hidden>
            <Check size={12} strokeWidth={2} />
          </span>
        </li>
        {plan.columns.map((c) => {
          const on = !draft.dropped.includes(c.name)
          return (
            <li key={c.name} className="todb__col" data-off={!on || undefined} data-testid="todb-col">
              <span className="todb__ico">
                <TypeIcon type={c.type} />
              </span>
              <span className="todb__name">{c.name}</span>
              <span className="todb__type label">
                {t(`features.ai.todb.type.${c.type}`)}
                {c.options.length > 0 && ` · ${c.options.length}`}
              </span>
              <Switch checked={on} onChange={(v) => toggle(c, v)} label={t('features.ai.todb.keepColumn', { name: c.name })} />
            </li>
          )
        })}
      </ul>

      <div className="todb__opts">
        <div className="todb__opt">
          <label className="todb__label label" htmlFor={`${ids}-group`}>
            {t('features.ai.todb.groupBy')}
          </label>
          <select
            id={`${ids}-group`}
            className="input todb__select"
            value={group?.name ?? ''}
            onChange={(e) => {
              const groupBy = e.target.value || null
              set({ groupBy, view: groupBy ? (draft.groupBy ? draft.view : 'board') : 'table' })
            }}
          >
            <option value="">{t('features.ai.todb.noGroup')}</option>
            {selects.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="todb__opt">
          <span className="todb__label label" id={`${ids}-view`}>
            {t('features.ai.todb.viewLabel')}
          </span>
          <div className="todb__seg" role="group" aria-labelledby={`${ids}-view`}>
            {(['board', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="todb__seg-btn"
                aria-pressed={view === v}
                disabled={v === 'board' && !group}
                title={v === 'board' && !group ? t('features.ai.todb.boardNeedsGroup') : undefined}
                onClick={() => set({ view: v })}
              >
                {t(`features.ai.todb.view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="todb__sample">
        <table className="todb__table" aria-label={t('features.ai.todb.sample')}>
          <thead>
            <tr>
              <th scope="col">{TITLE_NAME}</th>
              {cols.map((c) => (
                <th key={c.name} scope="col">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.entries.slice(0, SAMPLE).map((e, i) => (
              <tr key={i}>
                <td className="todb__cell--title">{e.title || t('common.untitled')}</td>
                {cols.map((c) => (
                  <td key={c.name}>
                    <Cell col={c} value={e.values[c.name]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rest > 0 && <div className="todb__more label">{t('features.ai.todb.more', { n: rest })}</div>}

      <div className="todb__kept">
        <span className="todb__label label">{t('features.ai.todb.kept')}</span>
        {kept.length ? (
          <ul className="todb__kept-list" data-testid="todb-kept">
            {kept.map((b, i) => (
              <li key={i}>
                <span className="todb__pilcrow" aria-hidden>
                  ¶
                </span>
                {blockGist(b) || t('features.ai.todb.nonText')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="todb__none">{t('features.ai.todb.keptNone')}</p>
        )}
      </div>
    </div>
  )
}

function Cell({ col, value }: { col: PlanColumn; value: CellValue | undefined }) {
  if (value === undefined || value === '') return <span className="todb__empty">—</span>
  if (col.type === 'select' || col.type === 'multi_select') {
    const list = Array.isArray(value) ? value : col.type === 'multi_select' ? String(value).split(/,\s*/) : [String(value)]
    return (
      <span className="todb__tags">
        {list.map((v) => (
          <span key={v} className="todb__tag">
            {v}
          </span>
        ))}
      </span>
    )
  }
  if (col.type === 'checkbox') return <>{value === true || /^(true|yes|ja|x|done|erledigt|1)$/i.test(String(value)) ? '✓' : '—'}</>
  return <>{Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? '✓' : '') : String(value)}</>
}
