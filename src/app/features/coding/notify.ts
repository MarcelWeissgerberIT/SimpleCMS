/**
 * Browser notifications for coding tasks (per device, localStorage `one.coding.notify`): when a task waits at a
 * gate, has a question, failed or is done while this tab is in the background. Never while the person looks
 * at One; a click brings the tab forward and opens the task.
 */
import { resolveAssetUrl } from '../../lib/files'
import { navigate } from '../../lib/router'
import { t } from '../../i18n'

const KEY = 'one.coding.notify'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

export function notifyPermission(): NotificationPermission | 'unsupported' {
  return notifySupported() ? Notification.permission : 'unsupported'
}

/** Switched on here and allowed by the browser. */
export function notifyEnabled(): boolean {
  try {
    return notifySupported() && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted'
  } catch {
    return false
  }
}

/** Switch on (asks the browser once) or off; false when the browser refused. */
export async function setNotify(on: boolean): Promise<boolean> {
  try {
    if (!on) {
      localStorage.removeItem(KEY)
      return true
    }
    if (!notifySupported()) return false
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (perm !== 'granted') return false
    localStorage.setItem(KEY, '1')
    return true
  } catch {
    return false
  }
}

/** One isn't in front: the tab is hidden or another window has the focus. */
const away = () => document.visibilityState === 'hidden' || !document.hasFocus()

export function notifyAway(taskId: string, body: string): void {
  if (!notifyEnabled() || !away()) return
  try {
    const n = new Notification(t('features.coding.notify.title'), { body, tag: `one-coding-${taskId}`, icon: resolveAssetUrl('assets/icons/app-icon.png') })
    n.onclick = () => {
      window.focus()
      navigate({ name: 'page', id: taskId })
      n.close()
    }
  } catch {
    // some browsers only show notifications from a service worker: the toast stays
  }
}
