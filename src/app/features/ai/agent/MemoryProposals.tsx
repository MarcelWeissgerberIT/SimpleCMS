/**
 * AI terminal — the One memory's proposals in the log ("REMEMBER? · 2"): after a task (Claude proposed
 * them) or from /remember. Nothing is saved without the OK. Keys on an entry: y / Enter save (a
 * near-identical memory: updates it — s saves as new), e edit, n / d dismiss, a all, u undo, j / k move,
 * Esc back to the prompt.
 */
import { useState } from 'react'
import { ExternalLink, Undo2 } from 'lucide-react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { MemoryBodyView, MemoryEdit } from '../memory/MemoryCard'
import { openEntry } from '../memory/open'
import { readMemories } from '../memory/read'
import { dismissProposal, editProposal, saveAllProposals, saveProposal, undoProposal } from './session'
import type { MemCard, MemItem } from './state'
import '../memory/memory.css'

const focusPrompt = () => document.querySelector<HTMLTextAreaElement>('.term-prompt__input')?.focus({ preventScroll: true })

export function MemoryProposals({ card }: { card: MemCard }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const pending = card.items.filter((x) => x.status === 'pending').length
  const at = Math.min(cursor, Math.max(0, card.items.length - 1))
  const headId = `term-mem-${card.id}`

  const focusAt = (i: number) => {
    setCursor(i)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${headId}-list li[data-i="${i}"]`)?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const li = e.target as HTMLElement
    if (!li.dataset?.i || e.metaKey || e.ctrlKey || e.altKey) return
    const item = card.items[at]
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const moves: Record<string, number> = { j: at + 1, ArrowDown: at + 1, k: at - 1, ArrowUp: at - 1, Home: 0, End: card.items.length - 1 }
    if (e.key in moves) {
      handled()
      focusAt(Math.max(0, Math.min(card.items.length - 1, moves[e.key])))
      return
    }
    if (e.key === 'Escape') {
      handled()
      focusPrompt()
      return
    }
    if (!item) return
    const next = () => {
      // on to the next open proposal (or back to the prompt when none is left)
      const i = card.items.findIndex((x, j) => j > at && x.status === 'pending')
      if (i >= 0) focusAt(i)
      else requestAnimationFrame(() => (document.querySelector<HTMLElement>(`#${headId}-list li[data-i="${at}"]`) ?? null)?.focus())
    }
    if (e.key === 'u') {
      handled()
      if (item.status !== 'pending') undoProposal(card.id, item.id)
      return
    }
    if (item.status !== 'pending') return
    if ((e.key === 'y' || e.key === 'Enter') && !readOnly) {
      handled()
      if (saveProposal(card.id, item.id)) next()
    } else if (e.key === 's' && item.dup && !readOnly) {
      handled()
      if (saveProposal(card.id, item.id, true)) next()
    } else if (e.key === 'n' || e.key === 'd') {
      handled()
      dismissProposal(card.id, item.id)
      next()
    } else if (e.key === 'e') {
      handled()
      setEditing(item.id)
    } else if (e.key === 'a' && !readOnly) {
      handled()
      saveAllProposals(card.id)
    }
  }

  return (
    <section className="term-review term-mem" aria-labelledby={headId} data-testid="term-memory" data-state={card.state}>
      {card.input && (
        <div className="term-echo__in">
          <span className="term-mark" aria-hidden>
            ›
          </span>{' '}
          {card.input}
        </div>
      )}
      <div className="term-review__head">
        <h3 id={headId} className="term-review__title">
          {t('features.memory.card.title', { count: card.state === 'loading' ? '…' : card.items.length })}
        </h3>
        <span className="term-review__rule" aria-hidden />
        {pending > 1 && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={readOnly} onClick={() => saveAllProposals(card.id)}>
            {t('features.memory.card.save')} · a
          </button>
        )}
      </div>
      {card.state === 'loading' ? (
        <p className="term-mem__wait">
          <span className="led led--on ai-led--live" aria-hidden /> {t('features.memory.card.loading')}
          <span className="term-wait" aria-hidden />
        </p>
      ) : (
        <>
          <p className="term-review__note">
            {readOnly ? t('features.memory.card.readOnly') : <span className="term-review__keys">{t('features.memory.card.keys')}</span>}
          </p>
          <ol className="term-changes" id={`${headId}-list`} onKeyDown={onKeyDown}>
            {card.items.map((x, i) => (
              <Item
                key={x.id}
                item={x}
                index={i}
                cursor={i === at}
                readOnly={readOnly}
                editing={editing === x.id}
                onFocus={() => setCursor(i)}
                onEdit={() => setEditing(x.id)}
                onEdited={(p) => {
                  if (p) editProposal(card.id, x.id, p)
                  setEditing(null)
                  focusAt(i)
                }}
                cardId={card.id}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

function Item({
  item: x,
  index,
  cursor,
  readOnly,
  editing,
  onFocus,
  onEdit,
  onEdited,
  cardId,
}: {
  item: MemItem
  index: number
  cursor: boolean
  readOnly: boolean
  editing: boolean
  onFocus: () => void
  onEdit: () => void
  onEdited: (p: MemItem['p'] | null) => void
  cardId: string
}) {
  const t = useT()
  const dupText = x.dup && x.status === 'pending' ? (readMemories().find((m) => m.id === x.dup)?.text ?? null) : null
  const label = t('features.memory.card.item', { type: t(`features.memory.type.${x.p.type}`), text: x.p.text })
  return (
    <li className="term-change" data-i={index} data-status={x.status} data-cursor={cursor || undefined} tabIndex={cursor ? 0 : -1} aria-label={label} onFocus={(e) => e.target === e.currentTarget && onFocus()}>
      <div className="term-change__head">
        <span className="term-change__n">#{index + 1}</span>
        <span className="term-change__kind">{t('features.agent.kind.memory')}</span>
        <span className="term-spacer" />
        {x.status === 'pending' ? (
          <span className="term-change__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismissProposal(cardId, x.id)} aria-label={`${t('features.memory.card.dismiss')} #${index + 1}`}>
              {t('features.memory.card.dismiss')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} aria-label={`${t('features.memory.card.edit')} #${index + 1}`}>
              {t('features.memory.card.edit')}
            </button>
            {x.dup && (
              <button type="button" className="btn btn--ghost btn--sm" disabled={readOnly} onClick={() => saveProposal(cardId, x.id, true)}>
                {t('features.memory.card.saveNew')}
              </button>
            )}
            <button type="button" className="btn btn--sm btn--ink" disabled={readOnly} onClick={() => saveProposal(cardId, x.id)} aria-label={`${t(x.dup ? 'features.memory.card.update' : 'features.memory.card.save')} #${index + 1}`}>
              {t(x.dup ? 'features.memory.card.update' : 'features.memory.card.save')}
            </button>
          </span>
        ) : (
          <span className="term-change__actions">
            <span className="term-change__state">
              {x.status !== 'dismissed' && <span className="led led--ok" aria-hidden />} {t(`features.memory.card.${x.status}`)}
            </span>
            {x.rowId && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEntry(x.rowId!)}>
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.memory.card.open')}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => undoProposal(cardId, x.id)}>
              <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.memory.card.undo')}
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <MemoryEdit p={x.p} onSave={(p) => onEdited(p)} onCancel={() => onEdited(null)} />
      ) : (
        <div className="term-mem__item-body">
          <MemoryBodyView p={x.p} dup={dupText ? { text: dupText } : null} />
        </div>
      )}
    </li>
  )
}
