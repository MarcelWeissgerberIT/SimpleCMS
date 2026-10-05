/**
 * Parts of a staged change's review entry, shared by the AI terminal and the custom agents' run
 * history (features/agents): property diffs, the content preview, the columns of a new database.
 */
import { useT } from '../../../i18n'
import { MarkdownLite } from '../MarkdownLite'
import type { ColumnSpec, PropChange, StagedChange } from './types'

/** Property changes of a staged change (also the custom agents' review, features/agents). */
export function PropDiff({ props }: { props: PropChange[] }) {
  const t = useT()
  return (
    <dl className="agent-diff">
      {props.map((p) => (
        <div key={p.propId} className="agent-diff__row">
          <dt className="agent-diff__name">{p.name}</dt>
          <dd className="agent-diff__vals">
            <span className="agent-diff__before" data-empty={!p.before || undefined}>
              {p.before || '—'}
            </span>
            <span className="agent-diff__arrow" aria-hidden>
              →
            </span>
            <span className="agent-diff__after" data-empty={!p.after || undefined}>
              {p.after || '—'}
            </span>
            {p.newOptions?.length ? <span className="agent-diff__new label">+ {t('features.agent.review.newOption')}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const PREVIEW_LINES = 10

/** Content preview of a staged change (also the custom agents' review, features/agents). */
export function Preview({ markdown, append }: { markdown: string; append: boolean }) {
  const t = useT()
  const lines = markdown.trim().split('\n')
  // never cut inside a code fence or a table: show whole blocks up to the limit
  let end = Math.min(lines.length, PREVIEW_LINES)
  const fences = lines.slice(0, end).filter((l) => /^\s*```/.test(l)).length
  if (fences % 2) {
    const close = lines.findIndex((l, i) => i >= end && /^\s*```/.test(l))
    end = close >= 0 ? close + 1 : lines.length
  }
  const rest = lines.length - end
  return (
    <div className="agent-preview" data-append={append || undefined}>
      {append && <span className="agent-preview__plus mono" aria-hidden>+</span>}
      <MarkdownLite source={lines.slice(0, end).join('\n')} />
      {rest > 0 && <span className="agent-preview__more label">{t('features.agent.review.more', { count: rest })}</span>}
    </div>
  )
}

function ColumnRow({ col, group }: { col: ColumnSpec; group?: boolean }) {
  const t = useT()
  return (
    <div className="agent-diff__row">
      <dt className="agent-diff__name">{col.name}</dt>
      <dd className="agent-diff__vals">
        <span className="agent-diff__after">{t(`features.agent.coltype.${col.type}`)}</span>
        {col.options?.length ? <span className="agent-diff__before" data-empty>{col.options.join(' · ')}</span> : null}
        {group && <span className="agent-diff__new label">{t('features.agent.review.groupedBy')}</span>}
      </dd>
    </div>
  )
}

/** The schema of a staged create_database / the property of an add_property. */
export function SchemaDiff({ change: c }: { change: StagedChange }) {
  const t = useT()
  if (c.kind === 'add_property' && c.prop)
    return (
      <dl className="agent-diff">
        <ColumnRow col={c.prop} />
      </dl>
    )
  if (c.kind !== 'create_database') return null
  return (
    <dl className="agent-diff" data-kind="schema">
      <div className="agent-diff__row">
        <dt className="agent-diff__name">{t('features.agent.review.view')}</dt>
        <dd className="agent-diff__vals">
          <span className="agent-diff__after">{t(`features.agent.view.${c.view === 'board' ? 'board' : 'table'}`)}</span>
        </dd>
      </div>
      {(c.columns ?? []).map((col) => (
        <ColumnRow key={col.id} col={col} group={col.id === c.groupBy} />
      ))}
    </dl>
  )
}
