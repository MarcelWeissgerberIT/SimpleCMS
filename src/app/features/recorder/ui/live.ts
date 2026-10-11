/**
 * The deck's polite live region (§ 8.9): what a jump did, said once — the run the playhead moved to and when it
 * starts ("Run 212 · starts 07:31:04"). Focus stays on the key or the track that was used.
 */
import { create } from 'zustand'
import { t } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { LaneKey } from '../model/types'
import { hms } from './format'
import { laneMeta } from './lanes'
import { useRecorderUI } from './state'

export const useLive = create<{ text: string; n: number }>(() => ({ text: '', n: 0 }))

/** Say it (again, even when it is the same sentence). */
export function say(text: string): void {
  useLive.setState((s) => ({ text, n: s.n + 1 }))
}

/** The playhead jumped to a run's start. */
export function sayRun(run: string, lane: LaneKey, at: number): void {
  const seq = useRecorderUI.getState().ops.runs[run]?.meta?.seq
  const ws = useWorkspace.getState()
  const name = seq ? t('features.recorder.flag.run', { n: seq }) : laneMeta(lane, t, ws).title
  say(t('features.recorder.live.run', { run: name, time: hms(at) }))
}
