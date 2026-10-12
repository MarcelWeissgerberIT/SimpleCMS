/**
 * Allowances — the person's E ("+1 $ einmal erlauben"), in this tab's memory only (never stored, never synced):
 *  - one-shots get a token (allowOnce): the retry passes its id as `run.allowance`, the money phase adds its amount to
 *    every rest for THAT request and consumes it — a later request of the same purpose gets none ("nur für diese Anfrage");
 *  - loops and runs get an allowance keyed by their source (allowTask: 'terminal:<conv>:<task>', 'agent:<id>:<run>'),
 *    for that task or run and today only; each press adds to it.
 * Pure state (a Node spec drives it); the day comes from the caller's clock.
 */
import { newId } from '../../lib/ids'
import { dayOf } from './clock'

export interface AllowToken {
  id: string
  usd: number
  day: string
}

interface TaskAllowance {
  usd: number
  day: string
  /** who pressed E (an account id in a team, null locally) — for the receipt */
  by: string | null
}

const MAX = 200
const tokens = new Map<string, AllowToken>()
const tasks = new Map<string, TaskAllowance>()

const amount = (usd: number) => (Number.isFinite(usd) && usd > 0 ? usd : 0)

function trim<K, V>(m: Map<K, V>): void {
  while (m.size > MAX) m.delete(m.keys().next().value as K)
}

/** A one-request allowance (E on a BrakeNote): the token the retry carries. */
export function allowOnce(usd = 1, now = Date.now()): AllowToken {
  const t: AllowToken = { id: newId(), usd: amount(usd), day: dayOf(now) }
  tokens.set(t.id, t)
  trim(tokens)
  return t
}

/** An allowance for a task or run, today (E on the halt card, the manual start dialog). Each press adds. */
export function allowTask(source: string, usd = 1, now = Date.now(), by: string | null = null): number {
  const day = dayOf(now)
  const cur = tasks.get(source)
  const sum = (cur && cur.day === day ? cur.usd : 0) + amount(usd)
  tasks.delete(source)
  tasks.set(source, { usd: sum, day, by })
  trim(tasks)
  return sum
}

/**
 * What a request may spend beyond the rests: its task / run's allowance of today, plus the unspent token it carries
 * (a token of another day counts nothing).
 */
export function allowanceOf(ctx: { source?: string | null; allowance?: string | null }, now = Date.now()): number {
  const day = dayOf(now)
  const task = ctx.source ? tasks.get(ctx.source) : undefined
  const token = ctx.allowance ? tokens.get(ctx.allowance) : undefined
  return (task && task.day === day ? task.usd : 0) + (token && token.day === day ? token.usd : 0)
}

/** The request the token unlocked was let through: the token is spent (false: unknown or spent already). */
export const consume = (id: string | null | undefined): boolean => !!id && tokens.delete(id)

/** Who allowed a task's extra (the receipt), null: nobody / locally. */
export const allowedBy = (source: string): string | null => tasks.get(source)?.by ?? null

/** The seam and the local reset: every allowance goes. */
export function clearAllowances(): void {
  tokens.clear()
  tasks.clear()
}
