/**
 * Word-level diff for the redo review: before → after as runs of kept / removed / added text.
 * LCS over word tokens (whitespace stays attached to the token before it). Very long passages fall
 * back to "all removed, all added".
 */
export type DiffOp = 'same' | 'del' | 'add'
export interface DiffRun {
  op: DiffOp
  text: string
}

const tokens = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? []

export function wordDiff(before: string, after: string): DiffRun[] {
  const a = tokens(before)
  const b = tokens(after)
  if (a.length * b.length > 1_500_000) return [...(before ? [{ op: 'del' as const, text: before }] : []), ...(after ? [{ op: 'add' as const, text: after }] : [])]
  // LCS table (suffix lengths), then walk
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffRun[] = []
  const push = (op: DiffOp, text: string) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++])
    else push('add', b[j++])
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  // whitespace alone between two changes reads better as part of the change
  return out.filter((r) => r.text !== '')
}

/** Words removed / added (for the counter). */
export function diffCounts(runs: DiffRun[]): { del: number; add: number } {
  const words = (s: string) => (s.match(/\S+/g) ?? []).length
  return runs.reduce((c, r) => (r.op === 'del' ? { ...c, del: c.del + words(r.text) } : r.op === 'add' ? { ...c, add: c.add + words(r.text) } : c), { del: 0, add: 0 })
}
