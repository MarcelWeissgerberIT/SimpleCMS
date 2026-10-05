/**
 * Saved instructions ("Vorgaben") for "Redo with instructions": name + text, at most 20. Per device in
 * localStorage (`one.redo.presets`) — a convenience of this browser, never synced; without storage they
 * live in this tab only.
 */
import { create } from 'zustand'
import { newId } from '../../../lib/ids'

export interface RedoPreset {
  id: string
  name: string
  text: string
}

export const PRESETS_MAX = 20
const KEY = 'one.redo.presets'

function load(): RedoPreset[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p): p is RedoPreset => !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.text === 'string')
      .slice(0, PRESETS_MAX)
  } catch {
    return []
  }
}

export const useRedoPresets = create<{ list: RedoPreset[] }>()(() => ({ list: typeof window === 'undefined' ? [] : load() }))

function save(list: RedoPreset[]) {
  useRedoPresets.setState({ list })
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode: this tab only */
  }
}

/** A short name from the text ("Shorter, informal 'du' …"). */
export function presetName(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 28 ? `${flat.slice(0, 27).trimEnd()}…` : flat
}

/** Save the text as a preset (false: the list is full or the text is empty / already saved). */
export function addPreset(text: string, name = presetName(text)): RedoPreset | null {
  const list = useRedoPresets.getState().list
  const t = text.trim()
  if (!t || list.length >= PRESETS_MAX || list.some((p) => p.text.trim() === t)) return null
  const p = { id: newId(), name: name.trim() || presetName(t), text: t }
  save([...list, p])
  return p
}

export function renamePreset(id: string, name: string) {
  const n = name.trim()
  if (!n) return
  save(useRedoPresets.getState().list.map((p) => (p.id === id ? { ...p, name: n.slice(0, 40) } : p)))
}

export function deletePreset(id: string) {
  save(useRedoPresets.getState().list.filter((p) => p.id !== id))
}
