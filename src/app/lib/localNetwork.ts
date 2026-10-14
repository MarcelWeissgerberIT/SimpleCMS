/**
 * Chrome's Local Network Access permission: may this page reach apps on this device (ws://127.0.0.1 — the MCP bridge,
 * the coding worker)? Chrome names it differently across versions; a browser without it answers null. And where the
 * person changes it: `inAppWindow()` (an installed app's window has no address bar). A pure browser helper: no area
 * imports.
 */
const NAMES = ['loopback-network', 'local-network-access', 'local-network']

/** The permission's status object (its `change` event follows the person's choice), or null where it does not exist. */
export async function localNetworkStatus(): Promise<PermissionStatus | null> {
  for (const name of NAMES) {
    try {
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch {
      /* not a permission this browser knows (or no Permissions API) */
    }
  }
  return null
}

/** 'granted' · 'denied' · 'prompt', where the permission exists. */
export async function localNetworkPermission(): Promise<PermissionState | null> {
  return (await localNetworkStatus())?.state ?? null
}

/** Display modes of an installed app's own window (no address bar there; `fullscreen` is F11 in a tab too). */
const APP_WINDOW = ['standalone', 'minimal-ui', 'window-controls-overlay']

/**
 * Does One run in an installed app's window? There is no address bar and no site-info icon to its left there: the
 * site's settings (this permission, notifications) are under the window's ⋮ menu → App info.
 */
export function inAppWindow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return APP_WINDOW.some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
}
