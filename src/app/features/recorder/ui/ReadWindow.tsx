/**
 * "Fenster lesen": the selected window read place by place — read-only, never an eject. A modal (focus, the stack,
 * the closing gesture are the shared Modal's) with its own bar: "§ 02.14 Flugschreiber · Fenster lesen", the window,
 * ✕; the title "{ops} von {writer}"; the places grouped by what changed (PlanList) beside the picked place's diff
 * (PlacePreview); the footer "Bericht" + "Schließen" (Esc). Phone: a bottom sheet — tapping a place opens it on a
 * second sheet (DiffSheet); the footer keeps "Bericht". Nothing here writes the workspace.
 */
import { useEffect, useState } from 'react'
import { FileDown, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Modal } from '../../../ui/Modal'
import { Kbd } from '../../../ui/controls'
import { scopeNow } from '../journal/scope'
import type { PlaceKey } from '../model/types'
import { readWindow, type ReadModel } from '../window/read'
import { DiffSheet } from './DiffSheet'
import { PlacePreview } from './PlacePreview'
import { PlanList, writerName } from './PlanList'
import { fmtDayShort, fmtNum, hm, pl, unit, windowEnd } from './format'
import { say } from './live'
import { usePhone } from './phone'
import { downloadReport } from './report'
import { closeRead, pickPlace, useRecorderUI } from './state'
import { whoName } from './WindowPlate'
import { Bold, BOLD } from './bold'

export function ReadWindow() {
  const t = useT()
  const lang = useLang()
  const phone = usePhone()
  const bracket = useRecorderUI((s) => s.bracket)
  const pick = useRecorderUI((s) => s.read?.pick ?? null)
  // the tape's state when the dialog opened: a later push does not swap what is being read
  const [rev] = useState(() => useRecorderUI.getState().ops.rev)
  const [model, setModel] = useState<ReadModel | null>(null)
  const [failed, setFailed] = useState(false)
  const [sheet, setSheet] = useState<PlaceKey | null>(null)
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))

  useEffect(() => {
    if (!bracket) return
    let off = false
    readWindow({ scope: scopeNow(), lane: bracket.lane, ...(bracket.run ? { run: bracket.run } : {}), a: bracket.a, b: bracket.b }, rev)
      .then((m) => {
        if (off) return
        setModel(m)
        const first = m.groups[0]?.items[0]?.p ?? null
        const cur = useRecorderUI.getState().read?.pick
        if (!cur || !m.data.places.has(cur)) pickPlace(first)
        const { writer } = writerName(m, t, ws)
        say(t('features.recorder.live.read', { ops: unit(t, lang, 'ops', m.meters.ops), writer }))
      })
      .catch((e) => {
        console.warn('[recorder] the window could not be read', e)
        if (!off) setFailed(true)
      })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket?.lane, bracket?.run, bracket?.a, bracket?.b, rev])

  if (!bracket) return null
  const no = t('features.recorder.no')
  const title = t('features.recorder.title')
  const range = `${hm(bracket.a)}–${hm(windowEnd(bracket))}`
  const names = model ? writerName(model, t, ws) : null
  const places = model ? unit(t, lang, 'places', model.meters.places.all) : ''
  const heldWho = model ? [...new Set(model.held.flatMap((v) => v.by.map((b) => b.lane)))].map((l) => whoName(l, t, ws)) : []
  return (
    <>
      <Modal open onClose={closeRead} bare width={980} className="rec-read" ariaLabel={model && names ? t('features.recorder.read.title', { ops: unit(t, lang, 'ops', model.meters.ops), writer: names.writer }) : t('features.recorder.win.read')}>
        <div className="rec-bar">
          <span className="label rec-bar__l">
            <span className="rec-bar__no">
              {no} {title} ·
            </span>
            <b>{t('features.recorder.win.read')}</b>
          </span>
          <span className="rec-bar__sp" />
          <span className="label rec-bar__w">{t('features.recorder.read.windowLabel', { day: fmtDayShort(t, lang, bracket.a), range })}</span>
          <button type="button" className="icon-btn rec-bar__x" onClick={closeRead} aria-label={t('features.recorder.read.close')} title={t('features.recorder.read.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="rec-head">
          <h2 className="rec-title" data-modal-title>
            {model && names ? t('features.recorder.read.title', { ops: unit(t, lang, 'ops', model.meters.ops), writer: names.writer }) : t('features.recorder.win.read')}
          </h2>
          {model && (
            <p className="rec-sub">
              <Bold text={t('features.recorder.read.sub', { places: BOLD })} bold={places} />
              {model.held.length > 0 && (
                <>
                  {' '}
                  <Bold text={t('features.recorder.read.subHeld', { held: BOLD, who: heldWho.join(', ') })} bold={unit(t, lang, model.held.every((v) => v.pk === 'row') ? 'rows' : 'places', model.held.length)} />
                </>
              )}
            </p>
          )}
        </div>
        <div className="rec-body">
          {model ? (
            <>
              <PlanList model={model} pick={pick} onPick={pickPlace} onOpen={(p) => setSheet(p)} phone={phone} />
              {!phone && <div className="rec-prev">{pick && model.data.places.has(pick) ? <PlacePreview model={model} p={pick} /> : null}</div>}
            </>
          ) : (
            <p className="rec-wait" role="status">
              {t(failed ? 'features.recorder.read.failed' : 'features.recorder.read.loading')}
            </p>
          )}
        </div>
        <div className="rec-foot">
          {model?.incomplete && <span className="rec-foot__note">{t('features.recorder.win.incomplete')}</span>}
          {model && model.partial.length > 0 && <span className="rec-foot__note">{t('features.recorder.win.partial', { places: t(pl('features.recorder.unit.places', model.partial.length), { n: fmtNum(model.partial.length, lang) }) })}</span>}
          <span className="rec-foot__sp" />
          <button type="button" className="btn rec-foot__report" disabled={!model} onClick={() => model && void downloadReport(model)}>
            <FileDown size={15} aria-hidden />
            <span>{t('features.recorder.win.report')}</span>
          </button>
          <button type="button" className="btn btn--ghost rec-foot__close" onClick={closeRead}>
            <span>{t('features.recorder.read.close')}</span>
            <Kbd>Esc</Kbd>
          </button>
        </div>
      </Modal>
      {phone && model && sheet && model.data.places.has(sheet) && <DiffSheet model={model} p={sheet} onClose={() => setSheet(null)} />}
    </>
  )
}
