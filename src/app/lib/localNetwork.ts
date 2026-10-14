/**
 * Chrome's Local Network Access permission: may this page reach apps on this device (ws://127.0.0.1 — the MCP bridge,
 * the coding worker)? Chrome names it differently across versions; a browser without it answers null. A pure browser
 * helper: no area imports.
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
