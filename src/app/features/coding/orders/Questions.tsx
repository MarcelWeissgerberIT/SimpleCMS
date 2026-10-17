/**
 * Work orders — the planner's questions on the plate (spec §1.5 "Rückfrage"): each question its own answer field; ↵ (in
 * a field, or the key) writes the answers under "Antworten" into the request as the person's write and plans again
 * (planner.ts answerQuestions — after an edited plan it asks first: planning again replaces it). A refusal says why the
 * planner made no plan. The fields are the person's typing: the plate's single-letter keys never act in them.
 */
import { useEffect, useState } from 'react'
import type { ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import type { OrderDraft } from './types'

const O = 'features.coding.order'

export function QuestionsForm({ rowId, draft, onOutcome, autoFocus }: { rowId: ID; draft: OrderDraft; onOutcome?: (kind: string) => void; autoFocus?: boolean }) {
  const t = useT()
  const questions = draft.plan.questions
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setAnswers(questions.map(() => '')), [draft.run]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    const given = questions.map((q, i) => ({ q, a: answers[i] ?? '' })).filter((x) => x.a.trim())
    if (!given.length) return setError(t(`${O}.questions.none`))
    setError(null)
    const go = async () => {
      setBusy(true)
      const out = await import('./planner').then((m) => m.answerQuestions(rowId, given))
      setBusy(false)
      onOutcome?.(out?.kind ?? 'none')
    }
    if (!draft.edited) return void go()
    useUI.getState().openModal({ type: 'confirm', title: t('features.coding.order.planner.why.edited'), body: t(`${O}.ask.replan.body`), confirmLabel: t(`${O}.questions.send`), onConfirm: () => void go() })
  }
  return (
    <form
      className="orc-questions"
      aria-label={t(`${O}.questions.title`)}
      data-testid="order-questions"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {draft.plan.refused && (
        <p className="orc-line orc-line--warn" data-testid="order-refused">
          {t(`${O}.questions.refused`, { why: draft.plan.refused })}
        </p>
      )}
      {questions.map((q, i) => (
        <label key={i} className="orc-question">
          <span className="orc-question__q">{q}</span>
          <input
            className="input"
            value={answers[i] ?? ''}
            autoFocus={autoFocus && i === 0}
            placeholder={t(`${O}.questions.answer`)}
            maxLength={2000}
            onChange={(e) => setAnswers((a) => a.map((x, k) => (k === i ? e.target.value : x)))}
            data-testid="order-answer"
          />
        </label>
      ))}
      {error && (
        <p className="orc-line orc-line--warn" role="alert">
          {error}
        </p>
      )}
      {questions.length > 0 && (
        <div className="orp-keys">
          <button type="submit" className="btn btn--sm btn--primary" disabled={busy} data-testid="order-answer-send">
            <span className="kbd" aria-hidden>
              ↵
            </span>
            {t(`${O}.questions.send`)}
          </button>
        </div>
      )}
    </form>
  )
}
