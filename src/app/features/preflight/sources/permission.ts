/**
 * Lamp "Claude möchte" (worker 1.11.0; fitted where coding is switched on): a running coding stage waits for the
 * person's permission — Claude Code wants a tool its rules did not settle, the worker holds the call (up to 15 min,
 * then it refuses on its own). The requests live in this tab's worker link (`useCoding.asks`, only on the worker's own
 * tab), so the reading is O(k) and costs nothing. Ids: perm:<taskId>:<askId>.
 *
 * The card: what Claude Code wants in full (AskWhat, the task panel's own) — A = Allow once, 1 = Always for this repo
 * (only with a rule the worker offers; the worker stores it in its own worker.json), D = Refuse, O = open the task.
 * Every answer is VON HAND (it goes to Claude Code), never in ⇧A, X or a swipe; only the request's id and the verb go to
 * the worker. The card ends when the request leaves the reading (answered, timed out, the stage ended).
 */
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { t } from '../../../i18n'
import { useCoding, type PermissionAsk, type PermissionVerb } from '../../coding'
import type { CardAction, Done, LampReading, LampSourceDef, QueueItem } from '../registry'
import { answerAsk } from '../queue/calls'
import { watch } from './util'
import { titleOf } from './proposals/common'

const PREFIX = 'perm:'

/** The open requests, oldest first. */
function asksNow(): Array<{ taskId: string; ask: PermissionAsk }> {
  const asks = useCoding.getState().asks
  return Object.entries(asks)
    .map(([taskId, ask]) => ({ taskId, ask }))
    .sort((a, b) => a.ask.at - b.ask.at)
}

const idOf = (taskId: string, askId: string) => `${PREFIX}${taskId}:${askId}`

/** The task and request of a card id (null: not one of this lamp's). */
export function parsePermItem(id: string): { taskId: string; askId: string } | null {
  if (!id.startsWith(PREFIX)) return null
  const rest = id.slice(PREFIX.length)
  const i = rest.lastIndexOf(':')
  return i > 0 ? { taskId: rest.slice(0, i), askId: rest.slice(i + 1) } : null
}

/** The request a card is about, while it is still open (null: answered, timed out, ended). */
export function permAskOf(id: string): PermissionAsk | null {
  const p = parsePermItem(id)
  if (!p) return null
  const ask = useCoding.getState().asks[p.taskId]
  return ask && ask.id === p.askId ? ask : null
}

async function answer(item: QueueItem, verb: PermissionVerb): Promise<Done> {
  const p = parsePermItem(item.id)
  if (!p || !permAskOf(item.id)) return { ok: false, error: 'features.preflight.perm.gone', elsewhere: true }
  try {
    const res = await answerAsk(p.taskId, p.askId, verb)
    if (res === 'gone') return { ok: false, error: 'features.preflight.perm.gone', elsewhere: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, resolve: 'reading', final: 'features.preflight.perm.final' }
}

function actions(item: QueueItem): CardAction[] {
  const p = parsePermItem(item.id)
  const ask = permAskOf(item.id)
  const gone = ask ? null : { key: 'features.preflight.perm.gone' }
  const open: CardAction = { key: 'o', label: t('features.preflight.card.openTask'), outcome: 'hand', run: () => (p && navigate({ name: 'page', id: p.taskId }), { ok: true, stay: true }) }
  const keys: CardAction[] = [{ key: 'a', label: t('features.coding.perm.once'), outcome: 'hand', hand: ['claudeCode'], blocked: gone, run: () => answer(item, 'once') }]
  if (ask?.rule) keys.push({ key: '1', label: t('features.coding.perm.always'), outcome: 'hand', hand: ['claudeCode'], run: () => answer(item, 'always') })
  keys.push({ key: 'd', label: t('features.coding.perm.deny'), outcome: 'hand', hand: ['claudeCode'], blocked: gone, run: () => answer(item, 'deny') }, open)
  return keys
}

export const permissionLamp: LampSourceDef = {
  id: 'permission',
  order: 65,
  legend: () => t('features.preflight.lamp.permission.legend'),
  short: () => t('features.preflight.lamp.permission.short'),
  rule: () => t('features.preflight.lamp.permission.rule'),
  thresholds: { amber: 1, red: null },
  settle: 0,
  fitted: () => useCoding.getState().enabled || Object.keys(useCoding.getState().asks).length > 0,
  subscribe: (changed) => watch(useCoding, (s) => [s.asks, s.enabled], changed),
  read(): LampReading {
    const list = asksNow()
    return { state: 'ok', count: list.length, ids: list.map((x) => idOf(x.taskId, x.ask.id)), second: list.length ? t('features.preflight.lamp.permission.second') : '' }
  },
  open() {
    const first = asksNow()[0]
    navigate(first ? { name: 'page', id: first.taskId } : { name: 'coding' })
  },
  queue: {
    items: (): QueueItem[] =>
      asksNow().map(({ taskId, ask }) => ({
        id: idOf(taskId, ask.id),
        lamp: 'permission',
        kind: 'permission',
        tag: titleOf(useWorkspace.getState().pages[taskId]?.databaseId) || t('common.untitled'),
        refs: { taskId, pageId: taskId },
        at: ask.at,
        hand: ['claudeCode'],
        bulk: false,
        resolveBy: 'reading',
        title: titleOf(taskId) || t('common.untitled'),
        detail: t('features.preflight.perm.detail', { tool: ask.tool }),
      })),
    actions,
    resolved: () => 'hand',
  },
}
