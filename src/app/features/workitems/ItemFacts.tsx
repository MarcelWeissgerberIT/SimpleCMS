/**
 * ItemFacts — what a change of Claude's does to task blocks, before anyone applies it: one hairline row per task
 * (TASK · NEW / KEPT / CHANGED / REMOVED + its short id, the title, read-only keycap chips: status, due with its
 * reminder, owners, blocked by, related; a changed task: before → after per field), the warnings, and the holds
 * ("WAITS FOR REVIEW · NAMES A PERSON · SETS A REMINDER"). Never clipped (Preflight's ⇧A counts a card as shown only
 * when its body rendered in full); the list wraps and scrolls inside its card. The facts were computed at staging —
 * nothing is settled here.
 */
import { Fragment, type ReactNode } from 'react'
import { useLang, useT } from '../../i18n'
import { dueText, initialsOf, reminderShort, shortItemId } from '../../editor'
import type { ItemFact, ItemRefFact } from './facts'
import type { SettleWarning } from './settle'
import { holdText, type HoldReason } from './holds'
import './items.css'

type Fields = Pick<ItemFact, 'status' | 'due' | 'reminder' | 'people' | 'blockedBy' | 'related'>

const sameRefs = (a: readonly ItemRefFact[], b: readonly ItemRefFact[]) => a.length === b.length && a.every((x, i) => x.itemId === b[i].itemId)
const samePeople = (a: Fields['people'], b: Fields['people']) => a.length === b.length && a.every((x, i) => x.id === b[i].id)

function useWords() {
  const t = useT()
  const lang = useLang()
  const ref = (r: ItemRefFact) => {
    const name = r.title ?? (r.handle ? `#${r.handle}` : shortItemId(r.itemId))
    return r.isNew ? `${name} · ${t('features.workItems.facts.newRef')}` : r.inScope || r.title ? name : `${shortItemId(r.itemId)} · ${t('features.workItems.facts.outside')}`
  }
  return {
    t,
    status: (f: Fields) => t(`editor.workItem.status.${f.status}`),
    due: (f: Fields) => {
      if (!f.due) return null
      const rem = f.reminder ? reminderShort(f.reminder, t) : null
      return `${dueText(f.due, lang)}${rem ? ` · ${rem}` : f.reminder ? ` · ${t('features.workItems.facts.reminder')}` : ''}`
    },
    ref,
  }
}

function Chip({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span className="workitem__chip item-facts__chip" data-chip={kind}>
      {children}
    </span>
  )
}

/** The chips of a task's fields as they are (a new / kept / removed task). */
function FieldChips({ f }: { f: Fields }) {
  const w = useWords()
  const { t } = w
  const due = w.due(f)
  return (
    <span className="item-facts__chips">
      <Chip kind="status">{w.status(f)}</Chip>
      {due && (
        <Chip kind="due">
          <span className="item-facts__k">{t('features.workItems.facts.due')}</span> {due}
        </Chip>
      )}
      {f.people.map((p) => (
        <Chip kind="person" key={p.id}>
          <span className="item-facts__ini" aria-hidden>
            {initialsOf(p.name)}
          </span>
          {p.name}
        </Chip>
      ))}
      {f.blockedBy.length > 0 && (
        <Chip kind="blocked">
          <span className="item-facts__k">{t('features.workItems.facts.blockedBy')}</span> {f.blockedBy.map(w.ref).join(', ')}
        </Chip>
      )}
      {f.related.length > 0 && (
        <Chip kind="related">
          <span className="item-facts__k">{t('features.workItems.facts.related')}</span> {f.related.length}
        </Chip>
      )}
    </span>
  )
}

/** A changed task: per field that changed, before → after. */
function ChangedRows({ f }: { f: ItemFact }) {
  const w = useWords()
  const { t } = w
  const b = f.before!
  const rows: Array<[string, string, string]> = []
  const none = '—'
  if (b.status !== f.status) rows.push([t('features.workItems.facts.status'), w.status(b), w.status(f)])
  if (b.due !== f.due || b.reminder !== f.reminder) rows.push([t('features.workItems.facts.due'), w.due(b) ?? none, w.due(f) ?? none])
  if (!samePeople(b.people, f.people)) rows.push([t('features.workItems.facts.owner'), b.people.map((p) => p.name).join(', ') || none, f.people.map((p) => p.name).join(', ') || none])
  if (!sameRefs(b.blockedBy, f.blockedBy)) rows.push([t('features.workItems.facts.blockedBy'), b.blockedBy.map(w.ref).join(', ') || none, f.blockedBy.map(w.ref).join(', ') || none])
  if (!sameRefs(b.related, f.related)) rows.push([t('features.workItems.facts.related'), b.related.map(w.ref).join(', ') || none, f.related.map(w.ref).join(', ') || none])
  return (
    <dl className="agent-diff item-facts__diff">
      {rows.map(([name, before, after]) => (
        <div key={name} className="agent-diff__row">
          <dt className="agent-diff__name">{name}</dt>
          <dd className="agent-diff__vals">
            <span className="agent-diff__before" data-empty={before === none || undefined}>
              {before}
            </span>
            <span className="agent-diff__arrow" aria-hidden>
              →
            </span>
            <span className="agent-diff__after" data-empty={after === none || undefined}>
              {after}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export interface ItemFactsProps {
  facts: readonly ItemFact[]
  warnings?: readonly SettleWarning[]
  holds?: readonly HoldReason[]
  /** notes written when the change was applied (UI language) */
  notes?: readonly string[]
}

export function ItemFacts({ facts, warnings = [], holds = [], notes = [] }: ItemFactsProps) {
  const t = useT()
  if (!facts.length && !warnings.length && !holds.length && !notes.length) return null
  const tag = (f: ItemFact) => `${t('features.workItems.facts.task')} · ${t(`features.workItems.facts.${f.tag}`)}`
  return (
    <div className="item-facts" data-testid="item-facts">
      {holds.length > 0 && (
        <p className="label item-facts__holds" data-testid="item-facts-holds">
          {t('features.workItems.hold.waits')} · {holdText(holds, t)}
        </p>
      )}
      {facts.length > 0 && (
        <ul className="item-facts__list" role="list">
          {facts.map((f, i) => (
            <li key={`${f.itemId}-${i}`} className="item-facts__row" data-tag={f.tag} data-item={f.itemId || undefined}>
              <span className="label item-facts__tag">
                {tag(f)}
                {f.itemId && <span className="item-facts__id"> · {shortItemId(f.itemId)}</span>}
                {f.handle && <span className="item-facts__id"> · #{f.handle}</span>}
              </span>
              <span className="item-facts__title">{f.title || '—'}</span>
              {f.tag === 'changed' && f.before ? <ChangedRows f={f} /> : <FieldChips f={f} />}
            </li>
          ))}
        </ul>
      )}
      {(warnings.length > 0 || notes.length > 0) && (
        <div className="item-facts__warns">
          {warnings.map((w, i) => (
            <Fragment key={`w${i}`}>
              <p className="label item-facts__warn">
                {t('features.workItems.facts.warn')} · {t(`features.workItems.settle.${w.code}`, { value: w.value ?? '', task: w.task })}
              </p>
            </Fragment>
          ))}
          {notes.map((n, i) => (
            <p key={`n${i}`} className="label item-facts__warn" data-note>
              {t('features.agent.review.notes')} · {n}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
