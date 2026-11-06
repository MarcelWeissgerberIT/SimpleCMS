/** Local storage identity is pinned for the tab. Another tab choosing a workspace cannot redirect its writes. */
export const LOCAL_ID = /^[a-z0-9]{12}$/
export function parseLocalChoice(raw: string | null): string | null {
  if (raw === 'local') return 'local'
  return raw?.startsWith('local:') && LOCAL_ID.test(raw.slice(6)) ? raw.slice(6) : null
}
function initialId(): string {
  if (typeof window === 'undefined') return 'local'
  const override = new URLSearchParams(window.location.search).get('w')
  if (override) return parseLocalChoice(override) ?? 'local'
  try { return parseLocalChoice(localStorage.getItem('one.cloud.active')) ?? 'local' } catch { return 'local' }
}
export const localStorageId = initialId()
export const localDatabase = (id = localStorageId) => id === 'local' ? 'keyval-store' : `one-local-${id}`
export const localChannel = (name: string) => localStorageId === 'local' ? name : `${name}:${localStorageId}`
