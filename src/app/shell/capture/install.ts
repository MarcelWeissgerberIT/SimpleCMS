/**
 * "Install One": the browser's own install prompt where it has one (Chrome, Edge — `beforeinstallprompt`,
 * caught as early as this module loads), a short placard on iOS (Share → Add to Home Screen; Safari has no
 * prompt) and on Android browsers without a prompt (their menu). Hidden once One runs installed
 * (display-mode standalone / fullscreen / minimal-ui / window-controls-overlay, or iOS `navigator.standalone`).
 */
import { useSyncExternalStore } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** 'prompt': the browser's dialog · 'ios' / 'menu': a placard says how · 'installed' / 'none': nothing to show */
export type InstallMode = 'prompt' | 'ios' | 'menu' | 'installed' | 'none'

const APP_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']

let deferred: InstallPromptEvent | null = null
let installedNow = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function isInstalled(): boolean {
  if (installedNow) return true
  if (typeof window === 'undefined') return false
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  return APP_MODES.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches)
}

/** iPhone, iPod, iPad (iPadOS reports a Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

const isAndroid = () => typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

function mode(): InstallMode {
  if (isInstalled()) return 'installed'
  if (deferred) return 'prompt'
  if (isIOS()) return 'ios'
  if (isAndroid()) return 'menu'
  return 'none'
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // keep the browser's own mini-infobar away: One offers the install where the user looks for it
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installedNow = true
    deferred = null
    emit()
  })
  for (const m of APP_MODES) window.matchMedia?.(`(display-mode: ${m})`).addEventListener?.('change', emit)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, mode, mode)
}

/** True when there is something to show (a prompt or a placard). */
export const canOfferInstall = (m: InstallMode) => m === 'prompt' || m === 'ios' || m === 'menu'

/**
 * Install: the browser's dialog when it offered one; else `placard()` (iOS / Android menu). Resolves true
 * when the user accepted the browser's dialog.
 */
export async function installOne(placard: () => void): Promise<boolean> {
  const e = deferred
  if (!e) {
    placard()
    return false
  }
  // a prompt can be shown once
  deferred = null
  emit()
  try {
    await e.prompt()
    const choice = await e.userChoice
    if (choice?.outcome === 'accepted') {
      installedNow = true
      emit()
      return true
    }
  } catch (err) {
    console.warn('[one] install prompt failed', err)
  }
  return false
}
