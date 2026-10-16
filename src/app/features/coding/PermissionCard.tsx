/**
 * worker 1.11.0 in the task panel:
 *  - "CLAUDE MÖCHTE": a permission Claude Code needs (the worker holds the tool call): what it wants — the tool and the
 *    worker's scrubbed description, always whole (the worker refuses what it could not show whole; a long one scrolls
 *    and says its length) — and the keys Allow once · Always allow for this repo (only with a rule the worker offers:
 *    the card names it) · Refuse. Only the request's id and the verb go to the worker; the time left until the worker
 *    refuses it on its own ticks. Only on the worker's own tab (the request lives there). The task panel keys the card
 *    by the request's id: the next request is a fresh card whose keys wake only after ARM_MS — the second click of a
 *    double-click never answers a request nobody read.
 *  - the step limit: "Step limit reached (n/n)" with Continue (+N steps — the stage's Step limit now, what the next run
 *    gets) — the stage runs on from its worktree — and Start over; an older worker gets Start over only, with why.
 *  - the last run's permission count, one line.
 */
import { useEffect, useState } from 'react'
import { Check, Play, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { answerPermission } from './service'
import { continueTask, runTaskNow } from './tasks'
import { useCoding } from './state'
import type { PermissionAsk, PermissionVerb } from './protocol'
import './coding.css'

type T = ReturnType<typeof useT>

/** What a request is, in the person's language: the kind's word ("Bash", "Lesen" …) and what — a file outside said so. */
export function askParts(t: T, ask: PermissionAsk): { kind: string; what: string; outside: boolean } {
  const kind = ask.kind === 'other' ? ask.tool : ask.kind === 'mcp' ? `${t('features.coding.perm.kind.mcp')} ${ask.tool.replace(/^mcp__/, '').replace(/__/g, ' · ')}` : t(`features.coding.perm.kind.${ask.kind}`)
  return { kind, what: ask.what.trim() || ask.tool, outside: !!ask.outside }
}

/** "4:59" until the worker refuses on its own (ticks while shown). */
function useLeft(until: number): string {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [until])
  const s = Math.max(0, Math.round((until - Date.now()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A request this long scrolls in its box (the card says its length, the box takes the keyboard). */
const LONG_WHAT = 240

/** The request as the card and Preflight's body show it (no keys): always whole — a long one scrolls. */
export function AskWhat({ ask }: { ask: PermissionAsk }) {
  const t = useT()
  const p = askParts(t, ask)
  const long = p.what.length > LONG_WHAT
  return (
    <div className="ctk-perm__what">
      <span className="label ctk-perm__kind">{p.kind}</span>
      {p.outside && <span className="ctk-perm__outside">{t('features.coding.perm.outside')}</span>}
      {long && <span className="ctk-perm__length">{t('features.coding.perm.length', { n: p.what.length })}</span>}
      <code className="ctk-perm__cmd" data-testid="coding-permission-what" {...(long ? { tabIndex: 0, role: 'region', 'aria-label': t('features.coding.perm.whole') } : {})}>
        {p.what}
      </code>
    </div>
  )
}

/** How long a fresh request's keys stay asleep (the rest of a double-click, a key held from the one before). */
export const ARM_MS = 400

/** Mount it with `key={ask.id}`: each request is its own card, its keys awake only ARM_MS after it showed. */
export function PermissionCard({ taskId, ask, canAct }: { taskId: ID; ask: PermissionAsk; canAct: boolean }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setArmed(true), ARM_MS)
    return () => window.clearTimeout(id)
  }, [ask.id])
  const left = useLeft(ask.until)
  const asleep = !armed || busy
  const answer = (verb: PermissionVerb) => async () => {
    // never disabled (focus stays on the key), but a press before the card woke answers nothing
    if (asleep) return
    setBusy(true)
    try {
      const r = await answerPermission(taskId, ask.id, verb)
      if (r === 'gone') useUI.getState().toast({ message: t('features.coding.perm.gone'), kind: 'info' })
    } catch (e) {
      useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const labelId = `ctk-perm-${ask.id}`
  return (
    <div className="ctk-box ctk-box--perm" role="group" aria-labelledby={labelId} data-testid="coding-permission">
      <p className="ctk-perm__head">
        <ShieldAlert size={15} strokeWidth={1.75} aria-hidden />
        <span className="label ctk-perm__label" id={labelId}>
          {t('features.coding.perm.label')}
        </span>
        <span className="label ctk-perm__left">
          {t('features.coding.perm.until', { time: left })}
        </span>
      </p>
      <AskWhat ask={ask} />
      <p>{t('features.coding.perm.hint')}</p>
      {canAct && (
        <div className="ctk-keys">
          <button type="button" className="btn btn--sm btn--primary" aria-disabled={asleep || undefined} onClick={answer('once')} data-testid="coding-permission-once">
            <Check size={14} strokeWidth={1.75} aria-hidden />
            {t('features.coding.perm.once')}
          </button>
          {ask.rule && (
            <button type="button" className="btn btn--sm" aria-disabled={asleep || undefined} onClick={answer('always')} aria-describedby={`${labelId}-rule`} data-testid="coding-permission-always">
              {t('features.coding.perm.always')}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" aria-disabled={asleep || undefined} onClick={answer('deny')} data-testid="coding-permission-deny">
            <X size={14} strokeWidth={1.75} aria-hidden />
            {t('features.coding.perm.deny')}
          </button>
        </div>
      )}
      <p className="ctk-perm__rule" id={`${labelId}-rule`} data-testid="coding-permission-rule">
        {ask.rule ? t('features.coding.perm.rule', { rule: ask.rule, repo: ask.repo }) : t('features.coding.perm.onceOnly')}
      </p>
    </div>
  )
}

/**
 * The stage stopped at its step limit: Continue (+N steps) runs it on from the worktree; Start over runs it again with
 * its first instructions in the same worktree. `steps`: what the next run gets — the stage's Step limit now (stageSteps).
 */
export function StepLimitBox({ taskId, limit, steps, canAct, onError }: { taskId: ID; limit: { turns: number; max: number }; steps: number; canAct: boolean; onError: (e: unknown) => void }) {
  const t = useT()
  // the same rule as canContinue(), read live: a connected older worker cannot continue (it would start over)
  const cont = useCoding((s) => s.can === null || s.can.includes('continue'))
  return (
    <div className="ctk-box ctk-box--limit" role="alert" data-testid="coding-steplimit">
      <p className="ctk-perm__head">
        <span className="label ctk-limit__label">{t('features.coding.limit.label', { turns: limit.turns, max: limit.max })}</span>
      </p>
      <p>{t('features.coding.limit.body', { max: limit.max })}</p>
      {!cont && <p className="ctk-limit__old">{t('features.coding.limit.oldWorker')}</p>}
      {canAct && (
        <div className="ctk-keys">
          {cont && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => void continueTask(taskId).catch(onError)} data-testid="coding-continue">
              <Play size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.limit.continue', { n: steps })}
            </button>
          )}
          <button type="button" className={`btn btn--sm${cont ? ' btn--ghost' : ''}`} onClick={() => void runTaskNow(taskId).catch(onError)} data-testid="coding-restart">
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
            {t('features.coding.limit.restart')}
          </button>
          <span className="ctk-hint">{t('features.coding.limit.hint')}</span>
        </div>
      )}
    </div>
  )
}

/** The last run's permission count, one line (only when it had any). */
export function PermissionSummary({ counts }: { counts: { asked: number; allowed: number; refused: number } }) {
  const t = useT()
  return (
    <p className="label ctk-perm__sum" data-testid="coding-permission-summary">
      {t('features.coding.perm.summary', counts)}
    </p>
  )
}
