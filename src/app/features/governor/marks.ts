/**
 * What waits at the red line in this tab, for the status cell and the VERBRAUCH lamp (Regler § 10.2 / § 10.3): the AI
 * terminal's tasks at their halt card, the agents held today (their runs say it too, per device) and a version the
 * autofill watch bumps when it pauses or resumes rows (the rows themselves live in paused.ts). In memory only.
 */
import { create } from 'zustand'
import { dayOf } from './clock'

interface Marks {
  /** terminal tasks waiting at their halt card */
  halts: string[]
  /** agents held, with the day */
  held: Array<{ agent: string; day: string }>
  /** bumped when paused rows change */
  paused: number
}

export const useGovernorMarks = create<Marks>(() => ({ halts: [], held: [], paused: 0 }))

/** A terminal task waits at its halt card (`on`) or goes on. */
export function noteHalt(task: string, on: boolean): void {
  useGovernorMarks.setState((s) => {
    const has = s.halts.includes(task)
    if (on === has) return s
    return { halts: on ? [...s.halts, task] : s.halts.filter((x) => x !== task) }
  })
}

/** An agent's run was held at the line (today). */
export function noteHeld(agent: string, now = Date.now()): void {
  const day = dayOf(now)
  useGovernorMarks.setState((s) => (s.held.some((h) => h.agent === agent && h.day === day) ? s : { held: [...s.held.filter((h) => h.day === day), { agent, day }] }))
}

/** The autofill watch paused or resumed rows. */
export const bumpPaused = (): void => useGovernorMarks.setState((s) => ({ paused: s.paused + 1 }))

/** Agents held today. */
export const heldToday = (now = Date.now()): string[] => {
  const day = dayOf(now)
  return useGovernorMarks.getState().held.filter((h) => h.day === day).map((h) => h.agent)
}
