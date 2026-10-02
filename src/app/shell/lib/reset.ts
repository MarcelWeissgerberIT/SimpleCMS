import { safeLocalGet, safeLocalSet } from '@/shared/brand'

/** localStorage flag: wipe all IndexedDB data on the next boot (before anything opens a connection). */
export const RESET_FLAG = 'one.resetPending'

export async function runPendingReset(): Promise<boolean> {
  if (safeLocalGet(RESET_FLAG) !== '1') return false
  safeLocalSet(RESET_FLAG, null)
  const names = new Set<string>(['keyval-store', 'one-files'])
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    for (const d of dbs) if (d.name) names.add(d.name)
  } catch {
    /* databases() unsupported */
  }
  await Promise.all(
    [...names].map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    ),
  )
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('one.shell.')) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
  return true
}
