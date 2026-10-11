/**
 * The deck's head row: "§ 02.14 Flugschreiber", the REC chip, the counter, the transport (previous run, a minute
 * back, a minute forward, now), the zoom (a radio group; one key with a menu on a narrower deck), the loupe (only
 * while a window is on the tape), the lane filter and Close (Esc). Its keys never shrink: the head sheds whole parts
 * until it fits — measured, never guessed from the width (a German head needs more room than an English one):
 *   xl everything · l without the REC chip, the name and "?" · m one zoom key with a menu · s the counter's day and
 *   the Esc keycap go · xs the "Now" word and the filter's count go (icons with their names). Close and the filter last.
 */
import { ChevronDown, FastForward, Rewind, SkipBack, SkipForward, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLang, useT } from '../../../i18n'
import { Kbd, Led } from '../../../ui/controls'
import { HelpLink } from '../../../help'
import { Menu, useMenu } from '../../../ui/Menu'
import { onRovingKey } from '../../../ui/roving'
import { ZOOM, ZOOMS, loupeLabel, type Zoom } from '../model/axis'
import { movePlayhead, prevRun, stepPlayhead } from './actions'
import { Counter } from './Counter'
import { unit } from './format'
import { LaneFilter } from './LaneFilter'
import { closeRecorder, setLoupe, setZoom, useRecorderUI } from './state'

const HEADS = ['xl', 'l', 'm', 's', 'xs'] as const
type Head = (typeof HEADS)[number]

export function DeckHead({ width, phone, loupeK, knownLanes, days }: { width: number; phone: boolean; loupeK: number | null; knownLanes: string[]; days: number }) {
  const t = useT()
  const lang = useLang()
  const zoom = useRecorderUI((s) => s.span.zoom)
  const loupe = useRecorderUI((s) => s.loupe)
  const atNow = useRecorderUI((s) => s.playhead === null)
  const menu = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState<Head>('xl')
  const k = loupeK ? loupeLabel(loupeK) : null
  // another width, language or loupe key: the widest head that fits is looked for again (before the frame is painted)
  useLayoutEffect(() => setHead('xl'), [width, lang, !!k, phone])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || phone || el.scrollWidth <= el.clientWidth + 1) return
    const i = HEADS.indexOf(head)
    if (i < HEADS.length - 1) setHead(HEADS[i + 1])
  })
  const collapsed = head === 'm' || head === 's' || head === 'xs'
  const terse = phone || head === 'xs'

  return (
    <div className="deck__head" ref={ref} data-head={phone ? undefined : head}>
      <span className="deck__title">
        <span className="deck__no" title={t('features.recorder.no')}>
          §<span className="deck__num">{t('features.recorder.no').replace(/^§\s*/, ' ')}</span>
        </span>
        <span className="deck__nm" id="deck-title">
          {t('features.recorder.title')}
        </span>
        <HelpLink id="flight-recorder" topic={t('features.recorder.title')} className="deck__help" />
      </span>
      <span className="deck-rec">
        <Led state="on" />
        <span className="label">{t('features.recorder.deck.rec', { days: unit(t, lang, 'days', days) })}</span>
      </span>
      <Counter />
      <span className="tkeys" role="group" aria-label={t('features.recorder.deck.transport')}>
        <button type="button" className="tkey" aria-label={t('features.recorder.deck.prevRun')} title={t('features.recorder.deck.prevRun')} onClick={prevRun}>
          <SkipBack aria-hidden />
        </button>
        <button type="button" className="tkey" aria-label={t('features.recorder.deck.minuteBack')} title={t('features.recorder.deck.minuteBack')} onClick={() => stepPlayhead(-60_000)}>
          <Rewind aria-hidden />
        </button>
        {/* at now it cannot act — aria-disabled, not disabled: focus stays on it (a disabled key drops focus to the page) */}
        <button type="button" className="tkey" aria-label={t('features.recorder.deck.minuteFwd')} title={t('features.recorder.deck.minuteFwd')} onClick={() => !atNow && stepPlayhead(60_000)} aria-disabled={atNow || undefined}>
          <FastForward aria-hidden />
        </button>
        <button type="button" className="tkey" aria-label={t('features.recorder.deck.toNow')} title={t('features.recorder.deck.toNow')} aria-pressed={atNow} data-on={atNow ? '' : undefined} onClick={() => movePlayhead(null)}>
          <SkipForward aria-hidden />
          {!terse && t('features.recorder.deck.now')}
        </button>
      </span>
      {!phone &&
        (collapsed ? (
          <span className="tkeys">
            <button type="button" className="tkey" aria-haspopup="menu" aria-expanded={menu.open} aria-label={`${t('features.recorder.deck.zoom.aria')}: ${t(`features.recorder.deck.zoom.${zoom}`)}`} onClick={menu.toggle}>
              {t(`features.recorder.deck.zoom.${zoom}`)}
              <ChevronDown aria-hidden />
            </button>
            <Menu {...menu.props} placement="top-start" entries={ZOOMS.map((z) => ({ label: t(`features.recorder.deck.zoom.${z}`), checked: z === zoom, onSelect: () => setZoom(z) }))} />
          </span>
        ) : (
          <span className="tkeys zoom" role="radiogroup" aria-label={t('features.recorder.deck.zoom.aria')} onKeyDown={(e) => onRovingKey(e)}>
            {ZOOMS.map((z: Zoom) => (
              <button key={z} type="button" role="radio" className="tkey" aria-checked={z === zoom} tabIndex={z === zoom ? 0 : -1} data-on={z === zoom ? '' : undefined} onClick={() => setZoom(z)}>
                {t(`features.recorder.deck.zoom.${z}`)}
              </button>
            ))}
          </span>
        ))}
      {!phone && k && ZOOM[zoom].loupe && (
        <span className="tkeys">
          <button type="button" className="tkey" aria-pressed={loupe} data-on={loupe ? '' : undefined} title={t('features.recorder.deck.loupeTitle', { k })} onClick={() => setLoupe(!loupe)}>
            {t('features.recorder.deck.loupe', { k })}
          </button>
        </span>
      )}
      <span className="deck__sp" />
      <LaneFilter all={knownLanes} compact={terse} />
      <button type="button" className="tkey tkey--ghost" aria-label={t('features.recorder.deck.close')} title={t('features.recorder.deck.close')} onClick={closeRecorder}>
        <X aria-hidden />
        <Kbd>Esc</Kbd>
      </button>
    </div>
  )
}
