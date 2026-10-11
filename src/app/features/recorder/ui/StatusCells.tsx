/**
 * The status bar's two recorder parts: the REC cell ("Rec · 30 days · 41,208 writes" — what this device recorded
 * for this workspace, with the app's LED) and the RÜCKSPULEN key that opens / closes the deck (Mod+Alt+Z). The
 * key fetches the deck's chunk as the pointer reaches it. Latched (inverted) while the playhead is back in time.
 */
import { Rewind } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { Led, shortcutLabel } from '../../../ui/controls'
import { unit } from './format'
import { daysRecorded, useTapeInfoLive } from './info'
import { preloadDeck } from './RecorderHost'
import { REWIND_SHORTCUT, toggleRecorder, useRecorderUI } from './state'
import './cells.css'

export function RecorderStatusCell() {
  const t = useT()
  const lang = useLang()
  const { info } = useTapeInfoLive()
  const days = unit(t, lang, 'days', daysRecorded(info))
  return (
    <span className="status__cell rec-cell" data-testid="rec-cell" title={t('features.recorder.status.recTitle', { days })}>
      <Led state="on" />
      <span>
        {t('features.recorder.status.recLabel')}
        <span className="rec-cell__more">{t('features.recorder.status.recMore', { days, ops: unit(t, lang, 'ops', info?.ops ?? 0) })}</span>
      </span>
    </span>
  )
}

export function RewindKey() {
  const t = useT()
  const open = useRecorderUI((s) => s.open)
  const back = useRecorderUI((s) => s.open && s.playhead !== null)
  const key = shortcutLabel(REWIND_SHORTCUT)
  const title = t(open ? 'features.recorder.status.close' : 'features.recorder.status.open', { key })
  return (
    <button
      type="button"
      className="status__cell status__key"
      data-on={back ? '' : undefined}
      aria-pressed={open}
      title={title}
      onPointerEnter={() => void preloadDeck().catch(() => undefined)}
      onFocus={() => void preloadDeck().catch(() => undefined)}
      onClick={toggleRecorder}
    >
      <Rewind aria-hidden />
      <span className="status__kl">{t('features.recorder.status.rewind')}</span>
      <span className="status__k">{key}</span>
    </button>
  )
}
