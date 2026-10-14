/**
 * What a worker log line's text needs beyond the values the worker sends — pure, so coding-lines.spec renders lines
 * exactly as lines.ts does. A synced folder's warning (`onedrive` · `cloudStorage`) says where the task worktrees are
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

export function logValues(code: string, v: Record<string, string | number>, t: (key: string) => string): Record<string, string | number> {
  if (!SYNCED.has(code)) return v
  const at = typeof v.worktrees === 'string' && Object.hasOwn(WORKTREES, v.worktrees) ? WORKTREES[v.worktrees]!(code) : 'unknown'
  return { ...v, wt: t(`features.coding.log.wt.${at}`) }
}
