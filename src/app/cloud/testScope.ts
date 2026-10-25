/** A test view has its own disposable copies. Never read/write the owner's settings or offline cache. */
export interface TestScope { id: string; workspaceId: string; name: string; guest: boolean; role: string; expiresAt: number; actorName: string }
export const TEST_ACCESS_CHANGE = 'one.test-access.changed'
const RETURN_URL = 'one.test-access.return-url'
let scope: TestScope | null = null
let testing = false
try { testing = new URLSearchParams(location.search).has('test-access') || JSON.parse(localStorage.getItem(TEST_ACCESS_CHANGE) || 'null')?.mode === 'test' } catch { /* no browser storage */ }
export const isTestAccess = () => testing
export const testScope = () => scope
export function setTestScope(value: TestScope | null) { scope = value; testing = !!value }
export const testCopyName = (name: string) => testing ? `one-test:${scope?.id ?? 'pending'}:${name}` : name
function saveReturn() { try { if (!new URLSearchParams(location.search).has('test-access')) sessionStorage.setItem(RETURN_URL, location.pathname + location.search + location.hash) } catch { /* optional */ } }
function go(mode: string, workspaceId?: string) {
  if (mode === 'test') {
    saveReturn()
    const u = new URL(location.href); u.search = ''; u.searchParams.set('w', workspaceId!); u.searchParams.set('test-access', '1'); u.hash = '#/'
    location.assign(u.href)
  } else {
    let target = `${location.pathname}${workspaceId ? `?w=${encodeURIComponent(workspaceId)}` : ''}#/`
    try { const saved = sessionStorage.getItem(RETURN_URL); if (saved && new URL(saved, location.origin).origin === location.origin) target = saved; sessionStorage.removeItem(RETURN_URL) } catch { /* optional */ }
    location.assign(target)
  }
}
export function testAppearance(): {language?: 'de' | 'en'; theme?: 'light' | 'dark' | 'system'} {
  try { const a = JSON.parse(localStorage.getItem(TEST_ACCESS_CHANGE) || 'null')?.appearance; return { ...(a?.language === 'de' || a?.language === 'en' ? {language:a.language} : {}), ...(['light','dark','system'].includes(a?.theme) ? {theme:a.theme} : {}) } } catch { return {} }
}
export function changeTestAccess(mode: 'test' | 'owner', workspaceId?: string, appearance?: {language: string; theme: string}) {
  try { localStorage.setItem(TEST_ACCESS_CHANGE, JSON.stringify({ mode, workspaceId, appearance, at: Date.now() })) } catch { /* same-tab still works */ }
  go(mode, workspaceId)
}
export function listenTestAccess() {
  window.addEventListener('storage', e => {
    if (e.key !== TEST_ACCESS_CHANGE || !e.newValue) return
    try { const v = JSON.parse(e.newValue); if ((v.mode === 'test' && typeof v.workspaceId === 'string') || v.mode === 'owner') go(v.mode, v.workspaceId) } catch { /* ignore malformed events */ }
  })
}
