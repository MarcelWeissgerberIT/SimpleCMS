/*
 * Demo mode (no key): people can try the AI panel with canned answers (features/ai/demo.ts). This session only, never
 * persisted, never sent anywhere — and only while no key is set: a key always wins. isAIConfigured() stays false in
 * demo mode. (Moved here from client.ts, which re-exports it; the gate reads it — 'demo' is a runtime-only provider.)
 */
import { useWorkspace } from '../../../store/store'

let demo = false
const demoListeners = new Set<() => void>()

export function setAIDemo(on: boolean) {
  if (demo === on) return
  demo = on
  demoListeners.forEach((l) => l())
}

export function isAIDemo(): boolean {
  return demo
}

export function onAIDemo(listener: () => void): () => void {
  demoListeners.add(listener)
  return () => demoListeners.delete(listener)
}

/** True when a request would get a demo answer: demo on and no key. */
export function usesDemo(): boolean {
  return demo && !useWorkspace.getState().settings.aiApiKey.trim()
}
