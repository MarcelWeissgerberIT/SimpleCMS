/**
 * What one Edit / MultiEdit / Write of Claude Code changed (LogLine.e), as a small diff under its tool call in the
 * log: per change the lines that went (−) and came (+), the unchanged lines around them dimmed, syntax colours as
 * in the Diff tab. A Write shows the file's text as new.
 */
import { useMemo } from 'react'
import { useT } from '../../i18n'
import type { ToolEdit } from './protocol'
import { code, langOf } from './DiffView'

interface Row {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

/** The lines of a text (a final line break ends the last line — it is no empty line of its own). */
export const linesOf = (s: string): string[] => (s ? s.replace(/\n$/, '').split('\n') : [])

/** A line diff of one change: common lines at both ends kept as context, the middle by LCS (small) or as a block. */
export function lineDiff(before: string, after: string): Row[] {
  const a = linesOf(before)
  const b = linesOf(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const rows: Row[] = a.slice(0, start).map((text) => ({ kind: 'ctx', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length * midB.length <= 40_000) {
    // longest common subsequence of the middle
    const n = midA.length
    const m = midB.length
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = midA[i] === midB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    let i = 0
    let j = 0
    // what went before what came, like git
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        rows.push({ kind: 'ctx', text: midA[i]! })
        i++
        j++
      } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) rows.push({ kind: 'del', text: midA[i++]! })
      else rows.push({ kind: 'add', text: midB[j++]! })
    }
  } else {
    for (const text of midA) rows.push({ kind: 'del', text })
    for (const text of midB) rows.push({ kind: 'add', text })
  }
  for (const text of a.slice(endA)) rows.push({ kind: 'ctx', text })
  // context: at most 3 lines around the changes
  const near = rows.map((r, i) => r.kind !== 'ctx' || rows.slice(Math.max(0, i - 3), i + 4).some((x) => x.kind !== 'ctx'))
  return rows.filter((_, i) => near[i])
}

export function EditDiff({ edit }: { edit: ToolEdit }) {
  const t = useT()
  const lang = useMemo(() => langOf(edit.path), [edit.path])
  const parts = useMemo(() => edit.hunks.map((h) => lineDiff(h.old, h.new)), [edit])
  return (
    <div className="clog-edit" data-testid="coding-log-edit">
      <span className="clog-edit__path mono">{edit.path}</span>
      {parts.map((rows, k) => (
        <div key={k} className="clog-edit__box">
          <table className="cd-table clog-edit__table syn-hl">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`cd-row cd-row--${r.kind}`}>
                  <td className="cd-code">
                    <span className="cd-sign" aria-hidden>
                      {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
                    </span>
                    {code(r.text, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {edit.clipped && <span className="ctk-hint">{t('features.coding.log.editClipped')}</span>}
    </div>
  )
}
