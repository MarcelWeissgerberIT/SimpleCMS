// STUB — replaced by the landing-intro area.
import type { Lang } from '@/shared/i18n'

export interface IntroOptions {
  lang: Lang
  /** Idle time without any user input before the hammer comes (15000). */
  idleMs: number
  /** Fired when the smash sequence begins (persist "seen", prep the site). */
  onSmashStart: () => void
  /** Fired after the old page has fully fallen away and the overlay can be removed. */
  onRevealed: () => void
}

export interface IntroHandle {
  smashNow(): void
  destroy(): void
}

export function mountIntro(root: HTMLElement, opts: IntroOptions): IntroHandle {
  root.innerHTML = '<div style="position:absolute;inset:0;background:#c0c0c0;font:12px Tahoma">1997 spreadsheet stub</div>'
  let timer = window.setTimeout(smashNow, opts.idleMs)
  function smashNow() {
    window.clearTimeout(timer)
    opts.onSmashStart()
    root.innerHTML = ''
    opts.onRevealed()
  }
  return { smashNow, destroy: () => window.clearTimeout(timer) }
}
