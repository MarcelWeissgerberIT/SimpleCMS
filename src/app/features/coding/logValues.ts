/**
 * What a worker log line's text needs beyond the values the worker sends — pure, so coding-lines.spec renders lines
 * exactly as lines.ts does. A request line (`requestOpened` · `requestExisting` · `requestLink`, worker 1.10.0) names
 * the request by its `kind` ('mr' · 'pr'): `req` / `reqLower` in the person's language (anything else reads as a merge
 * request). A synced folder's warning (`onedrive` · `cloudStorage`) says where the task worktrees are
 * by the line's `worktrees` (worker 1.9.0, paths.ts worktreesAt): `home` — the default folder, named per computer;
 * `own` — elsewhere outside the synced folder (worktreeDir, a cloud worker's own folder); `synced` — in a synced folder
 * too. A line without the value (or with one One does not know) says only what holds in every case.
 */
const WORKTREES: Record<string, (code: string) => string> = {
  home: (code) => (code === 'onedrive' ? 'homeWin' : 'homeMac'),
  own: () => 'own',
  synced: () => 'synced',
}

const SYNCED = new Set(['onedrive', 'cloudStorage'])
const REQ = new Set(['requestOpened', 'requestExisting', 'requestLink'])

/** worker 1.11.0: how a permission request ended — in the person's language (an unknown one: as the worker wrote it). */
const HOW = new Set(['once', 'always', 'rule', 'you', 'timeout', 'stopped', 'away', 'long'])
const PERM = new Set(['permissionAllowed', 'permissionDenied'])

export function logValues(code: string, v: Record<string, string | number>, t: (key: string) => string): Record<string, string | number> {
  if (PERM.has(code)) {
    const how = typeof v.how === 'string' && HOW.has(v.how) ? t(`features.coding.log.how.${v.how}`) : String(v.how ?? '')
    return { ...v, how, what: String(v.what ?? '').trim() || '—' }
  }
  if (code === 'permissionAsked') return { ...v, what: String(v.what ?? '').trim() || '—' }
  if (REQ.has(code)) {
    const k = v.kind === 'pr' ? 'pr' : 'mr'
    return { ...v, req: t(`features.coding.log.req.${k}`), reqLower: t(`features.coding.log.req.${k}Lower`) }
  }
  if (!SYNCED.has(code)) return v
  const at = typeof v.worktrees === 'string' && Object.hasOwn(WORKTREES, v.worktrees) ? WORKTREES[v.worktrees]!(code) : 'unknown'
  return { ...v, wt: t(`features.coding.log.wt.${at}`) }
}
