/**
 * Lamps "Gate · Plan", "Coding question", "Task failed" — one reading of coding's waiting tasks (waitingTasks: rows
 * from the shared row index, run states from one IndexedDB read, trust checked 2 s after the last change). Ids:
 *   gate:     task:<id>:<stage>:gate@<at36> · task:<id>:<stage>:intake · task:<id>:confirm@<version8> (instead: a task
 *             counts once) — the member's own pipelines
 *   question: task:<id>:<stage>:question@<at36> (the worker's device holds the question)
 *   failed:   task:<id>:<stage>:<failed|stopped>@<at36>
 */
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { t } from '../../../i18n'
import { actionTook, canContinue, CodingPlanError, hasPipelines, onWaitingChanged, planTaskAction, taskDetail, taskSig, taskVersionView, waitingTasks, type TaskActionPlan, type TaskDetail, type TaskVersionView, type WaitingTask } from '../../coding'
import type { CardAction, Done, HandWhy, LampReading, LampSourceDef, QueueItem, QueueSourceDef } from '../registry'
import { applyTask, confirmVersion } from '../queue/calls'
import { all, watch } from './util'
import { titleOf } from './proposals/common'

const at36 = (w: WaitingTask) => w.at.toString(36)

function gateIds(list: readonly WaitingTask[]): string[] {
  const ids: string[] = []
  for (const w of list) {
    if (w.confirm === true && w.version8) ids.push(`task:${w.id}:confirm@${w.version8}`)
    else if (w.phase === 'gate') ids.push(`task:${w.id}:${w.stageId ?? '-'}:gate@${at36(w)}`)
    else if (w.phase === 'intake') ids.push(`task:${w.id}:${w.stageId ?? '-'}:intake`)
  }
  return ids
}

const questionIds = (list: readonly WaitingTask[]) => list.filter((w) => w.phase === 'question').map((w) => `task:${w.id}:${w.stageId ?? '-'}:question@${at36(w)}`)

const failedIds = (list: readonly WaitingTask[]) => list.filter((w) => w.phase === 'failed' || w.phase === 'stopped').map((w) => `task:${w.id}:${w.stageId ?? '-'}:${w.phase}@${at36(w)}`)

const subscribe = (changed: () => void) => all(onWaitingChanged(changed), watch(useWorkspace, (s) => [s.databases], changed))

/** the first task of a reading (↵ opens it) */
const firstTask = (ids: readonly string[]) => (ids.length ? ids[0].split(':')[1] : null)

/* ---------------- the cards (§6.2): prepared with the terminal's own planner, applied with its apply */

/** What a card needs, loaded when it becomes the current card (keys are inert until then). */
export interface CodingPrep {
  detail: TaskDetail | null
  /** approve (gate) · run (failed / stopped) · continue (stopped at its step limit) — made by planTaskAction, applied by applyTaskAction */
  plan?: TaskActionPlan
  /** question: what the answer must still find */
  pin?: { sig: string | null; at: number; stageId: string | null; question: string | null }
  /** confirm: the version exactly as hashed */
  view?: TaskVersionView | null
  /** the planner refused (the task moved since the reading): "changed, read again" */
  changed?: boolean
}

const preps = new Map<string, CodingPrep>()

/** The prepared data of a coding card (null: not prepared yet). */
export const codingPrep = (id: string): CodingPrep | null => preps.get(id) ?? null

/** The task id and what kind of card an id is. */
export function parseTaskItem(id: string): { taskId: string; kind: 'gate' | 'intake' | 'confirm' | 'question' | 'failed' } | null {
  const m = /^task:([^:]+):(.*)$/.exec(id)
  if (!m) return null
  const rest = m[2]
  if (rest.startsWith('confirm@')) return { taskId: m[1], kind: 'confirm' }
  if (rest.endsWith(':intake')) return { taskId: m[1], kind: 'intake' }
  if (/:gate@/.test(rest)) return { taskId: m[1], kind: 'gate' }
  if (/:question@/.test(rest)) return { taskId: m[1], kind: 'question' }
  return { taskId: m[1], kind: 'failed' }
}

const NO_UNDO = 'features.preflight.card.final.coding'

/** Stages that run Claude Code: approving into them, reworking, answering hands work to it. */
const CLAUDE_KINDS = new Set(['plan', 'implement', 'doc'])

function handOf(plan: TaskActionPlan | undefined, extra: HandWhy[] = []): HandWhy[] {
  const out: HandWhy[] = [...extra]
  if (!plan || plan.starts) out.push('startsNow')
  if (!plan || plan.op !== 'approve' || (plan.runs ?? []).some((r) => CLAUDE_KINDS.has(r.kind))) out.push('claudeCode')
  return [...new Set(out)]
}

/** Apply a plan and check it moved the task (an action whose own guard stopped it is not done). */
async function apply(plan: TaskActionPlan): Promise<Done> {
  try {
    await applyTask(plan)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!actionTook(plan)) return { ok: false, error: 'features.preflight.err.moved' }
  return { ok: true, final: NO_UNDO }
}

/** A fresh plan must match the one the card showed: the same task version, local state and stage. */
const samePin = (a: { sig: string | null; at: number; stageId: string | null }, b: { sig: string | null; at: number; stageId: string | null }) => a.sig === b.sig && a.at === b.at && a.stageId === b.stageId

async function prepareTask(item: QueueItem): Promise<void> {
  const p = parseTaskItem(item.id)
  if (!p) return
  const { taskId, kind } = p
  if (kind === 'confirm') {
    preps.set(item.id, { detail: null, view: await taskVersionView(taskId) })
    return
  }
  const detail = await taskDetail(taskId, 8)
  const prep: CodingPrep = { detail }
  try {
    if (kind === 'gate') prep.plan = await planTaskAction(taskId, 'approve')
    // a stage that stopped at its step limit continues from its worktree (worker 1.11.0); R starts it over
    else if (kind === 'failed') prep.plan = await planTaskAction(taskId, detail?.stepLimit && canContinue() ? 'continue' : 'run')
    else if (kind === 'question') prep.pin = { sig: taskSig(taskId), at: item.at, stageId: detail?.stageId ?? null, question: detail?.question ?? null }
  } catch (e) {
    if (!(e instanceof CodingPlanError)) throw e
    prep.changed = true
  }
  preps.set(item.id, prep)
}

function taskActions(item: QueueItem): CardAction[] {
  const p = parseTaskItem(item.id)
  const taskId = p?.taskId ?? ''
  const open: CardAction = { key: 'o', label: t('features.preflight.card.openTask'), outcome: 'hand', run: () => (navigate({ name: 'page', id: taskId }), { ok: true, stay: true }) }
  if (!p || p.kind === 'intake') return [open]
  const prep = preps.get(item.id)
  const loading = !prep ? { key: 'features.preflight.why.loading' } : prep.changed ? { key: 'features.preflight.err.changed' } : null
  if (p.kind === 'confirm') {
    const view = prep?.view
    return [
      {
        key: 'a',
        label: t('features.preflight.card.confirmVersion'),
        outcome: 'hand',
        hand: ['confirm'],
        writes: true,
        blocked: loading ?? (view ? null : { key: 'features.preflight.err.changed' }),
        run: async () => {
          const res = await confirmVersion(taskId, view!.hash)
          if (res === 'gone') return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
          if (res === 'changed') {
            // what the card showed is not the task any more: read it again
            preps.delete(item.id)
            return { ok: false, error: 'features.preflight.err.changed' }
          }
          return { ok: true, resolve: 'reading', final: NO_UNDO }
        },
      },
      open,
    ]
  }
  if (p.kind === 'question') {
    const pin = prep?.pin
    return [
      {
        key: 'a',
        label: t('features.preflight.card.answer'),
        outcome: 'hand',
        hand: ['needsText', 'startsNow', 'claudeCode'],
        writes: true,
        input: { label: t('features.preflight.card.answerLabel'), multiline: true },
        blocked: loading ?? (pin?.question ? null : { key: 'features.preflight.err.changed' }),
        run: async (_it, answer) => {
          const text = (answer ?? '').trim()
          if (!text) return { ok: false, error: 'features.preflight.err.needsText' }
          let fresh: TaskActionPlan
          try {
            fresh = await planTaskAction(taskId, 'answer', { answer: text })
          } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) }
          }
          if (!pin || fresh.question !== pin.question || !samePin(fresh, pin)) return { ok: false, error: 'features.preflight.err.moved' }
          return apply(fresh)
        },
      },
      open,
    ]
  }
  const plan = prep?.plan
  if (p.kind === 'failed') {
    const blocked = loading ?? (plan ? null : { key: 'features.preflight.err.changed' })
    if (plan?.op !== 'continue') return [{ key: 'a', label: t('features.preflight.card.retry'), outcome: 'hand', hand: handOf(plan), writes: true, blocked, run: () => apply(plan!) }, open]
    // the step limit: A continues (as many steps again, its cost counts like any run's), R starts the stage over
    return [
      { key: 'a', label: t('features.coding.limit.continue', { n: plan.steps?.next ?? plan.steps?.max ?? 0 }), outcome: 'hand', hand: handOf(plan), writes: true, blocked, run: () => apply(plan) },
      {
        key: 'r',
        label: t('features.coding.limit.restart'),
        outcome: 'hand',
        hand: handOf(plan),
        writes: true,
        blocked,
        run: async () => {
          let fresh: TaskActionPlan
          try {
            fresh = await planTaskAction(taskId, 'run')
          } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) }
          }
          if (!samePin(fresh, plan)) return { ok: false, error: 'features.preflight.err.moved' }
          return apply(fresh)
        },
      },
      open,
    ]
  }
  // gate: approve (the plan shown), or send it back with a note
  const edited = !!plan && plan.outputFrom === 'page' && !!plan.edited
  return [
    {
      key: 'a',
      label: t('features.preflight.card.approve'),
      outcome: 'hand',
      hand: handOf(plan),
      writes: true,
      blocked: loading ?? (!plan ? { key: 'features.preflight.err.changed' } : edited ? { key: 'features.preflight.why.planEdited' } : null),
      run: () => apply(plan!),
    },
    {
      key: 'r',
      label: t('features.preflight.card.rework'),
      outcome: 'hand',
      hand: ['needsText', 'startsNow', 'claudeCode'],
      writes: true,
      input: { label: t('features.preflight.card.reworkLabel'), multiline: true },
      blocked: loading ?? (!plan ? { key: 'features.preflight.err.changed' } : null),
      run: async (_it, note) => {
        const text = (note ?? '').trim()
        if (!text) return { ok: false, error: 'features.preflight.err.needsText' }
        let fresh: TaskActionPlan
        try {
          fresh = await planTaskAction(taskId, 'rework', { note: text })
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
        if (!plan || !samePin(fresh, plan)) return { ok: false, error: 'features.preflight.err.moved' }
        return apply(fresh)
      },
    },
    open,
  ]
}

function taskItems(lampId: 'gate' | 'question' | 'failed', ids: readonly string[], list: readonly WaitingTask[]): QueueItem[] {
  const byId = new Map(list.map((w) => [w.id, w]))
  return ids.map((id) => {
    const p = parseTaskItem(id)!
    const w = byId.get(p.taskId)
    const hand: HandWhy[] = p.kind === 'confirm' ? ['confirm'] : p.kind === 'intake' ? ['editor'] : p.kind === 'question' ? ['needsText', 'startsNow', 'claudeCode'] : ['startsNow', 'claudeCode']
    return {
      id,
      lamp: lampId,
      kind: p.kind,
      // the source: the task's project (its pipeline database) — the kind is the card's own tag already
      tag: titleOf(useWorkspace.getState().pages[p.taskId]?.databaseId) || t('common.untitled'),
      refs: { taskId: p.taskId, pageId: p.taskId },
      at: w?.at ?? 0,
      hand,
      bulk: false,
      ...(p.kind === 'confirm' || p.kind === 'intake' ? { resolveBy: 'reading' as const } : {}),
      title: titleOf(p.taskId) || t('common.untitled'),
      detail: t(`features.preflight.task.${p.kind}`),
    }
  })
}

function queueOf(lampId: 'gate' | 'question' | 'failed', pick: (l: readonly WaitingTask[]) => string[]): QueueSourceDef {
  return {
    items: () => {
      const list = waitingTasks()
      return taskItems(lampId, pick(list), list)
    },
    prepare: (item) => prepareTask(item),
    actions: taskActions,
  }
}

function lamp(id: 'gate' | 'question' | 'failed', order: number, thresholds: LampSourceDef['thresholds'], pick: (l: readonly WaitingTask[]) => string[]): LampSourceDef {
  let last: string[] = []
  return {
    id,
    order,
    legend: () => t(`features.preflight.lamp.${id}.legend`),
    short: () => t(`features.preflight.lamp.${id}.short`),
    rule: () => t(`features.preflight.lamp.${id}.rule`),
    thresholds,
    fitted: () => hasPipelines(),
    subscribe,
    read(): LampReading {
      const ids = pick(waitingTasks())
      last = ids
      return { state: 'ok', count: ids.length, ids, second: t(`features.preflight.lamp.${id}.second`) }
    },
    open() {
      const task = firstTask(last)
      if (task) navigate({ name: 'page', id: task })
      else navigate({ name: 'coding' })
    },
    queue: queueOf(id, pick),
  }
}

export const gateLamp = lamp('gate', 30, { amber: 1, red: null }, gateIds)
export const questionLamp = lamp('question', 60, { amber: 1, red: null }, questionIds)
export const failedLamp = lamp('failed', 70, { amber: null, red: 1 }, failedIds)
