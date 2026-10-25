/**
 * "Install One": the browser's own install prompt where it has one (Chrome, Edge — `beforeinstallprompt`,
 * caught as early as this module loads), browser-specific instructions on desktops and phones when no prompt is available.
 * Safari uses Add to Dock (Mac) / Add to Home Screen (iOS). Hidden once One runs installed
 * (display-mode standalone / fullscreen / minimal-ui / window-controls-overlay, or iOS `navigator.standalone`).
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** 'prompt': native dialog · desktop / mobile: instructions · installed / none: nothing to show. */
export type InstallMode = 'prompt' | 'ios' | 'menu' | 'desktop' | 'installed' | 'none'

// Installed ONE windows can report fullscreen (including older installed manifests).
// Suppress installation there too; display-mode alone cannot distinguish every browser fullscreen case.
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

export function getInstallMode(): InstallMode {
  if (isInstalled()) return 'installed'
  if (deferred) return 'prompt'
  if (isIOS()) return 'ios'
  if (isAndroid()) return 'menu'
  if (typeof navigator !== 'undefined') return 'desktop'
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

export function subscribeInstall(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** True when there is something to show (a prompt or a placard). */
export const canOfferInstall = (m: InstallMode) => m === 'prompt' || m === 'ios' || m === 'menu' || m === 'desktop'

/**
 * Install: the browser's dialog when it offered one; else `placard()` with platform instructions. Resolves true
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
    placard()
  }
  return false
}

/** Browser-specific instructions; no browser/OS shell command or worker is needed. */
export function installGuide() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const kind = isIOS() ? 'ios'
    : isAndroid() ? 'menu'
      : /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua) ? 'mac'
        : /Edg\//.test(ua) ? 'edge'
          : /Chrome|Chromium/.test(ua) ? 'chrome' : 'other'
  return {
    kind,
    title: kind === 'ios' || kind === 'menu' ? 'shell.install.placard.title' : 'shell.install.desktop.title',
    label: `shell.install.label.${kind}`,
    steps: kind === 'ios'
      ? ['shell.install.ios.share', 'shell.install.ios.add', 'shell.install.ios.confirm']
      : kind === 'menu'
        ? ['shell.install.menu.open', 'shell.install.menu.add']
        : [`shell.install.${kind}.open`, `shell.install.${kind}.add`, `shell.install.${kind}.confirm`],
    note: kind === 'ios' ? 'shell.install.ios.note' : kind === 'mac' ? 'shell.install.mac.note' : 'shell.install.desktop.note',
  }
}
