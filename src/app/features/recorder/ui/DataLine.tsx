/**
 * Workspace → Data: this workspace's tape on this device ("30 days · 41,208 writes · 3.2 MB"), the size of every
 * workspace's tape on this device, "Open the tape" and "Erase the tape" (asks first; this workspace's scope only —
 * the workspace, its pages and their versions stay; other devices keep their own tapes).
 */
import { useEffect, useState } from 'react'
import { Disc3, Eraser } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { toast } from '../../../store/ui'
import { Modal } from '../../../ui/Modal'
import { wipeScope } from '../journal/db'
import { deviceBytes } from '../journal/query'
import { recorder } from '../journal/recorder'
import { scopeNow } from '../journal/scope'
import { emitReset } from '../journal/bus'
import { fmtSize, unit } from './format'
import { daysRecorded, refreshTapeInfo, useTapeInfoLive } from './info'
import { openRecorder } from './state'

export function RecorderDataLine() {
  const t = useT()
  const lang = useLang()
  const { info } = useTapeInfoLive()
  const [device, setDevice] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    void deviceBytes()
      .then((n) => !off && setDevice(n))
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [info])

  const erase = async () => {
    setBusy(true)
    const scope = scopeNow()
    try {
      const r = recorder()
      if (r) await r.wipe(scope)
      else {
        await wipeScope(scope)
        emitReset(scope)
      }
      toast({ message: t('features.recorder.data.wiped'), kind: 'success' })
    } catch {
      toast({ message: t('features.recorder.data.wipeFailed'), kind: 'error' })
    } finally {
      setBusy(false)
      setAsking(false)
      refreshTapeInfo(0)
    }
  }

  const has = !!info && info.ops > 0
  return (
    <>
      <p className="wsp-line" data-testid="ws-recorder">
        <span className="label">{t('features.recorder.data.tape')}</span>
        <span className="wsp-line__val">
          {has ? t('features.recorder.data.line', { days: unit(t, lang, 'days', daysRecorded(info)), ops: unit(t, lang, 'ops', info.ops), size: fmtSize(info.bytes, lang) }) : t('features.recorder.data.empty')}
        </span>
        <button type="button" className="btn btn--sm wsp-line__key" onClick={openRecorder}>
          <Disc3 size={13} aria-hidden />
          {t('features.recorder.data.open')}
        </button>
        <button type="button" className="btn btn--sm wsp-line__key" disabled={!has} onClick={() => setAsking(true)}>
          <Eraser size={13} aria-hidden />
          {t('features.recorder.data.wipe')}
        </button>
      </p>
      {device !== null && device > 0 && (
        <p className="wsp-line" data-testid="ws-recorder-device">
          <span className="wsp-line__val">{t('features.recorder.data.device', { size: fmtSize(device, lang) })}</span>
        </p>
      )}
      <Modal
        open={asking}
        onClose={() => !busy && setAsking(false)}
        label={t('features.recorder.no')}
        title={t('features.recorder.data.wipeTitle')}
        width={480}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--danger" data-autofocus onClick={() => void erase()} disabled={busy}>
              {t('features.recorder.data.wipeKey')}
            </button>
          </>
        }
      >
        <p>{t('features.recorder.data.wipeBody')}</p>
      </Modal>
    </>
  )
}
