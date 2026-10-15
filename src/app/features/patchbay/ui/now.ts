/**
 * The page's one second ticker (plan §3.10): the header's live clock and the windows' running timers ("RUNNING 0:04")
 * read the time from here. It ticks once a second only while something on the page reads it AND the tab is visible
 * (hidden: the interval stops; visible again: it reads the time at once and goes on) — so a closed route or a hidden tab
 * costs nothing. `useNow(on)` subscribes only while `on` (a window that shows no timer never re-renders per second).
 */
import { useSyncExternalStore } from 'react'

let now = Date.now()
const listeners = new Set<() => void>()
let timer = 0
let watching = false

const visible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible'

function tick(): void {
  now = Date.now()
  listeners.forEach((l) => l())
}

function arm(): void {
  window.clearInterval(timer)
  timer = 0
  if (!listeners.size || !visible()) return
  tick()
  timer = window.setInterval(tick, 1000)
}

const onVisibility = () => arm()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (!watching) {
    watching = true
    document.addEventListener('visibilitychange', onVisibility)
  }
  if (listeners.size === 1) arm()
  return () => {
    listeners.delete(fn)
    if (listeners.size) return
    window.clearInterval(timer)
    timer = 0
    document.removeEventListener('visibilitychange', onVisibility)
    watching = false
  }
}

const noop = () => () => undefined
const read = () => now

/** The time now (ms), again every second while `on`, the tab is visible and the page reads it. */
export function useNow(on = true): number {
  const t = useSyncExternalStore(on ? subscribe : noop, read, read)
  return on ? t : Date.now()
}
