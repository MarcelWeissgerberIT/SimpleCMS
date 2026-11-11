import { polarionAuthenticationRequested } from '@/shared/quandprofile/polarion-auth-intent'
import { currentLang } from '../../../i18n'

/** Reserve while still inside the submit gesture; navigate only to a validated tool-result URL. */
export function polarionSignInWindow(task: string, signal: AbortSignal) {
  const requested = polarionAuthenticationRequested(task)
  const opened = new Set<string>()
  let waiting: Window | null = null
  const discard = () => { try { waiting?.close() } catch { /* already closed */ } waiting = null }
  if (requested && navigator.userActivation?.isActive) {
    try {
      waiting = window.open('', '_blank', 'popup=yes,width=560,height=760')
      if (waiting) {
        waiting.opener = null
        const de = currentLang() === 'de'
        waiting.document.title = de ? 'Polarion-Anmeldung' : 'Polarion sign-in'
        const main = waiting.document.createElement('main')
        main.style.cssText = 'font:18px system-ui;max-width:440px;margin:64px auto;padding:24px;line-height:1.6'
        const heading = waiting.document.createElement('h1')
        heading.textContent = de ? 'Anmeldung wird vorbereitet …' : 'Preparing sign-in …'
        const text = waiting.document.createElement('p')
        text.textContent = de ? 'ONE öffnet hier den geschützten Dialog, sobald Atlas bereit ist. Du kannst in ONE weiterarbeiten.' : 'ONE will open the protected dialog here as soon as Atlas is ready. You can keep working in ONE.'
        main.append(heading, text); waiting.document.body.append(main)
      }
    } catch { discard() }
  }
  signal.addEventListener('abort', discard, { once: true })
  return {
    show(url: string) {
      if (!requested || signal.aborted || opened.has(url)) return
      opened.add(url)
      try {
        if (waiting && !waiting.closed) { waiting.location.replace(url); waiting = null }
        else window.open(url, '_blank', 'noopener,noreferrer,popup=yes,width=560,height=760')
      } catch { /* the terminal always offers the clickable link */ }
    },
    finish() { signal.removeEventListener('abort', discard); discard() },
  }
}
