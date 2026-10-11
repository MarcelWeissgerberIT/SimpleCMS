/**
 * The plate after an eject (mock-3, `.win--out`): "Fenster 07:30–07:35" · "Ausgeworfen 08:05" (ink, not orange); the
 * writer; what happened — STELLEN "35 von 37 zurückgenommen", ZURÜCK "1 Schema · 1 Seite · 30 Zeilen", PAPIERKORB
 * "3 neue Zeilen", GEHALTEN "1408 (du) · 1415 (du)" (the deck's signal text), VERSION "„Vor dem Auswurf“ · 08:05:20";
 * a note (an ink triangle — the held diamond means held places only); "{writer} öffnen", "Vorfallbericht" and the wide
 * "Auswurf zurücknehmen" (Ctrl+Z / ⌘Z while the toast shows). Shown whenever the bracket is a window a live eject took
 * back — across reopening the deck; an eject this deck just made shows at once (its record follows).
 */
import { useEffect, useState } from 'react'
import { Bot, FileCode, FileDown, TriangleAlert, Undo2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { agentNextRunAt } from '../../agents'
import { Kbd, shortcutLabel } from '../../../ui/controls'
import type { EjectRecord, JRun } from '../model/types'
import type { HeldMark, ReadModel } from '../window/read'
import { getEject } from '../eject/records'
import { scopeNow } from '../journal/scope'
import { backParts } from './ejectText'
import { runEjectUndo } from './ejectToast'
import { fmtDayShort, fmtNum, hm, hms, pl, windowEnd } from './format'
import type { LaneMeta } from './lanes'
import { setBracket, setLastEject, useRecorderUI, type Bracket, type LastEject } from './state'
import { whoName } from './WindowPlate'
import { Bold, BOLD } from './bold'

/** The plate's view of an eject: its record, or (just made, its record on the way) what the deck remembers. */
export type AfterSource = { rec: EjectRecord; last?: undefined } | { rec?: undefined; last: LastEject }

export function AfterPlate({ src, bracket, meta, run, model, heldMarks }: { src: AfterSource; bracket: Bracket; meta: LaneMeta; run: JRun | undefined; model: ReadModel | null; heldMarks: HeldMark[] }) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))
  const id = src.rec?.id ?? src.last!.id
  const at = src.rec?.at ?? src.last!.at
  const counts = src.rec?.counts ?? src.last!.counts
  const outcomes = src.rec?.outcomes ?? src.last!.outcomes
  const versionAt = src.rec?.versionAt ?? src.last!.versionAt
  // a remembered eject whose record is no longer on the tape (pruned with its day): its Undo is off
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (src.rec) return setGone(false)
    let off = false
    const check = () =>
      void getEject(id).then((r) => {
        if (!off) setGone(!r)
      })
    // the record is written a moment after the store update: look again shortly
    const timer = window.setTimeout(check, 1500)
    return () => {
      off = true
      window.clearTimeout(timer)
    }
  }, [id, src.rec])

  const parts = backParts({ outcomes }, pages)
  const n = (v: number) => fmtNum(v, lang)
  const backList: Array<[string, number]> = (
    [
      ['features.recorder.win.out.partSchema', parts.schema],
      ['features.recorder.win.out.partViews', parts.views],
      ['features.recorder.win.out.partPages', parts.pages],
      ['features.recorder.win.out.partRows', parts.rows],
    ] as Array<[string, number]>
  ).filter(([, v]) => v > 0)
  const held = heldMarks.length ? heldMarks : (src.last?.held ?? []).map((h) => ({ p: h.p, at: h.at, label: h.label, lane: h.who }))
  const Icon = meta.icon
  const seq = run?.meta?.seq
  const kind = bracket.lane.split(':')[0]
  const refId = bracket.lane.split(':')[1]
  const agent = kind === 'agent' && refId ? ws.agents?.[refId] : undefined
  const next = agent ? agentNextRunAt(agent) : null
  const note = next ? t('features.recorder.win.out.next', { when: `${fmtDayShort(t, lang, next)} ${hm(next)}` }) : held.length ? t('features.recorder.win.out.heldNote', { writer: meta.title }) : null
  const openKey = kind === 'agent' && agent ? { label: t('features.recorder.win.out.openAgent'), icon: Bot, go: () => navigate(`#/agents/${agent.id}`) } : kind === 'script' && !!refId && !!ws.scripts?.[refId] ? { label: t('features.recorder.win.out.openScript'), icon: FileCode, go: () => navigate(`#/scripts/${refId}`) } : null
  const report = async () => {
    if (!model) return
    const { downloadReport } = await import('./report')
    await downloadReport(model, src.rec)
  }
  const undo = () => {
    void runEjectUndo(id).then(() => {
      if (useRecorderUI.getState().lastEject?.id === id) setLastEject(null)
    })
  }

  return (
    <aside className="win win--out" aria-label={t('features.recorder.win.out.aria')} data-eject={id}>
      <div className="win__h">
        <span className="label">{t('features.recorder.win.out.window', { range: `${hm(bracket.a)}–${hm(windowEnd(bracket))}` })}</span>
        <span className="win__t win__t--out">{t('features.recorder.win.out.at', { time: hm(at) })}</span>
        <button type="button" className="win__x" aria-label={t('features.recorder.win.clear')} title={t('features.recorder.win.clear')} onClick={() => setBracket(null)}>
          <X aria-hidden />
        </button>
      </div>
      <div className="win__who" title={meta.title}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{meta.title}</span>
        {seq ? <small>{t('features.recorder.win.run', { n: seq })}</small> : null}
      </div>
      <ul className="outlist">
        <li>
          <span className="outlist__k">{t('features.recorder.win.out.places')}</span>
          <span>
            <Bold text={t('features.recorder.win.out.placesVal', { back: BOLD, all: n(counts.all) })} bold={n(counts.back)} />
          </span>
        </li>
        {backList.length > 0 && (
          <li>
            <span className="outlist__k">{t('features.recorder.win.out.back')}</span>
            <span>
              {backList.map(([key, v], i) => (
                <span key={key}>
                  {i > 0 && ' · '}
                  <Bold text={t(pl(key, v), { n: BOLD })} bold={n(v)} />
                </span>
              ))}
            </span>
          </li>
        )}
        {parts.trash > 0 && (
          <li>
            <span className="outlist__k">{t('features.recorder.win.out.trash')}</span>
            <span>
              <Bold text={t(pl('features.recorder.win.out.trashVal', parts.trash), { n: BOLD })} bold={n(parts.trash)} />
            </span>
          </li>
        )}
        <li className="outlist__held" data-held-list>
          <span className="outlist__k">{t('features.recorder.win.out.held')}</span>
          <span>{held.length ? held.map((h) => `${h.label} (${whoName(h.lane, t, ws)})`).join(' · ') : t('features.recorder.win.out.heldNone')}</span>
        </li>
        <li className="outlist__version">
          <span className="outlist__k">{t('features.recorder.win.out.version')}</span>
          <span>{t('features.recorder.win.out.versionVal', { name: t('features.history.reason.eject'), time: hms(versionAt) })}</span>
        </li>
      </ul>
      {note && (
        <div className="win__note win__note--out">
          <TriangleAlert aria-hidden />
          <span>{note}</span>
        </div>
      )}
      <div className="win__keys">
        {openKey && (
          <button type="button" className="dbtn dbtn--open" onClick={openKey.go}>
            <openKey.icon aria-hidden />
            <span>{openKey.label}</span>
          </button>
        )}
        <button type="button" className="dbtn dbtn--outreport" disabled={!model} onClick={() => void report()}>
          <FileDown aria-hidden />
          <span>{t('features.recorder.win.out.report')}</span>
        </button>
      </div>
      <button type="button" className="dbtn dbtn--wide dbtn--undo" disabled={gone || scopeNow() !== (src.rec?.s ?? scopeNow())} title={gone ? t('features.recorder.win.out.gone') : undefined} onClick={undo}>
        <Undo2 aria-hidden />
        <span>{gone ? t('features.recorder.win.out.gone') : t('features.recorder.win.out.undo')}</span>
        {!gone && <Kbd>{shortcutLabel('Mod+Z')}</Kbd>}
      </button>
    </aside>
  )
}
