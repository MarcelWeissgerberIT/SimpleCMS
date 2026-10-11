/**
 * The database's strip after an eject (mock-3 `.db-read`, Δ24): "EINTRÄGE 34 · ZULETZT Du · 08:05 · Auswurf" — only
 * for the database the eject this deck just made wrote into (the general "last writer" readout comes with R4).
 */
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useRecorderDbEject } from './marks'

const two = (n: number) => String(n).padStart(2, '0')

export function RecorderDbRead({ dbId }: { dbId: string }) {
  const t = useT()
  const e = useRecorderDbEject(dbId)
  const n = useWorkspace((s) => (e ? Object.values(s.pages).filter((p) => p.databaseId === dbId && !p.trashed).length : 0))
  if (!e) return null
  const d = new Date(e.at)
  const you = t('features.recorder.who.you')
  return (
    <div className="db-read" data-testid="rec-db-read">
      <span>
        <span className="label">{t('features.recorder.board.entries')}</span>
        <b>{n}</b>
      </span>
      <span>
        <span className="label">{t('features.recorder.board.last')}</span>
        <b>{t('features.recorder.board.lastVal', { who: you.charAt(0).toLocaleUpperCase() + you.slice(1), time: `${two(d.getHours())}:${two(d.getMinutes())}` })}</b>
      </span>
    </div>
  )
}
