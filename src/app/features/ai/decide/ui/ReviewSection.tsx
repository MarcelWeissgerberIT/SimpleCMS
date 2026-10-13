/**
 * Section 06 "Prüfen" of the agent editor (slice SJ, § 5.4): the Vorprüfung (Jev pre-checks every proposal — switch, the
 * Vorprüfer chip with its Jev versions (Alt+M), "mark below 0,70", "On concerns: Mark only | Hold back"), the
 * Schreibschranke (an apply-mode run writes only when every check is at or above "0,90" — else the whole run waits), the
 * calibration readout of this device's runs and, when Jev answered with another snapshot than the one confirmed, "new
 * version" + Confirm. It edits the editor's draft: `review` v2 `{ v: 2, decider?, on, pre, gate? }` — never a top-level
 * `route`; switching the Vorprüfung off removes it. `on` = the snapshot the person chose (the catalogue's dated slug).
 * Nothing is on by default; the start values are named "Start values" until the owner's calibration. Server agents:
 * disabled (decisions reach the server later). The catalogue is read only when OpenRouter is set up or the agent has a
 * Vorprüfer — a Claude-only person's editor sends nothing.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLang, useT } from '../../../../i18n'
import { useWorkspace } from '../../../../store/store'
import type { CustomAgent } from '../../../../store/types'
import { Switch } from '../../../../ui/controls'
import { Menu, useMenu } from '../../../../ui/Menu'
import { onRovingKey } from '../../../../ui/roving'
import { decisionChecks, type AgentReviewV2 } from '@/shared/ai/route'
import type { Route } from '@/shared/ai/types'
import { refusedClasses } from '@/shared/ai/policy'
import { JEV_CALIBRATED, JEV_DEFAULTS, isJevModel, jevLabel, jevSnapshotDay, newestJev, sameJevSnapshot } from '@/shared/ai/jev'
import { hasAIKey } from '../../../../store/secrets'
import { deciderRoute } from '../../core/gate'
import { isRouteKey } from '../../routing/keys'
import type { AgentRun } from '../../../agents/types'
import { Stepper } from './Stepper'
import { fmtP } from './JevLine'
import { onKeyOf, perCheck, pickerEntries, rowOf, snapshotDate, useDecisionRows } from './picker'
import '../decide.css'

type Checks = Omit<AgentReviewV2, 'v'>
const DAY = 86_400_000

/** The stored review v2 of a draft's settings (one place builds it — never a top-level `route`). */
export const reviewOf = (c: Checks): AgentReviewV2 => ({ v: 2, ...(c.decider ? { decider: c.decider } : {}), on: c.on, pre: { markBelow: c.pre.markBelow, hold: c.pre.hold }, ...(c.gate !== undefined ? { gate: c.gate ? { allowAt: c.gate.allowAt } : null } : {}) })

/** Does the agent read text from outside — mails, MCP results — or start on rows it did not write (form answers, mails)? */
function readsForeign(d: CustomAgent, s: ReturnType<typeof useWorkspace.getState>): boolean {
  if (d.mcpServers?.length || d.trigger.type === 'row_created') return true
  const mail = new Set<string>(Object.values(s.databases).filter((db) => db.system === 'mails' || db.system?.startsWith('mail-')).map((db) => db.id))
  if (s.settings.mail?.databaseId) mail.add(s.settings.mail.databaseId)
  if (!mail.size) return false
  if (d.scope.everything) return true
  return d.scope.databases.some((id) => mail.has(id)) || [...mail].some((id) => d.scope.pages.some((p) => isBelow(s.pages, id, p)))
}

const isBelow = (pages: ReturnType<typeof useWorkspace.getState>['pages'], id: string, root: string): boolean => {
  let cur: string | null | undefined = id
  for (let i = 0; cur && i < 64; i++) {
    if (cur === root) return true
    cur = pages[cur]?.parentId
  }
  return false
}

/** `runs`: the agent's runs on this device (newest first; the editor loads them) — calibration and "new version". */
export function ReviewSection({ d, set, saved, runs }: { d: CustomAgent; set: (p: Partial<CustomAgent>) => void; saved: CustomAgent | null; runs: readonly AgentRun[] | undefined }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const read = decisionChecks(d)
  const checks = read && read !== 'unreadable' ? read : null
  const on = !!checks
  const server = d.runner === 'server'
  // the keys and the rules (device, workspace): they decide the Vorprüfer when the agent names none
  const orKey = useWorkspace((s) => !!s.settings.aiKeys?.openrouter && hasAIKey('openrouter'))
  const ws = useWorkspace((s) => s.ai)
  const device = useWorkspace((s) => s.settings.ai)
  const foreign = useWorkspace((s) => readsForeign(d, s))
  // the catalogue: only for someone with OpenRouter or an agent with a Vorprüfer (a Claude-only editor reads nothing)
  const rowsOn = !server && (orKey || on)
  const { rows, state } = useDecisionRows(rowsOn)
  const loading = rowsOn && (state === 'idle' || state === 'loading')
  const resolved = deciderRoute(checks?.decider ?? null)
  const inherited = deciderRoute(null)
  const current = checks?.decider?.m ?? (resolved.route && isJevModel(resolved.route.m) ? resolved.route.m : null)
  const row = rowOf(rows, current)
  const menu = useMenu()
  const chip = useRef<HTMLButtonElement>(null)

  const calib = useMemo(() => {
    const since = Date.now() - 30 * DAY
    const n = { checked: 0, marked: 0, applied: 0, discarded: 0, wrong: 0 }
    for (const r of runs ?? []) {
      if (r.startedAt < since) continue
      for (const c of r.staged ?? []) {
        if (c.jev?.state !== 'ok') continue
        n.checked++
        if (c.jev.mark) {
          n.marked++
          if (c.status === 'applied') n.applied++
          if (c.status === 'discarded') n.discarded++
        } else if (c.status === 'discarded' && c.reason === 'wrong') n.wrong++
      }
    }
    return n
  }, [runs])
  const newer = useMemo(() => {
    if (!checks) return null
    const newest = (runs ?? []).find((r) => r.status !== 'running' && (r.jev?.n ?? 0) > 0)
    const to = newest?.jev?.changedTo
    return to && !sameJevSnapshot(checks.on, to) ? to : null
  }, [runs, checks])

  const write = (next: Checks | null) => set({ review: next ? reviewOf(next) : null })
  // `on` is the catalogue's (dated) snapshot of the version (DJ19): the switch, a pick and Confirm wait until its row is
  // read — never an undated stamp from a catalogue still loading (a run would then take any snapshot of that version)
  const via = inherited.route && isJevModel(inherited.route.m) ? inherited.route.m : null
  const pickNow = via ?? sortedFirst(rows)
  const pickRow = rowOf(rows, pickNow)
  // switching on: the agent's own Jev when the rules name none (choosing it is the consent); `on` = its snapshot now —
  // pressed while the catalogue is still being read, it switches on as soon as the version's row is there (or not at all)
  const turnOn = () => {
    if (!pickNow || !pickRow) return
    write({ ...(via ? {} : { decider: { p: 'openrouter', m: pickNow } as Route }), on: onKeyOf(rows, pickNow), pre: { markBelow: JEV_DEFAULTS.markBelow, hold: true } })
  }
  const [wantOn, setWantOn] = useState(false)
  useEffect(() => {
    if (!wantOn) return
    if (on) setWantOn(false)
    else if (pickRow) {
      setWantOn(false)
      turnOn()
    } else if (!loading) setWantOn(false)
    // turnOn reads this render's rows: the effect runs again when they change
  }, [wantOn, on, pickRow, loading])
  const pickDecider = (id: string | null) => {
    if (!checks) return
    const m = id ?? via
    if (!m || !rowOf(rows, m)) return
    write({ ...checks, ...(id ? { decider: { p: 'openrouter', m: id } as Route } : { decider: undefined }), on: onKeyOf(rows, m) })
  }
  const [confirmed, setConfirmed] = useState(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  // what Confirm writes: the snapshot that answered (dated), else — the rules resolve another version — its catalogue row's
  const nextOn = newer ? (jevSnapshotDay(newer) ? `openrouter:${newer}` : rowOf(rows, newer) ? onKeyOf(rows, newer) : null) : null
  const confirmNew = () => {
    if (!checks || !nextOn) return
    write({ ...checks, on: nextOn })
    // the stored agent too: the lamp and the next run take it at once (the draft keeps it for Save)
    const s = useWorkspace.getState()
    const stored = saved ? s.agents?.[saved.id] : null
    const storedChecks = stored ? decisionChecks(stored) : null
    if (stored && storedChecks && storedChecks !== 'unreadable') s.upsertAgent({ ...stored, review: reviewOf({ ...storedChecks, on: nextOn }) })
    setConfirmed(true)
    // the key goes away: the focus to the Vorprüfer chip (the live region says it was confirmed)
    requestAnimationFrame(() => (chip.current ?? statusRef.current)?.focus())
  }

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (on && !server && isRouteKey(e.nativeEvent)) {
      e.preventDefault()
      if (chip.current) menu.openAt(chip.current)
    }
  }

  const ids = { pre: `${uid}-pre`, gate: `${uid}-gate`, gateWhy: `${uid}-gatewhy`, hint: `${uid}-hint`, start: `${uid}-start`, server: `${uid}-server`, noRoute: `${uid}-noroute`, wait: `${uid}-wait` }
  const apply = d.write === 'apply'
  const gateActive = on && apply && !server
  const gateOn = gateActive && !!checks?.gate
  // what Jev reads — and whether the data rule lets it through to OpenRouter
  const refused = refusedClasses('openrouter', ['rows', 'page'], ws, device)
  const noRoute = !resolved.route
  const everyRunWaits = gateOn && (noRoute || resolved.code !== null || refused.length === 2)
  const inheritLabel = inherited.route && isJevModel(inherited.route.m) ? t('features.ai.jev.ed.inherit', { model: jevLabel(inherited.route.m) }) : t('features.ai.jev.ed.inheritNone')
  // why the switch cannot be turned on (read out with it): a server agent · no OpenRouter · the version's row not read
  // (a read still going on keeps it pressable: it switches on once the row is there)
  const showNoRoute = !on && !server && (!inherited.route || !orKey)
  const rowsWait = !on && !server && orKey && !pickRow
  const preOff = server || (!on && !pickRow && !(loading && (!!via || orKey)))
  const waitText = state === 'failed' ? t('features.ai.jev.ed.rowsMissing') : state === 'ready' ? t('features.ai.jev.pick.empty') : t('features.ai.jev.pick.loading')
  const preWhy = [server ? ids.server : '', showNoRoute ? ids.noRoute : '', rowsWait ? ids.wait : ''].filter(Boolean).join(' ')

  if (read === 'unreadable')
    return (
      <p className="agx-note" data-testid="jev-ed-unreadable">
        {t('features.ai.jev.ed.unreadable')}
      </p>
    )

  return (
    <div className="jev-ed" onKeyDown={onKey} data-testid="jev-ed">
      {server && (
        <p className="agx-note" id={ids.server} data-testid="jev-ed-server">
          {t('features.ai.jev.ed.server')}
        </p>
      )}
      {/* ------------------------------------------------ VORPRÜFUNG */}
      <div className="jev-ed__row" data-row="pre">
        <span className="jev-ed__label label" id={ids.pre}>
          {t('features.ai.jev.ed.pre')}
        </span>
        <div className="jev-ed__body">
          <div className="jev-ed__line">
            <Switch
              size="sm"
              seed={`jev-pre-${d.id}`}
              checked={on}
              onChange={(v) => {
                if (!v) {
                  setWantOn(false)
                  write(null)
                } else if (pickRow) turnOn()
                else setWantOn(true)
              }}
              label={t('features.ai.jev.ed.pre')}
              disabled={preOff}
              describedBy={preOff && preWhy ? `${preWhy} ${ids.hint}` : ids.hint}
            />
            {on && !server && (
              <button
                ref={chip}
                type="button"
                className="jev-chip"
                onClick={menu.toggle}
                aria-haspopup="menu"
                aria-expanded={menu.open}
                aria-label={t('features.ai.jev.ed.chipAria', { model: current ? jevLabel(current) : '—' })}
                aria-keyshortcuts="Alt+M"
                title={`${t('features.ai.jev.role')} · Alt+M`}
                data-testid="jev-chip"
              >
                <span className="jev-chip__plate" aria-hidden>
                  OR
                </span>
                <span className="jev-chip__model">{current ? jevLabel(current) : '—'}</span>
                <span className="jev-chip__role">{t('features.ai.jev.role')}</span>
                <span aria-hidden>▾</span>
              </button>
            )}
            {!JEV_CALIBRATED && on && (
              <span className="jev-tag" id={ids.start} title={t('features.ai.jev.ed.startHint')} data-testid="jev-start">
                {t('features.ai.jev.ed.start')}
              </span>
            )}
          </div>
          {on && checks && (
            <>
              <div className="jev-ed__line">
                <Around text={t('features.ai.jev.ed.markLine', { n: SLOT })} at={0} />
                <Stepper
                  value={checks.pre.markBelow}
                  min={0.3}
                  max={0.95}
                  step={0.05}
                  lang={lang}
                  label={t('features.ai.jev.ed.markLabel')}
                  less={t('features.ai.jev.ed.less')}
                  more={t('features.ai.jev.ed.more')}
                  disabled={server}
                  describedBy={JEV_CALIBRATED ? undefined : ids.start}
                  onChange={(markBelow) => write({ ...checks, pre: { ...checks.pre, markBelow } })}
                  testId="jev-mark"
                />
                <Around text={t('features.ai.jev.ed.markLine', { n: SLOT })} at={1} />
              </div>
              <div className="jev-ed__line">
                <span className="jev-ed__text" id={`${uid}-concern`}>
                  {t('features.ai.jev.ed.onConcern')}
                </span>
                <div className="agx-seg" role="radiogroup" aria-labelledby={`${uid}-concern`} onKeyDown={(e) => onRovingKey(e)} data-testid="jev-hold">
                  {([false, true] as const).map((hold) => (
                    <button
                      key={String(hold)}
                      type="button"
                      role="radio"
                      className="agx-seg__btn"
                      aria-checked={checks.pre.hold === hold}
                      tabIndex={checks.pre.hold === hold ? 0 : -1}
                      disabled={server}
                      onClick={() => write({ ...checks, pre: { ...checks.pre, hold } })}
                    >
                      {t(hold ? 'features.ai.jev.ed.hold' : 'features.ai.jev.ed.markOnly')}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <p className="agx-field__hint" id={ids.hint}>
            {t('features.ai.jev.ed.preHint')}
            {on && checks?.pre.hold ? ` ${t('features.ai.jev.ed.holdHint')}` : ''}
          </p>
          {on && (
            <p className="jev-ed__facts mono" data-testid="jev-facts">
              {perCheck(lang, row) && <span>{t('features.ai.jev.ed.estimate', { usd: perCheck(lang, row)! })}</span>}
              {resolved.code === null && !refused.length ? (
                <span>
                  {t('features.ai.jev.ed.reads')} <b className="jev-ed__ok">{t('features.ai.jev.ed.readsOk')}</b>
                </span>
              ) : (
                <span className="jev-ed__warn" data-testid="jev-reads-no">
                  {noRoute ? t('features.ai.jev.ed.noRoute') : resolved.code && resolved.code !== 'no_route' ? t(`features.ai.jev.ed.code.${resolved.code === 'no_key' ? 'nokey' : resolved.code === 'policy' ? 'policy' : 'other'}`) : t('features.ai.jev.ed.readsNo', { class: t(`features.ai.cls.${refused[0]}`) })}
                </span>
              )}
            </p>
          )}
          {showNoRoute && (
            <p className="agx-field__hint" id={ids.noRoute} data-testid="jev-noroute">
              {orKey ? t('features.ai.jev.ed.noRoute') : t('features.ai.jev.ed.needsOr')}
            </p>
          )}
          {rowsWait && (
            <p className="agx-field__hint" id={ids.wait} data-testid="jev-rows-wait">
              {waitText}
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ SCHREIBSCHRANKE */}
      <div className="jev-ed__row" data-row="gate">
        <span className="jev-ed__label label" id={ids.gate}>
          {t('features.ai.jev.ed.gate')}
        </span>
        <div className="jev-ed__body">
          <div className="jev-ed__line">
            <Switch
              size="sm"
              seed={`jev-gate-${d.id}`}
              checked={gateOn}
              onChange={(v) => checks && write({ ...checks, gate: v ? { allowAt: checks.gate?.allowAt ?? JEV_DEFAULTS.allowAt } : null })}
              label={t('features.ai.jev.ed.gate')}
              disabled={!gateActive}
              describedBy={gateActive ? `${uid}-gatehint` : ids.gateWhy}
            />
            {gateOn && checks?.gate && (
              <>
                <Around text={t('features.ai.jev.ed.allowLine', { n: SLOT })} at={0} />
                <Stepper
                  value={checks.gate.allowAt}
                  min={0.8}
                  max={0.99}
                  step={0.01}
                  lang={lang}
                  label={t('features.ai.jev.ed.allowLabel')}
                  less={t('features.ai.jev.ed.less')}
                  more={t('features.ai.jev.ed.more')}
                  describedBy={JEV_CALIBRATED ? undefined : ids.start}
                  onChange={(allowAt) => write({ ...checks, gate: { allowAt } })}
                  testId="jev-allow"
                />
                <Around text={t('features.ai.jev.ed.allowLine', { n: SLOT })} at={1} />
              </>
            )}
          </div>
          {!gateActive && (
            <p className="agx-field__hint" id={ids.gateWhy} data-testid="jev-gate-off">
              {server ? t('features.ai.jev.ed.server') : t('features.ai.jev.ed.gateOff')}
            </p>
          )}
          {gateActive && (
            <p className="agx-field__hint" id={`${uid}-gatehint`}>
              {t('features.ai.jev.ed.gateHint')}
            </p>
          )}
          {gateActive && foreign && (
            <p className="jev-ed__amber" role="note" data-testid="jev-foreign">
              {t('features.ai.jev.ed.foreign')}
            </p>
          )}
          {everyRunWaits && (
            <p className="jev-ed__amber" role="note" data-testid="jev-every-waits">
              {t('features.ai.jev.ed.gateWaits')}
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ NEUER STAND */}
      {on && newer && !confirmed && (
        <div className="jev-ed__new" role="group" aria-label={t('features.ai.jev.ed.newTitle')} data-testid="jev-new">
          <span className="jev-cap">{t('features.ai.jev.ed.newTitle')}</span>
          <span className="jev-ed__text">{t('features.ai.jev.ed.newVersion', { model: jevLabel(newer), date: snapshotDate(newer, lang) || newer })}</span>
          <button
            type="button"
            className="btn btn--sm btn--ink jev-ed__confirm"
            onClick={confirmNew}
            aria-disabled={!nextOn || undefined}
            aria-describedby={nextOn ? undefined : `${uid}-newwait`}
            data-testid="jev-confirm"
          >
            {t('features.ai.jev.ed.confirm')}
          </button>
          {!nextOn && (
            <span className="jev-ed__text jev-line__dim" id={`${uid}-newwait`}>
              {waitText}
            </span>
          )}
        </div>
      )}
      {/* the live region is there before Confirm (a region inserted with its text is not read out) */}
      {on && (
        <p ref={statusRef} className="agx-field__hint jev-ed__status" role="status" tabIndex={-1} data-testid="jev-confirmed">
          {confirmed ? t('features.ai.jev.ed.confirmed') : ''}
        </p>
      )}

      {/* ------------------------------------------------ KALIBRIERUNG */}
      {(on || calib.checked > 0) && (
        <div className="jev-ed__row" data-row="calib">
          <span className="jev-ed__label label">{t('features.ai.jev.ed.calib')}</span>
          <div className="jev-ed__body">
            <p className="jev-ed__calib mono" data-testid="jev-calib">
              {calib.checked
                ? t('features.ai.jev.ed.calibLine', { n: calib.checked, marked: calib.marked, applied: calib.applied, discarded: calib.discarded, wrong: calib.wrong })
                : t('features.ai.jev.ed.calibNone')}
            </p>
            <p className="agx-field__hint">
              {t('features.ai.jev.ed.calibHint', { mark: fmtP(checks?.pre.markBelow ?? JEV_DEFAULTS.markBelow, lang) })}
            </p>
          </div>
        </div>
      )}
      <Menu
        {...menu.props}
        width={320}
        entries={pickerEntries(t, lang, { rows, state, current: checks?.decider?.m ?? null, onPick: pickDecider, inherit: inheritLabel, inheritOff: !via || !rowOf(rows, via) })}
      />
    </div>
  )
}

/** Where the stepper sits in a sentence ("unter {n} markieren"): the words before (0) or after (1) it — none drawn empty. */
const SLOT = '\u0000'
function Around({ text, at }: { text: string; at: 0 | 1 }) {
  const part = (text.split(SLOT)[at] ?? '').trim()
  return part ? <span className="jev-ed__text">{part}</span> : null
}

/** The newest Jev version of the catalogue (null: none known). */
const sortedFirst = (rows: ReturnType<typeof useDecisionRows>['rows']): string | null => newestJev(rows.filter((r) => !r.refused))?.id ?? null
