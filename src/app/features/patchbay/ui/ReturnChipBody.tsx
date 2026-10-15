/**
 * The return chip's body (lazy — ReturnChip.tsx renders it only while a way back is set and the route is not
 * #/patchbay): "← Back to setup · 05 next ↵" and ×. The number is the lamp that is next NOW (the lamps are read while
 * it shows: a test that passed on #/mcp moves it on from 02 to 03); every lamp green: "Setup done". ↵ (or a click)
 * opens the patchbay at the profile's setup — the arrival takes it from there. A profile that is gone takes the chip
 * with it. Phone: the arrow, the number and × — the words are the key's name.
 */
import { useEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useT } from '../../../i18n'
import { focusLost, focusMainRegion } from '../../../ui/focus'
import type { LampId } from '../types'
import { openPatchbay } from '../open'
import { clearReturn, type ReturnRecord } from '../setup/return'
import { useSetupLamps } from '../setup/facts'
import { setOf } from '../setup/lamps'
import { lampNo } from '../setup/keys'
import './return-chip.css'

const LAMP_N: Record<LampId, number> = { key: 0, server: 1, test: 2, profile: 3, database: 4, agent: 5, firstRun: 6 }

export default function ReturnChipBody({ ret }: { ret: ReturnRecord }) {
  const t = useT()
  const live = useSetupLamps(ret.profileId)
  // the profile is gone: no setup to go back to
  useEffect(() => {
    if (live === null) clearReturn()
  }, [live])
  if (!live) return null
  const set = setOf(live.sets, ret.recipeId)
  const next = set ? set.next : null
  const no = lampNo(next ? next.n : LAMP_N[ret.next])
  const name = next ? t('features.patchbay.setup.return', { next: no }) : t('features.patchbay.setup.returnDone')
  const back = () => openPatchbay({ setup: ret.profileId })
  // × takes the chip away: the keyboard goes to the main region, never the body
  const close = () => {
    clearReturn()
    requestAnimationFrame(() => {
      if (focusLost()) focusMainRegion()
    })
  }
  return (
    <span className="pb-ret" data-testid="pb-return">
      <button type="button" className="pb-ret__key" onClick={back} aria-label={name} title={name} data-testid="pb-return-key">
        <ArrowLeft className="pb-ret__arrow" size={14} strokeWidth={1.75} aria-hidden />
        <span className="pb-ret__text" aria-hidden>
          {t('features.patchbay.setup.returnShort')}
        </span>
        {next ? (
          <>
            <span className="pb-ret__n" aria-hidden>
              {no}
            </span>
            <span className="pb-ret__next" aria-hidden>
              {t('features.patchbay.setup.returnNext')}
            </span>
          </>
        ) : (
          <span className="led led--ok" aria-hidden />
        )}
        <span className="kbd pb-ret__kbd" aria-hidden>
          ↵
        </span>
      </button>
      <button type="button" className="pb-ret__x" onClick={close} aria-label={t('features.patchbay.setup.returnClose')} title={t('features.patchbay.setup.returnClose')} data-testid="pb-return-close">
        <X size={13} strokeWidth={1.9} aria-hidden />
      </button>
    </span>
  )
}
