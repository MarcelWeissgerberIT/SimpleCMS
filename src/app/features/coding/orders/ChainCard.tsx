/**
 * The chain's card on the plate (spec §1.7, §2.10 outcome 2 — B7; B8 draws the full stations): the chain waits before
 * step n+1 and says why, one line per reason — "Analyse fertig → 02 Coding ‹Titel›" (the analysis checkpoint), "Schritt
 * 01 wurde von ‹Writer› auf Fertig gesetzt — weiter?" (no evidence), "Pipeline geändert seit Bestätigung: …", "Seite …
 * hat sich seit der Bestätigung geändert", "Schritt 02 wurde von ‹Agent› geändert" (the Confirm wait), "Die Grundlage
 * aus Schritt 01 enthält Text von ‹…›" (an outside write in the step it copies). Before its key it shows what goes
 * along: step n+1's text as it will run, the Grundlage it gets, the text of every page that changed. ↵ passes a changed
 * page or Grundlage only as the card rendered it — their fingerprints go with the press (a newer write asks again).
 *
 * Keys (VON HAND where they let the worker start something — a fresh press ≥ 300 ms after the key became ready, never a
 * plate-wide Enter): ↵ Weiter (passes exactly the reasons shown) · for the Confirm wait ↵ Bestätigen und weiter (the
 * version the card rendered) · E Anpassen (the step's page) · R Ab hier neu planen (after an analysis) · H Anhalten.
 */
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { docToMarkdown } from '../../../editor'
import { navigate } from '../../../lib/router'
import { useT } from '../../../i18n'
import { agentLabel } from '../../agents/label'
import { taskVersionView, type TaskVersionView } from '../terminal'
import type { ChainMove, ChainPassable } from '../chain'
import { basisPreview } from './chainRun'
import { basisText } from './basis'
import { pageShown, shownFp, textFp } from './fingerprint'
import { stepNo } from './words'
import { HandKey } from './HandKey'
import type { ChainKeyOutcome } from './chainKeys'
import type { OrderChain, OrderDoneBy } from './types'

type Card = Extract<ChainMove, { kind: 'card' }>
type Tr = ReturnType<typeof useT>

const O = 'features.coding.order'
const BY_KINDS = new Set(['you', 'agent', 'mcp', 'automation', 'script', 'sync', 'import', 'template', 'history', 'member', 'remote', 'order', 'unknown'])

/** Who moved a step to done, in words ("an agent", "a team member" …). */
export function byText(by: OrderDoneBy | null | undefined, t: Tr): string {
  if (!by) return t(`${O}.by.unknown`)
  return t(`${O}.by.${BY_KINDS.has(by.kind) ? by.kind : 'other'}`)
}

/** The refusal of a chain key, in words. */
export const keyWhyText = (out: ChainKeyOutcome, t: Tr): string | null => (out.ok ? null : t(`${O}.keyWhy.${out.why}`))

export default function ChainCard({ rowId, chain, move, viewer, onOutcome }: { rowId: ID; chain: OrderChain; move: Card; viewer: boolean; onOutcome: (o: ChainKeyOutcome) => void }) {
  const t = useT()
  const step = chain.steps.find((s) => s.n === move.step)
  const page = useWorkspace((s) => (step ? s.pages[step.id] : undefined))
  const prev = move.from !== null ? chain.steps.find((s) => s.n === move.from) : undefined
  const prevPage = useWorkspace((s) => (prev ? s.pages[prev.id] : chain.basis ? s.pages[chain.basis.id] : undefined))
  // the pages a ref card names (their titles) — only those
  const refPages = useWorkspace(useShallow((s) => (move.refs ?? []).map((id) => s.pages[id])))
  const [pending, setPending] = useState(false)
  const confirm = move.all.includes('confirm')
  // the Confirm wait: exactly the version this card renders is what ↵ confirms
  const [view, setView] = useState<TaskVersionView | null>(null)
  useEffect(() => {
    let live = true
    if (!confirm || !step) return setView(null)
    void taskVersionView(step.id).then((v) => live && setView(v))
    return () => {
      live = false
    }
  }, [confirm, step, page])
  const basis = useMemo(() => basisPreview(chain, move.step), [chain, move.step, prevPage]) // eslint-disable-line react-hooks/exhaustive-deps
  const basisShown = useMemo(() => (basis ? basisText(basis) : ''), [basis])
  // the changed pages exactly as rendered here — what ↵ pins (their fingerprints)
  const refKey = (move.refs ?? []).join(' ')
  const refShown = useMemo(() => (refKey ? refKey.split(' ') : []).map((id, i) => ({ id, ...pageShown(refPages[i]) })), [refKey, refPages])
  const [seen, setSeen] = useState<{ refs: Record<ID, string>; basis?: string } | null>(null)
  const wantBasis = move.all.includes('basis')
  const needsSeen = move.all.includes('ref') || wantBasis
  useEffect(() => {
    let live = true
    setSeen(null)
    void (async () => {
      const refs: Record<ID, string> = {}
      for (const r of refShown) refs[r.id] = await shownFp({ title: r.title, text: r.text })
      const b = wantBasis ? await textFp(basisShown) : undefined
      if (live) setSeen({ refs, ...(b !== undefined ? { basis: b } : {}) })
    })()
    return () => {
      live = false
    }
  }, [refShown, basisShown, wantBasis])
  if (!step) return null
  const title = page?.title.trim() || step.title || t('common.untitled')
  const kind = t(`${O}.kind.${step.kind}`)
  const passes = move.all.filter((w): w is ChainPassable => w !== 'confirm')
  const text = confirm ? (view?.markdown ?? '') : page ? docToMarkdown(page.content) : ''

  const lines = move.all.map((why) => {
    switch (why) {
      case 'checkpoint':
        return t(`${O}.card.checkpoint`, { n: stepNo(move.step), kind, title })
      case 'evidence':
        return move.by ? t(`${O}.why.doneBy`, { n: stepNo(move.from ?? move.step - 1), writer: byText(move.by, t) }) : t(`${O}.why.doneByNone`, { n: stepNo(move.from ?? move.step - 1) })
      case 'drift':
        return t(`${O}.why.drift`, { what: (move.drift ?? []).map((d) => t(`${O}.drift.${d}`)).join(' · ') })
      case 'ref':
        return refPages.map((p) => t(`${O}.why.refChanged`, { title: !p || p.private ? t('common.untitled') : p.title.trim() || t('common.untitled') })).join(' · ')
      case 'basis':
        return t(`${O}.why.basisForeign`, { n: stepNo(move.from ?? move.step - 1) })
      case 'confirm':
        return t(`${O}.why.changedBy`, { n: stepNo(move.step), agent: agentLabel(move.agent ?? null) ?? t(`${O}.by.other`) })
    }
  })

  const run = (fn: () => Promise<ChainKeyOutcome>) => async () => {
    if (pending) return
    setPending(true)
    try {
      onOutcome(await import('./chainKeys').then(() => fn()))
    } finally {
      setPending(false)
    }
  }
  const shown = seen ?? {}
  const go = run(() => import('./chainKeys').then((m) => (confirm ? m.confirmAndGo(rowId, move.step, view?.hash ?? '', passes, shown) : m.advanceChain(rowId, move.step, passes, shown))))
  const replan = run(() => import('./chainKeys').then((m) => m.replanFrom(rowId, move.from ?? move.step - 1)))
  const halt = run(() => import('./chainKeys').then((m) => m.haltChain(rowId)))

  return (
    <div className="orc-card" role="group" aria-label={t(`${O}.card.label`, { n: stepNo(move.step) })} data-testid="order-chain-card" data-why={move.why} data-all={move.all.join(' ')}>
      {lines.map((line, i) => (
        <p key={i} className="orc-line orc-line--warn orc-card__why" data-testid="order-card-why">
          {line}
        </p>
      ))}
      <p className="label orc-card__next">{t(`${O}.plan.next`, { n: stepNo(move.step), kind, title })}</p>
      {/* what goes along: the step as it will run, its Grundlage */}
      <details className="orc-card__fold" data-testid="order-card-step">
        <summary className="label">{t(`${O}.card.text`)}</summary>
        <pre className="orc-card__text">{text || '—'}</pre>
      </details>
      {basis && (
        <details className="orc-card__fold" data-testid="order-card-basis" open={move.all.includes('basis') || undefined}>
          <summary className="label">{t(`${O}.card.basis`)}</summary>
          <pre className="orc-card__text">{basisShown}</pre>
        </details>
      )}
      {/* the pages that changed, as they go along — exactly this is what ↵ pins */}
      {refShown.map((r) => (
        <details key={r.id} className="orc-card__fold" data-testid="order-card-ref" data-ref={r.id} open>
          <summary className="label">{t(`${O}.card.ref`, { title: r.title || t('common.untitled') })}</summary>
          <pre className="orc-card__text">{r.text || '—'}</pre>
        </details>
      ))}
      {!viewer && (
        <div className="orp-keys">
          <HandKey ready={!pending && (!confirm || !!view) && (!needsSeen || !!seen)} reason={(confirm && !view) || (needsSeen && !seen) ? t(`${O}.key.readying`) : undefined} onPress={() => void go()} primary testId="order-card-go">
            <span className="kbd" aria-hidden>
              ↵
            </span>
            {t(confirm ? `${O}.key.confirmGo` : `${O}.key.next`)}
          </HandKey>
          <button type="button" className="btn btn--sm" onClick={() => navigate({ name: 'page', id: step.id })} data-testid="order-card-adjust">
            <span className="kbd" aria-hidden>
              E
            </span>
            {t(`${O}.key.adjust`)}
          </button>
          {move.all.includes('checkpoint') && (
            <button type="button" className="btn btn--sm" onClick={() => void replan()} data-testid="order-card-replan">
              <span className="kbd" aria-hidden>
                R
              </span>
              {t(`${O}.key.replanHere`)}
            </button>
          )}
          <button type="button" className="btn btn--sm" onClick={() => void halt()} data-testid="order-card-halt">
            <span className="kbd" aria-hidden>
              H
            </span>
            {t(`${O}.key.halt`)}
          </button>
        </div>
      )}
    </div>
  )
}
