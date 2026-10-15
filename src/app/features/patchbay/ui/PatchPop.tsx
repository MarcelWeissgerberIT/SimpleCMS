/**
 * The popover at the target jack (plan §1.13; P4, B16): a patch that asks first — "This opens a way out — fuse F2. Plug it
 * anyway?" with the "+F2" tag (the fuse's own signal tag: the only orange here), a mirror's tool list, the last start of
 * an enabled agent, a server agent's webhook trigger — all its asks in one place, asked once; or a patch that did not
 * connect, with why ("Ways out are made in their editor.") and "Open the editor" where it is changed instead (↵ — the
 * key has the keyboard), or nothing to change (in ink). Esc / Cancel / Close: nothing written, the keyboard back on the
 * source jack (patchRun.ts closePop).
 */
import { CornerDownLeft, Plug, Unplug } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import { Kbd } from '../../../ui/controls'
import type { PlateWords } from './plateParts'
import { openTarget } from './open'
import type { PopState } from './patchUI'
import { closePop, confirmPop } from './patchRun'

const P = 'features.patchbay'

export function PatchPop({ pop, pw }: { pop: PopState; pw: PlateWords }) {
  const t = pw.w.t
  const unplug = pop.patch.op === 'unplug'
  if (pop.kind === 'ask') {
    const opens = pop.plan.opens ?? []
    const head = t(unplug ? `${P}.patch.ask.headUnplug` : `${P}.patch.ask.head`)
    return (
      <Popover open anchor={pop.anchor} onClose={closePop} placement="bottom" className="pb-ppop" role="dialog" aria-label={head}>
        <div className="pb-ppop__in" data-kind="ask" data-testid="pb-patch-ask">
          <div className="pb-ppop__head">
            <span className="label">{head}</span>
            {opens.map((o) => (
              <span key={o.key} className="pb-tag pb-tag--f" data-testid="pb-patch-opens">
                {`+${o.label}`}
              </span>
            ))}
          </div>
          <p className="pb-ppop__route">
            {pop.names.from} <span aria-hidden="true">→</span> {pop.names.to}
          </p>
          <ul className="pb-ppop__asks">
            {(pop.plan.asks ?? []).map((a, i) => (
              <li key={i} data-ask={a.key.split('.').pop()}>
                {pw.say(a)}
              </li>
            ))}
          </ul>
          {!!pop.plan.notes?.length && (
            <p className="pb-ppop__note">
              {pop.plan.notes.map((n) => pw.say(n)).join(' ')}
            </p>
          )}
          <div className="pb-ppop__keys">
            <button type="button" className="btn btn--sm pb-ppop__go" onClick={() => confirmPop(pw)} data-autofocus="" data-testid="pb-patch-go">
              {unplug ? <Unplug size={14} strokeWidth={1.75} aria-hidden="true" /> : <Plug size={14} strokeWidth={1.75} aria-hidden="true" />}
              {t(unplug ? `${P}.patch.ask.goUnplug` : `${P}.patch.ask.go`)}
              <CornerDownLeft size={11} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={closePop} data-testid="pb-patch-cancel">
              {t('common.cancel')}
              <Kbd>Esc</Kbd>
            </button>
          </div>
        </div>
      </Popover>
    )
  }
  const head = pop.kind === 'info' ? t(`${P}.patch.info.head`) : t(unplug ? `${P}.patch.no.headUnplug` : `${P}.patch.no.head`)
  const open = pop.open
  return (
    <Popover open anchor={pop.anchor} onClose={closePop} placement="bottom" className="pb-ppop" role="dialog" aria-label={head}>
      <div className="pb-ppop__in" data-kind={pop.kind} data-testid="pb-patch-no">
        <div className="pb-ppop__head">
          <span className="label">{head}</span>
        </div>
        <p className="pb-ppop__why" role="status">
          {pw.say(pop.msg)}
        </p>
        <div className="pb-ppop__keys">
          {open && (
            <button
              type="button"
              className="btn btn--sm pb-ppop__open"
              data-autofocus=""
              onClick={() => {
                const from = document.querySelector<HTMLElement>(`.pb-jk[data-jack="${CSS.escape(pop.source)}"]`)
                closePop()
                openTarget(open, from)
              }}
              data-testid="pb-patch-open"
            >
              {t(`${P}.keys.openEditor`)}
              <CornerDownLeft size={11} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={closePop} {...(open ? {} : { 'data-autofocus': '' })} data-testid="pb-patch-close">
            {t('common.close')}
            <Kbd>Esc</Kbd>
          </button>
        </div>
      </div>
    </Popover>
  )
}
