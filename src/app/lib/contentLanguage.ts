/** Per-device and per-workspace. Defaults to the UI language; never synced or exported. */
import { useSyncExternalStore } from 'react'
import type { Lang } from '@/shared/i18n'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useWorkspace } from '../store/store'
import { useCloud } from '../cloud/state'
export type ContentLanguageChoice = 'auto' | 'original' | Lang
const listeners = new Set<() => void>()
const scopeKey = () => { const a = useCloud.getState().active; return `one.content-language:${a.kind}:${a.id}` }
const choice = (): ContentLanguageChoice => { const v = safeLocalGet(scopeKey()); return v === 'original' || v === 'en' || v === 'de' ? v : 'auto' }
const subscribe = (fn: () => void) => { listeners.add(fn); window.addEventListener('storage', fn); return () => { listeners.delete(fn); window.removeEventListener('storage', fn) } }
export function setContentLanguage(v: ContentLanguageChoice) { safeLocalSet(scopeKey(), v); listeners.forEach(fn => fn()) }
export function currentContentLanguage(): Lang | null { const c = choice(); return c === 'original' ? null : c === 'auto' ? useWorkspace.getState().settings.language : c }
export function useContentLanguage(): { choice: ContentLanguageChoice; lang: Lang | null } {
  const ui = useWorkspace(s => s.settings.language)
  useCloud(s => s.active)
  const selected = useSyncExternalStore(subscribe, choice, () => 'auto' as const)
  return { choice: selected, lang: selected === 'original' ? null : selected === 'auto' ? ui : selected }
}
