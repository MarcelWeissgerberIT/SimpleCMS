/** The route chip's small shared parts: the providers' code plates and the Alt+M key. */
import type { Route } from '@/shared/ai/types'
import { isMac } from '../../../ui/controls'

/** The code plate of a provider. */
export const PLATE: Record<Route['p'], string> = { anthropic: 'CL', openai: 'OA', openrouter: 'OR' }

/** Alt+M (pc: `m`; a Mac's Option+M types "µ") — never AltGraph, never by key code (keyboard layouts differ). */
export function isRouteKey(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'key'> & { getModifierState?: (k: string) => boolean }): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false
  if (e.getModifierState?.('AltGraph')) return false
  return e.key === 'm' || e.key === 'M' || (isMac && e.key === 'µ')
}
