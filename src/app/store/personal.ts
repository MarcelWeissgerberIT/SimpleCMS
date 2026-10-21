/** Personal preferences of this browser. Workspace exports never include this record. Local tabs merge only changed keys. */
import { createStore, get, update } from 'idb-keyval'
import { defaultSettings, useWorkspace } from './store'
import type { Settings } from './types'
import { SYSTEM, withWriter } from './writer'
import { isSecretMarker } from '../lib/vault'
import { sealStoredAIKey, flushSecretWrites, LOCAL_SCOPE, mcpTokenSecret } from './secrets'

const SHARED = ['language', 'theme', 'userName', 'sidebarWidth', 'sidebarCollapsed', 'spellcheck', 'aiApiKey', 'aiModel', 'aiKeys', 'ai', 'costDisplay', 'historyIntervalMin', 'mcpServers', 'mcpInstructions', 'memory'] as const satisfies readonly (keyof Settings)[]
type Personal = Partial<Pick<Settings, typeof SHARED[number]>>
const personal = createStore('one-personal', 'kv')
const db = () => personal
const pick = (s: Partial<Settings>): Personal => Object.fromEntries(SHARED.filter(k => s[k] !== undefined).map(k => [k, s[k]]))
/** Absence in the personal record is authoritative too: a removed connection must not return from an old copy. */
function overlayPersonal(fallback: Settings, current: Personal): Settings {
  const out = { ...fallback } as unknown as Record<string, unknown>
  const defaults = defaultSettings()
  for (const k of SHARED) {
    delete out[k]
    const value = current[k] ?? defaults[k]
    if (value !== undefined) out[k] = value
  }
  return out as unknown as Settings
}

async function sealedPersonal(input: Personal): Promise<Personal> {
  const out = structuredClone(input)
  const seal = async (value: string, name?: string): Promise<string> => {
    if (!value || isSecretMarker(value)) return value
    const marker = await sealStoredAIKey(value, LOCAL_SCOPE, name)
    if (!marker) throw new Error('Personal keys could not be stored securely')
    return marker
  }
  if (out.aiApiKey) out.aiApiKey = await seal(out.aiApiKey)
  for (const provider of ['openai', 'openrouter'] as const) {
    const value = out.aiKeys?.[provider]
    if (value) out.aiKeys![provider] = await seal(value, `ai-key:${provider}`)
  }
  for (const server of out.mcpServers ?? []) server.token = await seal(server.token || '', mcpTokenSecret(server.id))
  return out
}

let queue: Promise<void> = Promise.resolve()
let replay = false
const pending = new Map<typeof SHARED[number], unknown>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-personal') : null

export async function personalSettings(fallback: Settings): Promise<Settings> {
  const current = await get<Personal>('settings', db())
  if (current) return overlayPersonal(fallback, current)
  // First migration: the original local workspace is authoritative, never the imported workspace's preferences.
  const legacy = createStore('keyval-store', 'keyval')
  const meta = await get<{ settings?: Settings }>('one.ws.v2', legacy) ?? await get<{ settings?: Settings }>('one.workspace.v1', legacy)
  const initial = await sealedPersonal(pick(meta?.settings ?? fallback))
  await update<Personal>('settings', prev => prev ?? initial, db())
  return overlayPersonal(fallback, (await get<Personal>('settings', db())) ?? initial)
}
export function startPersonalSettings(): void {
  useWorkspace.subscribe((s, prev) => {
    if (replay || s.settings === prev.settings) return
    const changed = SHARED.filter(k => JSON.stringify(s.settings[k]) !== JSON.stringify(prev.settings[k]))
    if (!changed.length) return
    const next = pick(s.settings)
    for (const k of changed) pending.set(k, next[k])
    queue = queue.catch(() => {}).then(async () => {
      await flushSecretWrites()
      const patch = new Map(pending)
      if (!patch.size) return
      await update<Personal>('settings', current => {
        const out = { ...current } as Record<string, unknown>
        for (const [k, value] of patch) { if (value === undefined) delete out[k]; else out[k] = value }
        return out as Personal
      }, db())
      for (const [k, value] of patch) if (pending.get(k) === value) pending.delete(k)
      channel?.postMessage('changed')
    })
    void queue.catch(e => console.error('[one] personal settings save failed', e))
  })
  channel?.addEventListener('message', () => {
    void flushPersonalSettings().then(() => get<Personal>('settings', db())).then(current => {
      if (!current) return
      const s = useWorkspace.getState()
      const settings = overlayPersonal(s.settings, current)
      replay = true
      try { withWriter(SYSTEM('tab'), () => useWorkspace.getState().updateSettings(settings)) } finally { replay = false }
    }).catch(e => console.warn('[one] personal preferences unavailable', e))
  })
}
export const flushPersonalSettings = () => queue
