/**
 * The plate's EJECT key (mock §1.6.6): "Auswerfen · {back} / {all}", counted from the reading's verdicts (no settle,
 * no flush on a bracket change — the dialog's plan is authoritative and may differ, C18). Desktop: a hinged, hatched
 * cover lies over it — the cover is the focusable control ("Deckel von Auswerfen öffnen"), the key beneath is inert
 * until it is lifted (none under reduced motion: it flips at once); it closes again with another window or the deck.
 * The key never ejects: it opens the dialog. Phone: no cover (the dialog is the cover). Disabled with its reason: a
 * team workspace, an eject's own window, too many places, nothing that goes back ("Schon ausgeworfen 08:05").
 */
import { useEffect, useRef, useState } from 'react'
import { Eject } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import type { Outcome } from '../model/types'
import type { ReadModel } from '../window/read'
import { canEjectHere } from './ejectGate'
import { fmtNum, hm } from './format'
import { openEject, type Bracket } from './state'

const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])

/** The plate's counts of a reading: back · all (held + partial too; already ejected and unavailable places left out). */
export function ejectCounts(model: ReadModel): { back: number; all: number; held: number; already: number } {
  let back = 0
  let all = 0
  let held = 0
  let already = 0
  for (const v of model.verdicts.values()) {
    if (v.outcome === 'skip') continue
    if (v.outcome === 'already') {
      already++
      continue
    }
    all++
    if (BACK.has(v.outcome)) back++
    else if (v.outcome === 'held') held++
  }
  return { back, all, held, already }
}

export function EjectKey({ bracket, model, phone, wkey }: { bracket: Bracket; model: ReadModel | null; phone: boolean; wkey: string }) {
  const t = useT()
  const lang = useLang()
  const [lifted, setLifted] = useState(false)
  const keyRef = useRef<HTMLButtonElement>(null)
  // another window (or the deck closing) closes the cover
  useEffect(() => setLifted(false), [wkey])

  const c = model ? ejectCounts(model) : null
  // why the key is off (null: it opens the dialog)
  let off: string | null = null
  if (!canEjectHere()) off = t('features.recorder.eject.teamLater')
  else if (bracket.lane === 'undo' || bracket.run?.startsWith('eject:')) off = t('features.recorder.eject.ejectRun')
  else if (model?.tooMany) off = t('features.recorder.eject.tooMany', { n: fmtNum(model.tooMany, lang) })
  else if (c && c.back === 0) {
    const e = c.already ? [...(model?.data.ejects ?? [])].reverse().find((x) => x.state === 'done' && !x.undone && (x.writer === (bracket.run ?? bracket.lane) || x.lane === bracket.lane)) : undefined
    off = e ? t('features.recorder.eject.already', { time: hm(e.at) }) : t('features.recorder.eject.nothingBack')
  }
  const disabled = !c || !!off
  const aria = c ? t('features.recorder.win.ejectAria', { back: fmtNum(c.back, lang), all: fmtNum(c.all, lang), held: fmtNum(c.held, lang) }) : t('features.recorder.win.eject')
  const covered = !phone && !lifted && !disabled

  const lift = () => {
    setLifted(true)
    // the key takes focus once it is no longer inert
    requestAnimationFrame(() => keyRef.current?.focus({ preventScroll: true }))
  }

  return (
    <div className="eject" data-lifted={lifted || undefined} data-off={off ? '' : undefined}>
      {!phone && !disabled && (
        <button type="button" className="eject__cover" aria-expanded={lifted} aria-label={lifted ? t('features.recorder.win.coverClose') : t('features.recorder.win.cover')} title={t('features.recorder.win.cover')} onClick={() => (lifted ? setLifted(false) : lift())} tabIndex={lifted ? -1 : 0}>
          <span className="eject__hinge" aria-hidden="true" />
        </button>
      )}
      <button ref={keyRef} type="button" className="eject__key" disabled={disabled} inert={covered || undefined} aria-label={off ? `${t('features.recorder.win.eject')}: ${off}` : aria} title={off ?? aria} onClick={openEject}>
        <Eject aria-hidden />
        <span>{t('features.recorder.win.eject')}</span>
        {c && !off && <small>{t('features.recorder.win.ejectCount', { back: fmtNum(c.back, lang), all: fmtNum(c.all, lang) })}</small>}
      </button>
      {off && <p className="eject__off">{off}</p>}
    </div>
  )
}
