/**
 * One memory — the per-device switches (Settings → Claude AI → One memory). Absent = the defaults:
 * memory on, proposals after AI-terminal tasks once a memory database exists (so nobody pays for
 * proposals before they started a memory: /remember, "remember …" in the AI menu, "Set up memory").
 */
import { useWorkspace } from '../../../store/store'
import type { MemorySettings, Settings } from '../../../store/types'
import { memoryDbId } from './schema'

export function memorySettings(s: Pick<Settings, 'memory'> = useWorkspace.getState().settings): Required<MemorySettings> & { explicit: boolean } {
  const m = s.memory && typeof s.memory === 'object' ? s.memory : {}
  return { enabled: m.enabled !== false, proposals: m.proposals === true, explicit: typeof m.proposals === 'boolean' }
}

/** Memory goes along with requests: switched on and a memory database exists. */
export function memoryInUse(): boolean {
  return memorySettings().enabled && !!memoryDbId()
}

/** Claude proposes memories after an AI-terminal task (the switch, or by default once a memory exists). */
export function proposalsOn(): boolean {
  const m = memorySettings()
  if (!m.enabled) return false
  return m.explicit ? m.proposals : !!memoryDbId()
}

export function setMemorySettings(patch: MemorySettings): void {
  const s = useWorkspace.getState()
  s.updateSettings({ memory: { ...(s.settings.memory ?? {}), ...patch } })
}
