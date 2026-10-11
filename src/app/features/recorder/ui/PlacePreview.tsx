/**
 * One place of a read window: its key and title, its meta row (W's Vorgänge on it and when · the state it reads from
 * · who changed it since), the property values before → after (rows) and the text word by word — both in ink inside
 * `.rec-diff`. Changes another writer made inside W's span are tagged "contains changes by …", never taken for W's;
 * an after-state that is not exactly what W left says so. Schema and view places: what W did, by name. A place this
 * device cannot show is said, nothing is loaded. `variant`: 'read' (R2); the eject's third column comes with R3.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Hand, Info, Undo2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { DocDiff, itemBlockId } from '../../history/DiffDoc'
import { PropsDiff, PropsTriple, metaChangeCount, type PropFate } from '../../history/PropsDiff'
import { diffDocs, itemsWordCounts, type DocItem } from '../../history/docDiff'
import type { PlaceKey } from '../model/types'
import type { PlacePlan } from '../model/plan'
import { placeDiff, rowLabel, type ForeignNote, type PlaceDiff, type ReadModel } from '../window/read'
import { deltaLine } from '../window/report'
import { fmtNum, hm, hms, hmsSpan } from './format'
import { writerName } from './PlanList'
import { Bold, BOLD } from './bold'
import { whoName } from './WindowPlate'

/** Diffs read per window (a place picked again is drawn at once). */
const cache = new WeakMap<ReadModel, Map<PlaceKey, Promise<PlaceDiff>>>()
function diffOf(model: ReadModel, p: PlaceKey): Promise<PlaceDiff> {
  let m = cache.get(model)
  if (!m) cache.set(model, (m = new Map()))
  let d = m.get(p)
  if (!d) {
    d = placeDiff(model, p)
    m.set(p, d)
    d.catch(() => m!.delete(p))
  }
  return d
}

/** The eject's view of a place: its plan (the third column, the outcome) and why it stays (held / partial). */
export interface EjectView {
  x: PlacePlan
  why?: string
}

export function PlacePreview({ model, p, variant = 'read', stacked = false, eject }: { model: ReadModel; p: PlaceKey; variant?: 'read' | 'eject'; stacked?: boolean; eject?: EjectView }) {
  const t = useT()
  const lang = useLang()
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))
  const page = useWorkspace((s) => s.pages[p.slice(2)])
  const db = useWorkspace((s) => s.pages[model.data.places.get(p)?.db ?? ''])
  const [state, setState] = useState<{ p: PlaceKey; d: PlaceDiff | null; failed?: boolean } | null>(null)
  const verdict = model.verdicts.get(p)
  const unavailable = verdict?.reason === 'unavailable'

  useEffect(() => {
    if (unavailable) return
    let off = false
    diffOf(model, p)
      .then((d) => !off && setState({ p, d }))
      .catch((e) => {
        console.warn('[recorder] a place could not be read', e)
        if (!off) setState({ p, d: null, failed: true })
      })
    return () => {
      off = true
    }
  }, [model, p, unavailable])

  const { writer, run } = writerName(model, t, ws)
  const d = state && state.p === p ? state.d : null
  const items: DocItem[] = useMemo(() => (d && (d.pk === 'page' || d.pk === 'db' || d.pk === 'row') ? diffDocs(d.before?.content ?? null, d.after?.content ?? null) : []), [d])
  const words = useMemo(() => itemsWordCounts(items), [items])
  const changed = items.some((it) => it.kind !== 'same')

  if (!verdict) return null
  const isRow = verdict.pk === 'row'
  const id = p.slice(2)
  const title = verdict.pk === 'schema' || verdict.pk === 'view' ? t('features.recorder.read.schemaItem', { db: db?.title || t('features.recorder.report.untitled') }) : (page?.title ?? '') || t('features.recorder.report.untitled')
  const key = isRow && page ? rowLabel(page) : null
  const since = verdict.by.filter((b) => b.at > verdict.span[1])
  const who = (n: ForeignNote) => `${whoName(n.lane, t, ws, true)} ${hm(n.at)}`
  // "Stand vor {writer} · {time}": the words before the writer are the cell's label (the eject: "Zurück auf:")
  const before = t('features.recorder.read.before', { writer: '\u0001', time: hms(verdict.span[0]) })
  const cut = Math.max(0, before.indexOf('\u0001'))
  const x = variant === 'eject' ? eject?.x : undefined
  const goesBack = !!x && (x.outcome === 'back' || x.outcome === 'trash' || x.outcome === 'restore')
  const blockTag = (it: DocItem) => {
    const bid = itemBlockId(it)
    const notes = d?.interleaved.filter((n) => n.blocks !== '*' && !!bid && n.blocks.includes(bid)) ?? []
    return notes.length ? (
      <span className="rec-tag label" data-foreign>
        {t('features.recorder.win.interleaved', { who: notes.map(who).join(', '), time: '' }).trim()}
      </span>
    ) : null
  }
  const propTag = (prop: string) => {
    const notes = d?.interleaved.filter((n) => n.props !== '*' && n.props.includes(prop)) ?? []
    return notes.length ? t('features.recorder.win.interleaved', { who: notes.map(who).join(', '), time: '' }).trim() : undefined
  }
  const wide = d?.interleaved.filter((n) => n.blocks === '*' && n.props === '*') ?? []

  return (
    <section className={`prev${stacked ? ' prev--stacked' : ''}`} aria-label={key ? `${key} · ${title}` : title} data-variant={variant} data-place={p}>
      <div className="prev__h">
        {key && key !== title && <span className="prev__key">{key}</span>}
        <span className="prev__t">{title}</span>
      </div>
      <div className="prev__meta">
        <div className="prev__cells">
          <span>
            <span className="label">{t('features.recorder.read.meta.ops')}</span>
            <b>
              {fmtNum(verdict.ops, lang)} · {hmsSpan(verdict.span[0], verdict.span[1])}
            </b>
          </span>
          {x ? (
            <span>
              <span className="label">{t('features.recorder.eject.meta.backTo')}</span>
              <b>{before.replace('\u0001', run)}</b>
            </span>
          ) : (
            <span>
              {cut > 0 && <span className="label">{before.slice(0, cut).trim()}</span>}
              <b>{before.slice(cut).replace('\u0001', run)}</b>
            </span>
          )}
          <span>
            <span className="label">{t('features.recorder.read.meta.changedSince')}</span>
            <b>{since.length ? since.map((b) => `${whoName(b.lane, t, ws, true)} ${hm(b.at)}`).join(', ') : t('features.recorder.read.nobody')}</b>
          </span>
        </div>
      </div>
      {unavailable ? (
        <p className="prev__note">
          <Info aria-hidden />
          <span>{t('features.recorder.read.unavailable')}</span>
        </p>
      ) : state?.failed ? (
        <p className="prev__note">
          <Info aria-hidden />
          <span>{t('features.recorder.read.failed')}</span>
        </p>
      ) : !d ? (
        <p className="prev__note prev__note--wait">{t('features.recorder.read.loading')}</p>
      ) : (
        <>
          {d.isNew && <p className="prev__note">{t('features.recorder.read.newPlace', { writer })}</p>}
          {d.gone && <p className="prev__note">{t('features.recorder.read.gone')}</p>}
          {!d.afterExact && (d.pk === 'row' || d.pk === 'page' || d.pk === 'db') && (
            <p className="prev__note" data-approx>
              <Info aria-hidden />
              <span>{t('features.recorder.win.afterApprox')}</span>
            </p>
          )}
          {wide.map((n) => (
            <p key={`${n.lane}|${n.at}`} className="prev__note" data-foreign>
              <Info aria-hidden />
              <span>{t('features.recorder.read.foreignAll', { who: whoName(n.lane, t, ws, true), time: hm(n.at) })}</span>
            </p>
          ))}
          {d.schema && (
            <div className="box">
              <div className="box__h">
                <span className="label">{t('features.recorder.report.schema')}</span>
              </div>
              <ul className="prev__lines">
                {d.schema.map((l, i) => (
                  <li key={i}>
                    <span>{deltaLine(t, l.delta)}</span>
                    <span className="prev__lt mono">{hms(l.at)}</span>
                    {l.there !== null && <span className="prev__now">{t('features.recorder.read.x.now', { state: t(l.there ? 'features.recorder.read.x.there' : 'features.recorder.read.x.gone') })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isRow && d.before && d.after && page && x && (
            <div className="box rec-diff">
              <div className="box__h">
                <span className="label">{t('features.recorder.eject.props', { n: fmtNum(metaChangeCount(d.before, page, d.after), lang) })}</span>
                <span className="box__sp" />
                <span className="label box__r">{t('features.recorder.eject.propsNote', { run })}</span>
              </div>
              <div className="box__b">
                <PropsTriple before={d.before} after={d.after} page={page} outcome={(goesBack ? (x.fates ?? {}) : {}) as Record<string, PropFate>} head={t('features.recorder.eject.colChange', { run })} tagOf={propTag} />
              </div>
            </div>
          )}
          {isRow && d.before && d.after && page && !x && (
            <div className="box rec-diff">
              <div className="box__h">
                <span className="label">{t('features.recorder.read.props', { n: fmtNum(metaChangeCount(d.before, page, d.after), lang) })}</span>
                <span className="box__sp" />
                <span className="label box__r">{t('features.recorder.read.colChange', { writer: run })}</span>
              </div>
              <div className="box__b">
                <PropsDiff body={d.before} page={page} after={d.after} tagOf={propTag} />
              </div>
            </div>
          )}
          {(d.pk === 'page' || d.pk === 'db' || (isRow && changed)) && (
            <div className="box rec-diff">
              <div className="box__h">
                <span className="label">{t('features.recorder.read.text', { add: fmtNum(words.add, lang), del: fmtNum(words.del, lang) })}</span>
                <span className="box__sp" />
                <span className="label box__r">{t('features.recorder.read.wordByWord')}</span>
              </div>
              <div className="box__b wd">{changed ? <DocDiff items={items} variant="plain" context={2} note={blockTag} /> : <p className="prev__note">{t('features.recorder.read.noChange')}</p>}</div>
              {x && goesBack && changed && (
                <div className="wd__cap">
                  <Undo2 aria-hidden />
                  <span>
                    <Bold text={t('features.recorder.eject.textCaption', { bold: BOLD })} bold={t('features.recorder.eject.textCaptionBold')} />
                  </span>
                </div>
              )}
            </div>
          )}
          {x && (!goesBack || verdict.pk === 'row' || verdict.pk === 'page' || verdict.pk === 'db') && (
            <p className="prev__foot" data-outcome={x.outcome}>
              {goesBack ? <Check aria-hidden /> : <Hand aria-hidden />}
              <span>{x.outcome === 'trash' ? t('features.recorder.eject.newRowSub', { writer }) : goesBack ? t(isRow ? 'features.recorder.eject.rowWhole' : 'features.recorder.eject.pageWhole', { run }) : (eject?.why ?? '')}</span>
            </p>
          )}
        </>
      )}
      <span hidden data-page={id} />
    </section>
  )
}
