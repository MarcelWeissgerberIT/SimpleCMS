/**
 * "Auswerfen" (mock-2): the selected window planned as an eject — the bar "§ 02.14 Flugschreiber · Auswerfen" (the
 * action in the signal's ink) with the window; the eject keycap, "{ops} von {writer} auswerfen?" and what goes back /
 * is held and by whom; the plan (Schema · Ansichten · Seiten · Zeilen · Neue Zeilen · Gehalten · Ohne Vorher-Stand,
 * numbered over the groups present) beside the picked place (before → after → after the eject, the text word by word,
 * why it stays); the sources (open proposals, Preflight, coding tasks, the sync, Outbox slips); the footer: the version
 * first, ONE step back, "Abbrechen" (Esc), "Vorfallbericht", the primary "{n} Stellen zurücknehmen" (↵ only 300 ms
 * after the dialog opened — the key that opened it must not confirm it). A place that changed after planning: nothing
 * is written, the plan is computed again and said. Phone: a sheet, a second sheet per place, one primary key.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns3, Eject, FileDown, FileText, Hand, History, Rows3, SquareDashed, Table2, Trash2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Modal } from '../../../ui/Modal'
import { Kbd, shortcutLabel, Switch } from '../../../ui/controls'
import { scopeNow } from '../journal/scope'
import type { CoreInput, Plan, PlacePlan } from '../model/plan'
import { F, type EjectRecord, type PlaceKey, type WindowSel } from '../model/types'
import type { EjectRefusal } from '../eject/plan'
import type { CommitRefusal } from '../eject/commit'
import type { EjectFacts } from '../eject/sources'
import { readWindow, type ReadModel } from '../window/read'
import { DiffSheet } from './DiffSheet'
import { PlacePreview } from './PlacePreview'
import { PlaceList, placeTitle, rowParts, writerName, type ListGroup } from './PlanList'
import { decidedLines, heldByText, heldWhy } from './ejectText'
import { raiseEjectToast } from './ejectToast'
import { fmtDayShort, fmtNum, hm, hms, pl, unit, windowEnd } from './format'
import { say } from './live'
import { usePhone } from './phone'
import { downloadReport } from './report'
import { closeEject, pickEjectPlace, setLastEject, useRecorderUI, type LastHeld } from './state'
import { whoName } from './WindowPlate'
import { Bold, BOLD } from './bold'
import { rowLabel } from '../window/read'

/** ↵ confirms only this long after the dialog opened (a held key, the key that lifted the cover). */
const ENTER_GUARD_MS = 300

type GroupKind = 'schema' | 'views' | 'pages' | 'rows' | 'newRows' | 'held' | 'partial'
const ORDER: GroupKind[] = ['schema', 'views', 'pages', 'rows', 'newRows', 'held', 'partial']
const ICON = { schema: Table2, views: Columns3, pages: FileText, rows: Rows3, newRows: Trash2, held: Hand, partial: SquareDashed }
const BACK = new Set(['back', 'trash', 'restore'])

const kindOf = (x: PlacePlan, isNew: boolean): GroupKind | null => {
  if (x.outcome === 'already' || x.outcome === 'skip') return null
  if (x.outcome === 'held') return 'held'
  if (x.outcome === 'partial' || x.outcome === 'recreate') return 'partial'
  if (x.pk === 'schema') return 'schema'
  if (x.pk === 'view') return 'views'
  if (x.outcome === 'trash' || (isNew && x.pk === 'row')) return 'newRows'
  return x.pk === 'row' ? 'rows' : 'pages'
}

type Planned = { plan: Plan; input: CoreInput }

export function EjectDialog() {
  const t = useT()
  const lang = useLang()
  const phone = usePhone()
  const bracket = useRecorderUI((s) => s.bracket)
  const pick = useRecorderUI((s) => s.plan?.pick ?? null)
  const pages = useWorkspace((s) => s.pages)
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))
  const [planned, setPlanned] = useState<Planned | null>(null)
  const [model, setModel] = useState<ReadModel | null>(null)
  const [facts, setFacts] = useState<EjectFacts | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [replanned, setReplanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(true)
  const [sheet, setSheet] = useState<PlaceKey | null>(null)
  const openedAt = useRef(performance.now())
  const sel: WindowSel | null = useMemo(() => (bracket ? { scope: scopeNow(), lane: bracket.lane, ...(bracket.run ? { run: bracket.run } : {}), a: bracket.a, b: bracket.b } : null), [bracket])

  const refusal = (r: EjectRefusal | CommitRefusal) => t(`features.recorder.eject.${r.key}`, 'n' in r ? { n: fmtNum(r.n, lang) } : undefined)

  /** Plan the window (again), then read it for the previews (the plan settles the writer first: read after it). */
  const plan = async (again: boolean) => {
    if (!sel) return
    const [{ planEject }, src] = await Promise.all([import('../eject/plan'), import('../eject/sources')])
    const r = await planEject(sel)
    if ('refused' in r) {
      setRefused(refusal(r.refused))
      return
    }
    const m = await readWindow(sel, useRecorderUI.getState().ops.rev)
    const f = await src.facts(r).catch(() => null)
    setPlanned(r)
    setModel(m)
    setFacts(f)
    setReplanned(again)
    const first = r.plan.places.find((x) => BACK.has(x.outcome))?.p ?? r.plan.places[0]?.p ?? null
    const cur = useRecorderUI.getState().plan?.pick
    if (!cur || !r.plan.places.some((x) => x.p === cur)) pickEjectPlace(first)
    const c = r.plan.counts
    say(t('features.recorder.live.plan', { back: fmtNum(c.back, lang), all: fmtNum(c.all, lang), held: fmtNum(c.held, lang) }))
  }

  useEffect(() => {
    let off = false
    plan(false).catch((e) => {
      console.warn('[recorder] the eject could not be planned', e)
      if (!off) setRefused(t('features.recorder.eject.failed'))
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.lane, sel?.run, sel?.a, sel?.b])

  const names = model ? writerName(model, t, ws) : null
  const byPlace = useMemo(() => new Map(planned?.plan.places.map((x) => [x.p, x]) ?? []), [planned])

  // the plan's groups, in apply order
  const groups: ListGroup[] = useMemo(() => {
    if (!planned || !model || !names) return []
    const { plan, input } = planned
    const state = { pages, databases: ws.databases }
    const items = new Map<GroupKind, ListGroup['items']>()
    for (const x of plan.places) {
      const w = input.data.places.get(x.p)
      const kind = kindOf(x, !!(w && w.own[0].f & F.NEW))
      if (!kind) continue
      const read = model.groups.flatMap((g) => g.items).find((it) => it.p === x.p)
      const { key, title } = placeTitle(t, pages, model, { p: x.p, pk: x.pk, db: x.db })
      let meta = hm(x.span[0])
      let metaTitle: string | undefined
      let sub: string | null = null
      if (kind === 'held' || kind === 'partial') {
        const by = x.by[0]
        if (kind === 'held' && by) {
          meta = `${whoName(by.lane, t, ws, true)} ${hm(by.at)}`
          metaTitle = t('features.recorder.read.heldBy', { who: whoName(by.lane, t, ws), time: hm(by.at) })
        }
        sub = heldWhy(t, x, input, state, ws, names.writer)
      } else if (kind === 'schema' || kind === 'views') {
        meta = hms(x.span[0])
        sub = decidedLines(t, x, input, state).join(' · ') || null
      } else if (kind === 'pages') {
        if (read && (read.words[0] || read.words[1])) meta = `+${fmtNum(read.words[0], lang)} −${fmtNum(read.words[1], lang)}`
        sub = x.outcome === 'restore' ? t('features.recorder.eject.pageRestored') : x.hunks?.held ? t('features.recorder.eject.blocksBack', { back: fmtNum(x.hunks.back, lang), all: fmtNum(x.hunks.back + x.hunks.held, lang) }) : t('features.recorder.eject.pageBack', { time: hm(x.span[0]) })
      } else if (kind === 'rows') {
        const parts: string[] = []
        if (read?.values) parts.push(t(pl('features.recorder.read.values', read.values), { n: fmtNum(read.values, lang) }))
        if (read?.text) parts.push(t('features.recorder.read.textShort'))
        if (parts.length) meta = parts.join(' · ')
        sub = rowParts(t, model, ws.databases, x)
      } else sub = t('features.recorder.eject.newRowSub', { writer: names.writer })
      const list = items.get(kind) ?? items.set(kind, []).get(kind)!
      list.push({ p: x.p, icon: ICON[kind], key, title, meta, metaTitle, sub, held: kind === 'held' })
    }
    return ORDER.filter((k) => items.has(k)).map((k) => {
      const list = items.get(k)!
      const allRows = list.every((it) => byPlace.get(it.p)?.pk === 'row')
      const label = k === 'newRows' && !allRows ? t('features.recorder.read.group.trashed') : k === 'schema' || k === 'held' || k === 'partial' ? t(`features.recorder.eject.group.${k}`) : t(pl(`features.recorder.eject.group.${k}`, list.length))
      const act = k === 'newRows' ? t('features.recorder.eject.act.trash') : k === 'held' || k === 'partial' ? t('features.recorder.eject.act.stays') : t('features.recorder.eject.act.back')
      return { kind: k, label, act, held: k === 'held', items: list }
    })
  }, [planned, model, names, pages, ws, t, lang, byPlace])

  if (!bracket || !sel) return null
  const counts = planned?.plan.counts
  const no = t('features.recorder.no')
  const title = t('features.recorder.title')
  const range = `${hm(bracket.a)}–${hm(windowEnd(bracket))}`
  const heading = counts && names ? t('features.recorder.eject.title', { ops: unit(t, lang, 'ops', counts.ops), writer: names.writer }) : t('features.recorder.eject.label')
  const heldRowsOnly = !!planned && planned.plan.places.filter((x) => x.outcome === 'held').every((x) => x.pk === 'row')
  const placesText = counts ? unit(t, lang, 'places', counts.back) : ''
  const x = pick ? byPlace.get(pick) : undefined
  const why = x && names && planned && !BACK.has(x.outcome) ? heldWhy(t, x, planned.input, { pages, databases: ws.databases }, ws, names.writer) : undefined
  const slips = facts ? facts.slips.always + (discard ? facts.slips.pending : 0) : 0
  const notes: string[] = []
  if (facts) {
    if (facts.opened) notes.push(t(pl('features.recorder.eject.preflightOpened', facts.opened), { n: fmtNum(facts.opened, lang) }))
    if (facts.codingConfirm) notes.push(t(pl('features.recorder.eject.codingConfirm', facts.codingConfirm), { n: fmtNum(facts.codingConfirm, lang) }))
    if (facts.syncWriteBack) notes.push(t('features.recorder.eject.syncWriteBack'))
    if (slips) notes.push(t(pl('features.recorder.eject.slipsWithdraw', slips), { n: fmtNum(slips, lang) }))
    if (facts.slipsChanged) notes.push(t(pl('features.recorder.eject.slipsChanged', facts.slipsChanged), { n: fmtNum(facts.slipsChanged, lang) }))
    if (facts.reviewGone) notes.push(t('features.recorder.eject.reviewGone'))
  }
  const canConfirm = !!planned && !!counts?.back && !busy

  const confirm = async () => {
    if (!planned || !canConfirm || !names) return
    setBusy(true)
    setRefused(null)
    const { ejectNow } = await import('../eject/commit')
    const r = await ejectNow(sel, planned, { discardPending: discard, label: names.writer }).catch((e) => {
      console.warn('[recorder] the eject failed', e)
      return { refused: { key: 'writeRefused' as const } }
    })
    if ('replan' in r) {
      // a place changed after planning: nothing was written — the person sees the new plan and confirms again
      await plan(true).catch(() => setRefused(t('features.recorder.eject.failed')))
      setBusy(false)
      return
    }
    if ('refused' in r) {
      setBusy(false)
      setRefused(refusal(r.refused))
      return
    }
    done(r.record, planned)
  }

  /** The eject is written: the marks for the board, the dialog closes, then the toast and focus on "Auswurf zurücknehmen". */
  const done = (rec: EjectRecord, { plan, input }: Planned) => {
    const held: LastHeld[] = plan.places
      .filter((x) => x.outcome === 'held' && x.pk === 'row')
      .map((x) => {
        const w = input.data.places.get(x.p)
        const page = pages[x.p.slice(2)]
        const db = page?.databaseId ? ws.databases[page.databaseId] : undefined
        // the writer's values the row still carries: properties W touched that nobody touched since
        const own = new Set<string>()
        const foreign = new Set<string>()
        for (const g of w?.own ?? []) if (g.touched !== '*') for (const k of g.touched) own.add(k)
        for (const f of w?.foreign ?? []) if (f.touched !== '*') for (const k of f.touched) foreign.add(k)
        const props = (db?.properties ?? []).filter((p) => own.has(`p:${p.id}`) && !foreign.has(`p:${p.id}`)).map((p) => p.name)
        return { p: x.p, who: x.by[0]?.lane ?? null, whoLabel: whoName(x.by[0]?.lane ?? null, t, ws), at: x.by[0]?.at ?? x.span[1], label: rowLabel(page), props }
      })
    const options: string[] = []
    const dbIds = new Set<string>()
    for (const x of plan.places) {
      if (!BACK.has(x.outcome)) continue
      if (x.db) dbIds.add(x.db)
      if (x.pk === 'schema' || x.pk === 'view') dbIds.add(x.db ?? x.p.slice(2).split('/')[0])
      if (x.build?.kind !== 'db') continue
      const dbId = x.db ?? x.p.slice(2).split('/')[0]
      for (const g of x.build.groups) for (const d of g.decided) if (d.op === 'back' && d.part.startsWith('o:')) options.push(`o:${dbId}/${d.part.slice(2)}`)
    }
    setLastEject({ id: rec.id, at: rec.at, lane: rec.lane, ...(sel.run ? { run: sel.run } : {}), a: rec.a, b: rec.b, writer: names?.writer ?? '', outcomes: rec.outcomes, counts: rec.counts, versionAt: rec.versionAt, held, dbIds: [...dbIds], options })
    closeEject()
    const back = rec.counts.back
    const heldN = rec.counts.held
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        raiseEjectToast({ id: rec.id, back, held: heldN, writer: names?.writer ?? '', dbId: [...dbIds][0] ?? null })
        say(t('features.recorder.live.ejected', { places: unit(t, lang, 'places', back), writer: names?.writer ?? '', held: fmtNum(heldN, lang) }))
        window.setTimeout(() => document.querySelector<HTMLElement>('section.deck .dbtn--undo')?.focus({ preventScroll: true }), 30)
      }),
    )
  }

  // ↵ never confirms within 300 ms of opening (the key that lifted the cover, a held key)
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && performance.now() - openedAt.current < ENTER_GUARD_MS) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const heldN = counts?.held ?? 0
  return (
    <>
      <Modal open onClose={closeEject} bare width={980} className="rec-read rec-eject" ariaLabel={heading}>
        <div className="rec-ej" onKeyDownCapture={onKeyDownCapture}>
          <div className="rec-bar">
            <span className="label rec-bar__l rec-bar__l--eject">
              <span className="rec-bar__no">
                {no} {title} ·
              </span>
              <b>{t('features.recorder.eject.label')}</b>
            </span>
            <span className="rec-bar__sp" />
            <span className="label rec-bar__w">{t('features.recorder.eject.windowLabel', { day: fmtDayShort(t, lang, bracket.a), range })}</span>
            <button type="button" className="icon-btn rec-bar__x" onClick={closeEject} aria-label={t('features.recorder.read.close')} title={t('features.recorder.read.close')}>
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="rec-head rec-head--eject">
            <span className="ej-icon" aria-hidden="true">
              <Eject />
            </span>
            <div className="rec-head__t">
              <h2 className="rec-title" data-modal-title>
                {heading}
              </h2>
              {counts && names && (
                <p className="rec-sub">
                  {heldN > 0 ? (
                    <Bold text={t('features.recorder.eject.sub', { places: BOLD, run: names.run, held: BOLD, heldBy: heldByText(t, planned!.plan.heldBy, ws, heldN) })} bold={[placesText, t(pl(heldRowsOnly ? 'features.recorder.eject.heldPart' : 'features.recorder.eject.heldPlaces', heldN), { n: fmtNum(heldN, lang) })]} />
                  ) : (
                    <Bold text={t('features.recorder.eject.subNoHeld', { places: BOLD, run: names.run })} bold={placesText} />
                  )}
                  {counts.partial > 0 && <> {t('features.recorder.eject.partial', { n: unit(t, lang, 'places', counts.partial) })}</>}
                </p>
              )}
              {replanned && (
                <p className="rec-sub rec-sub--replanned" role="status" data-replanned>
                  {t('features.recorder.eject.replanned')}
                </p>
              )}
              {refused && (
                <p className="rec-sub rec-sub--refused" role="alert">
                  {refused}
                </p>
              )}
            </div>
          </div>
          <div className="rec-body">
            {planned && model ? (
              <>
                <PlaceList groups={groups} pick={pick} onPick={pickEjectPlace} onOpen={(p) => setSheet(p)} phone={phone} aria={t('features.recorder.eject.planAria')} hint={t('features.recorder.eject.hint')} autoFocus={false} />
                {!phone && <div className="rec-prev">{pick && model.data.places.has(pick) && x ? <PlacePreview model={model} p={pick} variant="eject" eject={{ x, ...(why ? { why } : {}) }} /> : null}</div>}
              </>
            ) : (
              <p className="rec-wait" role="status">
                {refused ?? t('features.recorder.eject.planning')}
              </p>
            )}
          </div>
          {facts && (facts.pending > 0 || notes.length > 0) && (
            <div className="ej-opts">
              {facts.pending > 0 && (
                <label className="ej-opts__sw">
                  <Switch size="sm" seed="eject-pending" checked={discard} onChange={setDiscard} label={t('features.recorder.eject.discardPending', { n: fmtNum(facts.pending, lang) })} />
                  <span aria-hidden="true">{t('features.recorder.eject.discardPending', { n: fmtNum(facts.pending, lang) })}</span>
                </label>
              )}
              {notes.map((n) => (
                <p key={n} className="ej-opts__note">
                  {n}
                </p>
              ))}
            </div>
          )}
          <div className="rec-foot rec-foot--eject">
            <span className="rec-foot__note ej-note">
              <History size={14} aria-hidden />
              <span>
                <Bold text={t('features.recorder.eject.note', { one: BOLD })} bold={t('features.recorder.eject.noteOne')} />
              </span>
              <Kbd>{shortcutLabel('Mod+Z')}</Kbd>
            </span>
            <span className="rec-foot__sp" />
            <button type="button" className="btn btn--ghost rec-foot__close" onClick={closeEject}>
              <span>{t('features.recorder.eject.cancel')}</span>
              <Kbd>Esc</Kbd>
            </button>
            <button type="button" className="btn rec-foot__report" disabled={!model} onClick={() => model && void downloadReport(model)}>
              <FileDown size={15} aria-hidden />
              <span>{t('features.recorder.eject.report')}</span>
            </button>
            <button type="button" className="btn btn--primary btn--eject" data-autofocus disabled={!canConfirm} aria-busy={busy || undefined} onClick={() => void confirm()}>
              <Eject size={16} strokeWidth={2} aria-hidden />
              <span>{counts ? t('features.recorder.eject.confirm', { places: placesText }) : t('features.recorder.eject.confirmShort')}</span>
              <Kbd>↵</Kbd>
            </button>
          </div>
        </div>
      </Modal>
      {phone && model && sheet && model.data.places.has(sheet) && byPlace.get(sheet) && (
        <DiffSheet model={model} p={sheet} onClose={() => setSheet(null)} eject={{ x: byPlace.get(sheet)!, ...(names && planned && !BACK.has(byPlace.get(sheet)!.outcome) ? { why: heldWhy(t, byPlace.get(sheet)!, planned.input, { pages, databases: ws.databases }, ws, names.writer) } : {}) }} />
      )}
    </>
  )
}
