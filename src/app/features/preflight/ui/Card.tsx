/**
 * The current card (§7.7, mock 1): a frame with the lamp's stripe (`article.pf-card`, tabIndex −1 — J / K / A / D / Z
 * focus it), the head (number · kind · source · "replaces n older" · VON HAND), the key and title, the body (the
 * source's own), and the keys of the card recomputed at every render. States: preparing (aria-busy, keys inert), a
 * prepare error ("Read again"), done elsewhere (a tombstone), in work (O and D only), busy, the VON HAND confirm row
 * (only ↵ / Space / a click on its confirm key confirms), the text field of an answer or rework note. On touch: swipe →
 * apply / ← discard, the keys in two rows (A · D · E, then O · Next), digits and R under "More".
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowRight, Bot, ChevronDown, Hand, Layers, TerminalSquare } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { lampSource, type CardAction, type QueueItem } from '../registry'
import { useQueue } from '../queue/state'
import { actionsOf, announce, cancelConfirm, confirmHand, move, runAction, say } from '../queue/run'
import { useSwipe } from '../queue/swipe'
import { markOpened } from '../log'
import { useCoarsePointer } from '../touch'
import { fmtWhen } from '../format'
import { tn } from '../sources/util'
import { builtInBody } from './bodies'
import type { Level } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

/** The prepare of a card: once, when it becomes current (keys inert until it resolves). */
function usePrepare(item: QueueItem): 'loading' | 'ready' | 'error' {
  const state = useQueue((s) => s.prepared[item.id])
  const latest = useRef(item)
  latest.current = item
  useEffect(() => {
    const item = latest.current
    const src = lampSource(item.lamp)?.queue
    if (!src?.prepare) {
      if (state !== 'ready') useQueue.setState((s) => ({ prepared: { ...s.prepared, [item.id]: 'ready' } }))
      return
    }
    if (state) return
    const ctrl = new AbortController()
    useQueue.setState((s) => ({ prepared: { ...s.prepared, [item.id]: 'loading' } }))
    src
      .prepare(item, ctrl.signal)
      .then(
        () => 'ready' as const,
        (e) => {
          console.warn('[one] preflight: a card could not be prepared', e)
          return 'error' as const
        },
      )
      .then((st) => useQueue.setState((s) => ({ prepared: { ...s.prepared, [item.id]: st } })))
    return () => ctrl.abort()
  }, [item.id, state])
  return state ?? 'loading'
}

/** Again (a prepare error, a version that changed): forget the prepared state, the card prepares again. */
export function prepareAgain(id: string): void {
  useQueue.setState((s) => {
    const prepared = { ...s.prepared }
    delete prepared[id]
    const error = { ...s.error }
    delete error[id]
    return { prepared, error }
  })
}

const kbd = (k: string) => (
  <span className="kbd" aria-hidden>
    {k === 'a' || k === 'd' || k === 'e' || k === 'o' || k === 'r' ? k.toUpperCase() : k}
  </span>
)

function KeyButton({ action, item, primary, busy, ghost }: { action: CardAction; item: QueueItem; primary?: boolean; busy: boolean; ghost?: boolean }) {
  const t = useT()
  const blocked = !!action.blocked
  const reason = action.blocked ? say(action.blocked.key, action.blocked.vars) : undefined
  return (
    <button
      type="button"
      className={`btn${primary ? ' btn--primary' : ''}${ghost ? ' btn--ghost' : ''} pf-key`}
      data-key={action.key}
      // never disabled: the focused key keeps focus; a blocked key says why (D3)
      aria-disabled={blocked || busy || undefined}
      aria-keyshortcuts={action.key.toUpperCase()}
      title={reason ?? (action.hand?.length ? `${t('features.preflight.risk.hand')}: ${action.hand.map((w) => t(`features.preflight.risk.why.${w}`)).join(' · ')}` : undefined)}
      onClick={() => {
        if (busy) return
        if (blocked) return announce(reason ?? '')
        runAction(item, action.key)
      }}
    >
      {kbd(action.key)}
      {action.label}
      {action.hand?.length ? <Hand size={12} aria-hidden className="pf-key__hand" /> : null}
      {ghost && <ArrowRight size={14} aria-hidden />}
    </button>
  )
}

/** The VON HAND row: every reason, the confirm key focused (↵ / Space / click), Cancel (Esc). */
function ConfirmRow({ id, reasonsId }: { id: string; reasonsId: string }) {
  const t = useT()
  const c = useQueue((s) => s.confirm)
  const ok = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    ok.current?.focus()
  }, [c?.why.join(',')])
  if (!c || c.id !== id) return null
  return (
    <div className="pf-confirm" role="group" aria-labelledby={reasonsId} data-testid="pf-confirm">
      <p className="pf-confirm__why" id={reasonsId}>
        <span className="pf-hand">
          <Hand size={12} aria-hidden />
          {t('features.preflight.risk.hand')}
        </span>
        {c.why.map((w) => t(`features.preflight.risk.why.${w}`)).join(' · ')}
      </p>
      <div className="pf-confirm__keys">
        <button
          ref={ok}
          type="button"
          className="btn btn--primary pf-key"
          data-testid="pf-confirm-key"
          // only ↵ / Space / a click on this key confirms (a second A does nothing)
          onClick={() => confirmHand()}
        >
          {t('features.preflight.risk.confirm')}
          <span className="kbd" aria-hidden>
            ↵
          </span>
        </button>
        <button type="button" className="btn pf-key" onClick={() => cancelConfirm()}>
          {t('common.cancel')}
          <span className="kbd" aria-hidden>
            Esc
          </span>
        </button>
      </div>
    </div>
  )
}

/** The text field of an answer / a rework note: ↵ sends (⇧↵ a new line), Esc leaves the field first. */
function InputRow({ item, action }: { item: QueueItem; action: CardAction }) {
  const t = useT()
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    ref.current?.focus()
  }, [])
  const send = () => {
    const v = ref.current?.value ?? ''
    if (!v.trim()) return announce(t('features.preflight.err.needsText'))
    runAction(item, action.key, v)
  }
  return (
    <div className="pf-input" data-testid="pf-input">
      <label className="label" htmlFor={`pf-in-${item.id}`}>
        {action.input?.label}
      </label>
      <textarea
        ref={ref}
        id={`pf-in-${item.id}`}
        className="input pf-input__field"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="pf-input__keys">
        <button type="button" className="btn btn--primary btn--sm pf-key" onClick={send}>
          {action.label}
          <span className="kbd" aria-hidden>
            ↵
          </span>
        </button>
        <button type="button" className="btn btn--sm pf-key" onClick={() => useQueue.setState({ input: null })}>
          {t('common.cancel')}
          <span className="kbd" aria-hidden>
            Esc
          </span>
        </button>
      </div>
    </div>
  )
}

const KIND_ICON: Record<string, ReactNode> = {
  proposal: <Bot size={11} aria-hidden />,
  terminal: <TerminalSquare size={11} aria-hidden />,
}

export interface CardProps {
  item: QueueItem
  /** the card's place among the tab's cards at open (1-based) and how many */
  index: number
  total: number
  level: Level
}

export function Card({ item, index, total, level }: CardProps) {
  const t = useT()
  const lang = useLang()
  const coarse = useCoarsePointer()
  const frame = useRef<HTMLElement>(null)
  const prep = usePrepare(item)
  const busy = useQueue((s) => s.busy !== null)
  const busyHere = useQueue((s) => s.busy === item.id)
  const tomb = useQueue((s) => !!s.tombstones[item.id])
  const inWork = useQueue((s) => !!s.inWork[item.id])
  const error = useQueue((s) => s.error[item.id])
  const expanded = useQueue((s) => !!s.expanded[item.id])
  const leaving = useQueue((s) => s.leaving[item.id])
  const inputKey = useQueue((s) => (s.input?.id === item.id ? s.input.key : null))
  const confirming = useQueue((s) => s.confirm?.id === item.id)
  const readOnly = useCloud((s) => !!(s.readOnly || s.outdated))
  // the keys, recomputed with the stores they read (a run patched, a task moved)
  useQueue((s) => s.items[item.lamp])
  const actions = tomb ? [] : actionsOf(item)
  const ready = prep === 'ready'

  // a current card with its body shown is opened and (once prepared) viewed — ⇧A may take it
  useEffect(() => {
    markOpened(item.id)
    if (ready && !tomb) useQueue.setState((s) => (s.viewed[item.id] ? s : { viewed: { ...s.viewed, [item.id]: true } }))
  }, [item.id, ready, tomb])

  const onSwipe = useCallback(
    (dir: 'right' | 'left') => {
      if (dir === 'left') return runAction(item, 'd')
      // → on a VON HAND card opens its confirm row (never applies)
      runAction(item, 'a')
    },
    [item],
  )
  useSwipe(frame, { enabled: coarse && ready && !tomb && !busy, onSwipe })

  const Body = builtInBody(item.kind) ?? lampSource(item.lamp)?.queue?.Body ?? null
  const reasonsId = `pf-why-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const a = actions.find((x) => x.key === 'a')
  const d = actions.find((x) => x.key === 'd')
  const o = actions.find((x) => x.key === 'o')
  const r = actions.find((x) => x.key === 'r')
  const digits = actions.filter((x) => /^[1-9]$/.test(x.key))
  const inputAction = inputKey ? actions.find((x) => x.key === inputKey) : undefined
  const keysBusy = busy || !ready || readOnly
  const sup = item.supersedes ?? []
  // the terminal's body brings its own head (title, where, tags); an agent's rename its struck old title (no title here)
  const ownTitle = item.kind !== 'terminal' && !!item.title
  const kindLabel = t(`features.preflight.card.aria.${item.kind}`, { i: index, n: total })

  return (
    <article
      ref={frame}
      className="pf-card"
      data-id={item.id}
      data-current=""
      data-lamp={item.lamp}
      data-level={level}
      data-kind={item.kind}
      data-hand={item.hand.length ? '' : undefined}
      data-leaving={leaving}
      data-testid="pf-card"
      tabIndex={-1}
      aria-label={kindLabel}
      aria-busy={prep === 'loading' || busyHere || undefined}
    >
      <div className="pf-card__head">
        <span className="pf-card__no">{pad(index)}</span>
        <span className="pf-tag pf-tag--ink">{t(`features.preflight.kind.${item.kind}`)}</span>
        <span className="pf-tag">
          {KIND_ICON[item.kind] ?? null}
          {item.tag}
          {item.refs.runId && item.kind === 'proposal' ? ` · ${t('features.preflight.card.run', { time: fmtWhen(item.at, Date.now(), lang) })}` : ''}
        </span>
        <span className="pf-sp" />
        {sup.length > 0 && (
          <span className="pf-sup">
            <Layers size={13} aria-hidden />
            <span>
              {t('features.preflight.card.supersedes.pre')} <b>{tn('features.preflight.card.supersedes', sup.length)}</b> · {sup.map((s) => fmtWhen(s.at, Date.now(), lang)).join(', ')}
            </span>
          </span>
        )}
        {item.hand.length > 0 && (
          <span className="pf-hand" title={item.hand.map((w) => t(`features.preflight.risk.why.${w}`)).join(' · ')}>
            <Hand size={12} aria-hidden />
            {t('features.preflight.risk.hand')}
          </span>
        )}
      </div>
      <div className="pf-card__title">
        {item.keyText && <span className="pf-card__key">#{item.keyText}</span>}
        {ownTitle && <span className="pf-card__t">{item.title}</span>}
      </div>
      <div className="pf-card__body" data-expanded={expanded || undefined}>
        {tomb ? (
          <p className="pf-card__tomb" role="status">
            {t('features.preflight.card.elsewhere')}
          </p>
        ) : prep === 'error' ? (
          <p className="pf-card__error">
            {t('features.preflight.card.prepareFailed')}{' '}
            <button type="button" className="btn btn--sm" onClick={() => prepareAgain(item.id)}>
              {t('features.preflight.card.again')}
            </button>
          </p>
        ) : Body ? (
          <Suspense fallback={<p className="pf-card__wait">…</p>}>
            <Body item={item} expanded={expanded} />
          </Suspense>
        ) : null}
        {inWork && !tomb && (
          <p className="pf-card__work" role="status">
            {t('features.preflight.card.inWork')}
          </p>
        )}
        {error && !tomb && (
          <p className="pf-card__error" role="alert">
            {say(error)}
            {error === 'features.preflight.err.changed' && (
              <>
                {' '}
                <button type="button" className="btn btn--sm" onClick={() => prepareAgain(item.id)}>
                  {t('features.preflight.card.again')}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {confirming && <ConfirmRow id={item.id} reasonsId={reasonsId} />}
      {inputAction && !confirming && <InputRow item={item} action={inputAction} />}
      {!confirming && !inputAction && (
        <div className="pf-card__keys" data-busy={keysBusy || undefined}>
          {tomb ? (
            <button type="button" className="btn pf-key" onClick={() => move(1)}>
              {kbd('J')}
              {t('features.preflight.queue.next')}
            </button>
          ) : (
            <>
              <div className="pf-card__row">
                {a && <KeyButton action={a} item={item} primary busy={keysBusy} />}
                {d && <KeyButton action={d} item={item} busy={keysBusy} />}
                {Body && (
                  <button type="button" className="btn pf-key" aria-expanded={expanded} aria-keyshortcuts="E" onClick={() => useQueue.setState((s) => ({ expanded: expanded ? omit(s.expanded, item.id) : { ...s.expanded, [item.id]: true } }))}>
                    {kbd('e')}
                    {t('features.preflight.card.diff')}
                    <ChevronDown size={14} aria-hidden className="pf-key__chev" />
                  </button>
                )}
              </div>
              {!coarse && digits.map((x) => <KeyButton key={x.key} action={x} item={item} busy={keysBusy} />)}
              {!coarse && r && <KeyButton action={r} item={item} busy={keysBusy} />}
              <span className="pf-sp" />
              <div className="pf-card__row pf-card__row--2">
                {o && <KeyButton action={o} item={item} ghost busy={busy} />}
                {coarse && (
                  <button type="button" className="btn pf-key" onClick={() => move(1)}>
                    {t('features.preflight.queue.next')}
                  </button>
                )}
              </div>
              {!coarse && (
                <span className="pf-jk">
                  {kbd('J')}
                  {kbd('K')}
                  {t('features.preflight.card.jk')}
                </span>
              )}
              {coarse && (digits.length > 0 || r) && (
                <details className="pf-card__more">
                  <summary className="btn pf-key">{t('features.preflight.card.more')}</summary>
                  <div className="pf-card__row">
                    {digits.map((x) => (
                      <KeyButton key={x.key} action={x} item={item} busy={keysBusy} />
                    ))}
                    {r && <KeyButton action={r} item={item} busy={keysBusy} />}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
      {coarse && !tomb && <p className="pf-card__swipe label">{t('features.preflight.touch.hint')}</p>}
      {readOnly && <p className="pf-card__note">{t('features.preflight.why.readOnly')}</p>}
    </article>
  )
}

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  const out = { ...o }
  delete out[k]
  return out
}
