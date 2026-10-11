/**
 * The hand path's half of the switch plate (slice 1: nothing leaves One): the three steps, the arguments to set by
 * hand there, where "Copy & open" leads (the row's link — a value the mirror wrote: off the server's host it is
 * flagged FOREIGN and needs a tick), and the "Copy & open" key — aria-disabled with the reason until the text is seen,
 * every flagged address ticked and a change acknowledged. After it: "Sent in <server>?" ↵ Yes, mark as sent · Esc Not
 * yet (the slip keeps the focus when the question goes).
 */
import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { useT } from '../../../i18n'
import { MOD } from '../../../ui/controls'
import { hostOf } from '../../../store/integrations'
import { acceptLink, handBlock, linkHome, linkOf } from '../hand'
import { unsent } from '../machine'
import { slipText } from '../text'
import { SENT_AT } from '../template'
import type { Slip } from '../types'
import { ForeignMark, Shown, shownText } from './parts'

/** The arguments a person sets by hand (everything but the text). */
export function handArgs(slip: Slip): string {
  const text = slipText(slip)
  return Object.entries(slip.args)
    .filter(([, v]) => !(typeof v === 'string' && v === text) && v !== SENT_AT)
    .filter(([k]) => k !== Object.keys(slip.args).find((x) => slip.args[x] === slip.target.key))
    .map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ')
}

export function HandPlate({ slip, onCopy }: { slip: Slip; onCopy: () => void }) {
  const t = useT()
  const block = handBlock(slip)
  const why = slip.state === 'missing' ? t('features.outbox.block.missing') : block ? t(`features.outbox.block.${block}`) : null
  const set = handArgs(slip)
  const reason = `obx-why-${slip.id}`
  const link = linkOf(slip)
  return (
    <div className="obx-hand">
      <span className="label obx-hand__title">{t('features.outbox.hand.title')}</span>
      <ol className="obx-hand__steps">
        <li>
          <span className="obx-hand__n">1</span>
          {t('features.outbox.hand.step1')}
        </li>
        <li>
          <span className="obx-hand__n">2</span>
          {t('features.outbox.hand.step2', { server: slip.target.serverName })}
        </li>
        <li>
          <span className="obx-hand__n">3</span>
          {t('features.outbox.hand.step3')}
        </li>
      </ol>
      {set && (
        <p className="obx-hand__set">
          {t('features.outbox.hand.setThereLabel')} <Shown text={set} />
        </p>
      )}
      {link && <Destination slip={slip} link={link} />}
      <button
        type="button"
        className="btn btn--primary obx-hand__key"
        aria-disabled={!!why || undefined}
        aria-describedby={why ? reason : undefined}
        data-testid="outbox-copy"
        onClick={() => !why && onCopy()}
      >
        <ClipboardCopy size={14} aria-hidden />
        {slip.draft ? (linkOf(slip) ? t('features.outbox.hand.copy') : t('features.outbox.hand.copyOnly')) : t('features.outbox.hand.open', { server: slip.target.serverName })}
        <kbd className="kbd obx-fine">{MOD}↵</kbd>
      </button>
      {why && (
        <p id={reason} className="obx-hand__why" data-why={block ?? 'missing'} data-testid="outbox-why">
          {why}
        </p>
      )}
    </div>
  )
}

/** Where "Copy & open" leads: the host, and — off the server's host — FOREIGN with a tick of its own. */
function Destination({ slip, link }: { slip: Slip; link: string }) {
  const t = useT()
  const host = hostOf(link)
  const home = linkHome(slip, link)
  // shown at once, stored right after (one compare-and-set), like an address's tick
  const [ticked, setTicked] = useState(slip.linkOk === link)
  useEffect(() => setTicked(slip.linkOk === link), [slip.linkOk, link])
  return (
    <p className="obx-hand__dest" data-foreign={!home || undefined} data-testid="outbox-dest" title={shownText(link)}>
      <span className="label">{t('features.outbox.hand.dest')}</span>
      <code className="obx-hand__host">
        <Shown text={host || link} />
      </code>
      {!home && (
        <>
          <span className="obx-hand__fword">
            <ForeignMark />
            {t('features.outbox.hand.destForeign', { server: slip.target.serverName })}
          </span>
          <label className="obx-addr__tick">
            <input
              type="checkbox"
              checked={ticked}
              disabled={!unsent(slip.state)}
              aria-label={shownText(t('features.outbox.hand.destTick', { host: host || link }))}
              onChange={(e) => {
                setTicked(e.target.checked)
                void acceptLink(slip.id, e.target.checked ? link : null)
              }}
              data-testid="outbox-dest-tick"
            />
          </label>
        </>
      )}
    </p>
  )
}

/** "Sent in <server>?" — the hand path's question after Copy & open. */
export function AskSent({ slip, onYes, onNo }: { slip: Slip; onYes: () => void; onNo: () => void }) {
  const t = useT()
  const yes = useRef<HTMLButtonElement>(null)
  useEffect(() => yes.current?.focus(), [])
  return (
    <div
      className="obx-ask"
      role="group"
      aria-label={t('features.outbox.hand.ask', { server: slip.target.serverName })}
      data-testid="outbox-ask"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onNo()
        }
      }}
    >
      <b className="obx-ask__q">{t('features.outbox.hand.ask', { server: slip.target.serverName })}</b>
      <span className="obx-sp" />
      <button ref={yes} type="button" className="btn btn--ink btn--sm" onClick={onYes} data-testid="outbox-mark-sent">
        <kbd className="kbd obx-fine">↵</kbd>
        {t('features.outbox.hand.yes')}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onNo}>
        <kbd className="kbd obx-fine">Esc</kbd>
        {t('features.outbox.hand.notYet')}
      </button>
    </div>
  )
}
