/**
 * ScriptDialogHost — shows what a running script asks (mount once in the app shell): modal(), confirm(),
 * ask(), choose(), the list of effects before a run (with checkboxes), one more effect, more time, and
 * a team script someone else changed. One dialog at a time; Esc / closing = cancel.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Modal } from '../../../ui/Modal'
import { useLang, useT } from '../../../i18n'
import { answerDialog, useScriptDialogs, type PendingDialog } from '../runtime/dialogs'
import type { ConfirmItem } from '../runtime/types'
import { effectNote, type EffectName } from '../runtime/effects'
import type { RunBand } from '../runtime/types'
import { allowTask, fmtBand, fmtLimit } from '../../governor'
import { fmtUsd } from '../../../lib/money'
import { typingWithin } from '../../../ui/keys'
import './dialogs.css'

/** The effect's tag (the AI one is translated: "AI" / "KI"). */
const KIND_LABEL: Record<ConfirmItem['kind'], string> = { mail: 'MAIL', claude: 'features.script.kind.ai', http: 'HTTP', trash: 'TRASH' }
const EFFECT_OF: Partial<Record<ConfirmItem['kind'], EffectName>> = { mail: 'mail.send', claude: 'claude', http: 'http.post' }

/** How the effect happens now, when its implementation says so ("via Gmail · ada@example.com"). */
function Via({ kind }: { kind: ConfirmItem['kind'] }) {
  const name = EFFECT_OF[kind]
  const note = name ? effectNote(name) : null
  return note ? <span className="sc-plan__via">{note}</span> : null
}

function PlanList({ items, on, setOn }: { items: ConfirmItem[]; on: Set<string>; setOn: (s: Set<string>) => void }) {
  const t = useT()
  return (
    <ul className="sc-plan">
      {items.map((it) => (
        <li key={it.key}>
          <label className="sc-plan__item">
            <input
              type="checkbox"
              checked={on.has(it.key)}
              onChange={(e) => {
                const next = new Set(on)
                if (e.target.checked) next.add(it.key)
                else next.delete(it.key)
                setOn(next)
              }}
            />
            <span className={`sc-plan__kind label sc-plan__kind--${it.kind}`}>{it.kind === 'claude' ? t(KIND_LABEL.claude) : KIND_LABEL[it.kind]}</span>
            <span className="sc-plan__label">{t(`features.script.plan.${it.kind}`, { label: it.label })}</span>
            <Via kind={it.kind} />
          </label>
        </li>
      ))}
    </ul>
  )
}

/**
 * With a budget: what the run's AI calls may cost (n × one call's band) against the rest today. Over the line: the run
 * stops at the call that would cross it — E (focus in the line, or its key) allows +1 $ for this run, today.
 */
function PlanBandLine({ band }: { band: RunBand }) {
  const t = useT()
  const lang = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const [allowed, setAllowed] = useState(false)
  const allow = () => {
    if (allowed || band.allow === null) return
    const had = !!ref.current?.contains(document.activeElement)
    allowTask(band.source, band.allow)
    setAllowed(true)
    // the E key goes: the keyboard to the dialog's run key (never the body)
    if (had) requestAnimationFrame(() => ref.current?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[data-autofocus]')?.focus())
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat || typingWithin(e.target as Element, ref.current) || e.key.toLowerCase() !== 'e') return
    e.preventDefault()
    allow()
  }
  return (
    <div ref={ref} className="sc-band" data-over={!band.fits && !allowed ? '' : undefined} onKeyDown={onKey} data-testid="sc-plan-band">
      <p className="sc-band__line label">{t('features.governor.plan.band', { n: band.n, band: fmtBand(band.band, lang), rest: fmtUsd(band.rest, lang) })}</p>
      {!band.fits && (
        <p className="sc-band__over">
          {allowed ? t('features.governor.plan.allowed', { usd: fmtLimit(band.allow ?? 0, lang) }) : band.allow === null ? t('features.governor.plan.need', { usd: fmtUsd(band.need, lang) }) : t('features.governor.plan.over')}
          {!allowed && band.allow !== null && (
            <button type="button" className="btn btn--sm sc-band__key" onClick={allow}>
              <span className="kbd">E</span>
              {t('features.governor.plan.allow', { usd: fmtLimit(band.allow, lang) })}
            </button>
          )}
        </p>
      )}
    </div>
  )
}

function Dialog({ d }: { d: PendingDialog }) {
  const t = useT()
  const req = d.req
  const [text, setText] = useState(req.type === 'ask' ? req.def : '')
  const [on, setOn] = useState<Set<string>>(() => new Set(req.type === 'plan' ? req.items.filter((i) => i.on).map((i) => i.key) : []))
  const answer = (v: unknown) => answerDialog(d.id, v)
  const cancelValue = req.type === 'confirm' || req.type === 'one' || req.type === 'time' || req.type === 'trust' ? false : null
  const footer = (main: React.ReactNode) => <div className="sc-dlg__keys">{main}</div>

  let title = ''
  let body: React.ReactNode = null
  let keys: React.ReactNode = null
  switch (req.type) {
    case 'modal':
      title = t('features.script.dlg.from')
      body = <p className="sc-dlg__text">{req.text}</p>
      keys = footer(
        req.buttons.map((b, i) => (
          <button key={`${b}${i}`} type="button" className={`btn${i === 0 ? ' btn--primary' : ''}`} onClick={() => answer(b)} data-autofocus={i === 0 ? '' : undefined}>
            {b}
          </button>
        )),
      )
      break
    case 'confirm':
      title = t('features.script.dlg.from')
      body = <p className="sc-dlg__text">{req.text}</p>
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(true)} data-autofocus>
            {t('features.script.dlg.ok')}
          </button>
        </>,
      )
      break
    case 'ask':
      title = t('features.script.dlg.from')
      body = (
        <form
          className="sc-dlg__form"
          onSubmit={(e) => {
            e.preventDefault()
            answer(text)
          }}
        >
          <label className="sc-dlg__text" htmlFor="sc-ask">
            {req.text}
          </label>
          <input id="sc-ask" className="input" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        </form>
      )
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(text)}>
            {t('features.script.dlg.ok')}
          </button>
        </>,
      )
      break
    case 'choose':
      title = t('features.script.dlg.from')
      body = (
        <>
          <p className="sc-dlg__text">{req.text}</p>
          <ul className="sc-choose">
            {req.options.map((o, i) => (
              <li key={`${o}${i}`}>
                <button type="button" className="sc-choose__item" onClick={() => answer(o)} data-autofocus={i === 0 ? '' : undefined}>
                  <span className="sc-choose__n mono">{String(i + 1).padStart(2, '0')}</span>
                  {o}
                </button>
              </li>
            ))}
          </ul>
        </>
      )
      break
    case 'plan':
      title = t('features.script.dlg.planTitle')
      body = (
        <>
          <p className="sc-dlg__text">{t('features.script.dlg.planLead', { name: req.scriptName || t('features.script.untitled') })}</p>
          <PlanList items={req.items} on={on} setOn={setOn} />
          {req.band && <PlanBandLine band={req.band} />}
          {req.items.some((i) => i.kind === 'http') && <p className="sc-dlg__note">{t('features.script.dlg.httpNote')}</p>}
        </>
      )
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(on)} data-autofocus>
            {t('features.script.dlg.planRun', { n: on.size, total: req.items.length })}
          </button>
        </>,
      )
      break
    case 'one':
      title = t('features.script.dlg.oneTitle')
      body = (
        <>
          <p className="sc-dlg__text">{t('features.script.dlg.oneLead', { name: req.scriptName || t('features.script.untitled') })}</p>
          <p className="sc-dlg__item">
            <span className={`sc-plan__kind label sc-plan__kind--${req.item.kind}`}>{KIND_LABEL[req.item.kind]}</span> {t(`features.script.plan.${req.item.kind}`, { label: req.item.label })} <Via kind={req.item.kind} />
          </p>
        </>
      )
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(false)}>
            {t('features.script.dlg.skip')}
          </button>
          <button type="button" className="btn" onClick={() => answer('all')}>
            {t(`features.script.dlg.allowAll.${req.item.kind}`)}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(true)} data-autofocus>
            {t('features.script.dlg.allow')}
          </button>
        </>,
      )
      break
    case 'time':
      title = t('features.script.dlg.timeTitle')
      body = <p className="sc-dlg__text">{t('features.script.dlg.timeLead', { name: req.scriptName || t('features.script.untitled') })}</p>
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(false)}>
            {t('features.script.stop')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(true)} data-autofocus>
            {t('features.script.dlg.moreTime')}
          </button>
        </>,
      )
      break
    case 'trust':
      title = t('features.script.dlg.trustTitle')
      body = (
        <>
          <p className="sc-dlg__text">{req.editor ? t('features.script.dlg.trustLead', { name: req.name, editor: req.editor }) : t('features.script.dlg.trustLeadAnon', { name: req.name })}</p>
          <pre className="sc-dlg__code" tabIndex={0}>
            {req.code.slice(0, 4000)}
          </pre>
        </>
      )
      keys = footer(
        <>
          <button type="button" className="btn" onClick={() => answer(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => answer(true)}>
            {t('features.script.dlg.trustRun')}
          </button>
        </>,
      )
      break
  }
  return (
    <Modal open onClose={() => answer(cancelValue)} label="§ SC" title={title} width={req.type === 'trust' || req.type === 'plan' ? 560 : 440} footer={keys} className="sc-dlg">
      <div data-testid={`sc-dialog-${req.type}`}>{body}</div>
    </Modal>
  )
}

export function ScriptDialogHost() {
  const top = useScriptDialogs((s) => s.queue[0] ?? null)
  // a fresh dialog state per request
  const [key, setKey] = useState(0)
  useEffect(() => setKey((k) => k + 1), [top?.id])
  return top ? <Dialog key={`${top.id}:${key}`} d={top} /> : null
}
