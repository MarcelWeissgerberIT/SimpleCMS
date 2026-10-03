import { resolveAssetUrl } from '../../lib/files'

/**
 * Browser notifications (Notification API). Off unless the person switches them on in the inbox
 * settings; permission is only ever asked on that click. Shown while the app is in the background
 * (in front, the toast says it already).
 */
export type NotifyPermission = NotificationPermission | 'unsupported'

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Ask for permission — call only from a click. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function showNotification(title: string, body: string, tag: string, onClick: () => void): void {
  if (notifyPermission() !== 'granted') return
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  try {
    const n = new Notification(title, { body, tag, icon: resolveAssetUrl('assets/icons/app-icon.png') })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  } catch (e) {
    // e.g. Android Chrome only allows notifications from a service worker
    console.warn('[one] notification failed', e)
  }
}
