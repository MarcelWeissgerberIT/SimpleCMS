/**
 * The review of a staged One Script (write_script): a new script as its code, a changed one as a line
 * diff against the version it was staged on (removed lines struck on a red tint, new ones on the signal
 * tint, long unchanged runs folded). @ references show as "@Title". Applying saves it — it never runs.
 */
import { useMemo } from 'react'
import { useT } from '../../../i18n'
import type { StagedChange } from './types'
import './scriptDiff.css'

type Line = { op: 'same' | 'add' | 'del'; text: string }

/** "@[Tasks](p:abc)" → "@Tasks". */
const readable = (code: string) => code.replace(/@\[((?:[^\]\\]|\\.)*)\]\((?:p|u|a|s):[\w-]+\)/g, (_m, label: string) => `@${label.replace(/\\(.)/g, '$1')}`)

const LCS_MAX = 400

/** A line diff (longest common subsequence; very long scripts: all removed, all added). */
export function lineDiff(before: string, after: string): Line[] {
  const a = before.trimEnd().split('\n')
  const b = after.trimEnd().split('\n')
  if (a.length > LCS_MAX || b.length > LCS_MAX) return [...a.map((text) => ({ op: 'del' as const, text })), ...b.map((text) => ({ op: 'add' as const, text }))]
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: 'del', text: a[i++] })
    else out.push({ op: 'add', text: b[j++] })
  }
  while (i < n) out.push({ op: 'del', text: a[i++] })
  while (j < m) out.push({ op: 'add', text: b[j++] })
  return out
}

/** Unchanged runs longer than 2·context+1 lines fold to "…". */
function folded(lines: Line[], context = 2): Array<Line | { op: 'fold'; n: number }> {
  const out: Array<Line | { op: 'fold'; n: number }> = []
  let run: Line[] = []
  const flush = (end: boolean) => {
    const head = out.length === 0
    if (run.length > context * 2 + 1) {
      if (!head) out.push(...run.slice(0, context))
      out.push({ op: 'fold', n: run.length - (head ? 0 : context) - (end ? 0 : context) })
      if (!end) out.push(...run.slice(-context))
    } else out.push(...run)
    run = []
  }
  for (const l of lines) {
    if (l.op === 'same') run.push(l)
    else {
      flush(false)
      out.push(l)
    }
  }
  flush(true)
  return out
}

const SHOWN_MAX = 40

export function ScriptDiff({ change: c }: { change: StagedChange }) {
  const t = useT()
  const sc = c.script
  const rows = useMemo(() => {
    if (!sc) return []
    if (!sc.before) return readable(sc.code).trimEnd().split('\n').map((text): Line => ({ op: 'add', text }))
    return folded(lineDiff(readable(sc.before.code), readable(sc.code)))
  }, [sc])
  if (!sc) return null
  const add = rows.filter((r) => r.op === 'add').length
  const del = rows.filter((r) => r.op === 'del').length
  const shown = rows.slice(0, SHOWN_MAX)
  return (
    <div className="agent-script" data-testid="script-diff">
      <div className="agent-script__meta label">
        <span>{t(`features.script.kind.${sc.kind}`)}</span>
        {sc.before && sc.before.name !== sc.name && <span className="agent-script__rename">{t('features.script.int.review.renamed', { name: sc.before.name })}</span>}
        <span className="agent-spacer" />
        {sc.before ? (
          <>
            {del > 0 && <span className="agent-script__count" data-kind="del">−{del}</span>}
            {add > 0 && <span className="agent-script__count" data-kind="add">+{add}</span>}
          </>
        ) : (
          <span className="agent-script__count">{t(add === 1 ? 'features.script.lines.one' : 'features.script.lines.other', { n: add })}</span>
        )}
      </div>
      <pre className="agent-script__code" aria-label={t('features.script.int.review.code')}>
        {shown.map((r, i) =>
          r.op === 'fold' ? (
            <span key={i} className="agent-script__line" data-op="fold">
              {t('features.script.int.review.fold', { n: r.n })}
            </span>
          ) : (
            <span key={i} className="agent-script__line" data-op={sc.before ? r.op : 'same'}>
              <span className="agent-script__sign" aria-hidden>
                {sc.before ? (r.op === 'add' ? '+' : r.op === 'del' ? '−' : ' ') : ''}
              </span>
              {r.op === 'del' ? <s>{r.text || ' '}</s> : r.text || ' '}
            </span>
          ),
        )}
        {rows.length > SHOWN_MAX && <span className="agent-script__line" data-op="fold">{t('features.script.int.review.more', { n: rows.length - SHOWN_MAX })}</span>}
      </pre>
      {sc.description && <p className="agent-script__desc">{sc.description}</p>}
      <p className="agent-script__note">{t('features.script.int.review.note')}</p>
    </div>
  )
}
