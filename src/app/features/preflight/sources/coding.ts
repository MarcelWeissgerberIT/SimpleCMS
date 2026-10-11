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
import { hasPipelines, onWaitingChanged, waitingTasks, type WaitingTask } from '../../coding'
import type { LampReading, LampSourceDef } from '../registry'
import { all, watch } from './util'

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
  }
}

export const gateLamp = lamp('gate', 30, { amber: 1, red: null }, gateIds)
export const questionLamp = lamp('question', 60, { amber: 1, red: null }, questionIds)
export const failedLamp = lamp('failed', 70, { amber: null, red: 1 }, failedIds)
