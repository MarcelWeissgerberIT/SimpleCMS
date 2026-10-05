/**
 * The preview of "Transform into …" inside the AI panel: the strip of forms (←/→ in the prompt), Auto's pick and
 * why, the result as it will be — the real blocks (Mermaid drawn, the chart rendered, columns / tabs / toggles /
 * cards as blocks) or the database preview of "Turn into database" — small options per form, what will not
 * carry over, and "Keep the original below". Everything here only changes the run's state; nothing is written
 * before Transform.
 */
import { useId, useMemo, type ReactNode } from 'react'
import { Switch } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { ReadOnlyDoc } from '../../../editor'
import { TodbPreview } from '../todb/TodbPreview'
import type { TableDraft } from '../todb/plan'
import { resultBlocks } from './build'
import { TRANSFORM_ICONS, typeLabel } from './forms'
import { directionOf } from './mermaid'
import {
  COLUMN_COUNTS,
  DIAGRAM_KINDS,
  resultKey,
  shownResult,
  TRANSFORM_CHART_KINDS,
  type BlockResult,
  type Direction,
  type DiagramPick,
  type TransformIssue,
  type TransformOpts,
  type TransformState,
  type TransformType,
} from './types'
import './transform.css'

export interface TransformPreviewProps {
  state: TransformState | null
  /** the forms of the strip (those that may go where the blocks are) */
  forms: TransformType[]
  /** the form being asked while the run works (null: Auto is choosing) */
  asking: TransformType | null
  busy: boolean
  /** the wait line while Claude works */
  wait: string | null
  issue: TransformIssue | null
  onPick: (type: TransformType) => void
  onOpts: (patch: Partial<TransformOpts>) => void
  onDraft: (draft: TableDraft) => void
  /** Enter in the database title field */
  onApply: () => void
}

export const ISSUE_CODES: Record<TransformIssue, string> = { diagram: 'DIAGRAM_PARSE', nodates: 'NO_DATES', nonumbers: 'NO_NUMBERS', few: 'TOO_FEW', fit: 'DOES_NOT_FIT', bad: 'BAD_ANSWER' }

export function TransformPreview({ state, forms, asking, busy, wait, issue, onPick, onOpts, onDraft, onApply }: TransformPreviewProps) {
  const t = useT()
  const res = busy ? null : shownResult(state)
  const shown = busy ? asking : (state?.shown ?? asking)
  const auto = state?.auto ?? null

  return (
    <div className="trf" role="group" aria-label={t('features.ai.transform.preview')} data-testid="transform-preview">
      <div className="trf__forms" role="group" aria-label={t('features.ai.transform.forms')} data-testid="transform-forms">
        {forms.map((f) => {
          const Icon = TRANSFORM_ICONS[f]
          const cached = !!state && !!state.results[resultKey(f, state.opts)]
          return (
            <button
              key={f}
              type="button"
              className="trf__form"
              aria-pressed={shown === f}
              data-cached={cached || undefined}
              data-form={f}
              disabled={busy}
              title={t(`features.ai.transform.hint.${f}`)}
              onClick={() => onPick(f)}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden />
              <span>{typeLabel(f)}</span>
              {auto?.type === f && <span className="trf__auto-tag">{t('features.ai.transform.autoTag')}</span>}
            </button>
          )
        })}
      </div>

      {auto && (
        <p className="trf__why" data-testid="transform-auto">
          <span className="trf__why-k label">{t('features.ai.transform.autoLine', { type: typeLabel(auto.type) })}</span>
          {auto.reason && <span className="trf__why-v">{auto.reason}</span>}
        </p>
      )}

      {busy && wait && (
        <div className="trf__wait ai-wait label" data-testid="transform-wait">
          {wait}
          <span className="ai-wait__dots" aria-hidden />
        </div>
      )}

      {!busy && issue && (
        <div className="ai-error trf__err" role="alert" data-testid="transform-error">
          <span className="ai-error__code label">ERR · {ISSUE_CODES[issue]}</span>
          <p>{t(`features.ai.transform.err.${issue}`)}</p>
        </div>
      )}

      {res && state && (
        <>
          {res.type === 'db' ? (
            <div className="trf__db">
              <TodbPreview plan={res.table.plan} draft={res.table.draft} onDraft={onDraft} gists={res.table.gists} onConvert={onApply} views={[]} />
            </div>
          ) : (
            <BlockPreview res={res} state={state} onOpts={onOpts} />
          )}
          <label className="trf__keep" data-testid="transform-keep">
            <Switch checked={state.opts.keepOriginal} onChange={(v) => onOpts({ keepOriginal: v })} label={t('features.ai.transform.opt.keep')} />
            <span className="trf__keep-label" aria-hidden>
              {t('features.ai.transform.opt.keep')}
            </span>
          </label>
        </>
      )}
    </div>
  )
}

/** A block result: spec line, its options, the blocks as they will be, what does not carry over. */
function BlockPreview({ res, state, onOpts }: { res: BlockResult; state: TransformState; onOpts: (patch: Partial<TransformOpts>) => void }) {
  const t = useT()
  const ids = useId()
  const opts = state.opts
  const doc = useMemo(() => ({ type: 'doc', content: resultBlocks(res, opts) }), [res, opts])
  const stays = res.keep.length + res.left.length
  const staysText = stays === 0 ? t('features.ai.transform.spec.staysNone') : stays === 1 ? t('features.ai.transform.spec.staysOne') : t('features.ai.transform.spec.stays', { n: stays })

  let spec: string[] = []
  let options: ReactNode = null
  if (res.type === 'diagram') {
    const flow = res.diagram === 'flowchart' || res.diagram === 'org'
    const dir: Direction = opts.direction ?? directionOf(res.code) ?? 'TD'
    spec = [t(`features.ai.transform.diagram.${res.diagram}`), ...(flow ? [t(`features.ai.transform.dir.${dir}`)] : []), ...(res.repaired ? [t('features.ai.transform.spec.repaired')] : []), staysText]
    options = (
      <>
        <div className="trf__opt">
          <label className="trf__label label" htmlFor={`${ids}-kind`}>
            {t('features.ai.transform.opt.kind')}
          </label>
          <select id={`${ids}-kind`} className="input trf__select" value={opts.diagram} onChange={(e) => onOpts({ diagram: e.target.value as DiagramPick })} data-testid="transform-diagram-kind">
            {(['auto', ...DIAGRAM_KINDS] as const).map((k) => (
              <option key={k} value={k}>
                {t(`features.ai.transform.diagram.${k}`)}
              </option>
            ))}
          </select>
        </div>
        {flow && (
          <Seg
            label={t('features.ai.transform.opt.direction')}
            value={dir}
            items={(['TD', 'LR'] as const).map((d) => ({ value: d, label: t(`features.ai.transform.dir.${d}`) }))}
            onChange={(d) => onOpts({ direction: d })}
            testId="transform-direction"
          />
        )}
      </>
    )
  } else if (res.type === 'chart') {
    const kind = opts.chart ?? res.chart.kind
    spec = [t(`charts.kind.${kind}`), t('features.ai.transform.spec.chart', { labels: res.chart.labels.length, series: res.chart.series.length }), ...(res.chart.unit ? [res.chart.unit] : []), staysText]
    options = (
      <Seg label={t('features.ai.transform.opt.kind')} value={kind} items={TRANSFORM_CHART_KINDS.map((k) => ({ value: k, label: t(`charts.kind.${k}`) }))} onChange={(k) => onOpts({ chart: k })} testId="transform-chart-kind" />
    )
  } else {
    const n = res.sections.length
    const count =
      res.of === 'columns'
        ? t('features.ai.transform.spec.columns', { n })
        : res.of === 'tabs'
          ? t('features.ai.transform.spec.tabs', { n })
          : n === 1
            ? t(`features.ai.transform.spec.${res.of}One`)
            : t(`features.ai.transform.spec.${res.of}`, { n })
    spec = [count, staysText]
    if (res.of === 'columns')
      options = (
        <Seg
          label={t('features.ai.transform.opt.columns')}
          value={opts.columns ?? 0}
          items={[{ value: 0, label: t('features.ai.transform.opt.auto') }, ...COLUMN_COUNTS.map((c) => ({ value: c, label: String(c) }))]}
          onChange={(c) => onOpts({ columns: c || null })}
          testId="transform-columns"
        />
      )
  }

  const kept = res.keep.filter((i) => i < res.gists.length).map((i) => res.gists[i])
  const dropped = res.type === 'chart' ? res.dropped : []
  return (
    <>
      <div className="trf__spec label" data-testid="transform-spec">
        {spec.join(' · ')}
      </div>
      {options && <div className="trf__opts">{options}</div>}
      <div className="trf__plate" data-testid="transform-plate" data-form={res.type === 'sections' ? res.of : res.type}>
        <ReadOnlyDoc content={doc} className="trf__doc" />
      </div>
      <div className="trf__left">
        <span className="trf__label label">{t('features.ai.transform.left.title')}</span>
        {kept.length || res.left.length || dropped.length ? (
          <ul className="trf__left-list" data-testid="transform-left">
            {kept.map((g, i) => (
              <li key={`k${i}`}>
                <span className="trf__mark" aria-hidden>
                  ¶
                </span>
                <span className="trf__left-text">{g || t('features.ai.transform.left.nonText')}</span>
                <span className="trf__left-why label">{t('features.ai.transform.left.kept')}</span>
              </li>
            ))}
            {res.left.map((l, i) => (
              <li key={`l${i}`}>
                <span className="trf__mark" aria-hidden>
                  ↳
                </span>
                <span className="trf__left-text">{l}</span>
                <span className="trf__left-why label">{t('features.ai.transform.left.below')}</span>
              </li>
            ))}
            {dropped.map((d, i) => (
              <li key={`d${i}`} data-dropped="">
                <span className="trf__mark" aria-hidden>
                  ×
                </span>
                <span className="trf__left-text">{d}</span>
                <span className="trf__left-why label">{t('features.ai.transform.left.dropped')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="trf__none">{t('features.ai.transform.left.none')}</p>
        )}
      </div>
    </>
  )
}

/** A labelled segmented switch (the todb look). */
function Seg<V extends string | number>({ label, value, items, onChange, testId }: { label: string; value: V; items: { value: V; label: string }[]; onChange: (v: V) => void; testId?: string }) {
  const ids = useId()
  return (
    <div className="trf__opt">
      <span className="trf__label label" id={ids}>
        {label}
      </span>
      <div className="todb__seg" role="group" aria-labelledby={ids} data-testid={testId}>
        {items.map((it) => (
          <button key={String(it.value)} type="button" className="todb__seg-btn trf__seg-btn" aria-pressed={value === it.value} onClick={() => onChange(it.value)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}
