/**
 * While a task runs: what the worker did last and how long ago (ticking), and the running counters —
 * Claude Code's step of the stage's limit, its cost estimate so far, the files changed in the worktree.
 */
import { useEffect, useState } from 'react'
import { useLang, useT } from '../../i18n'
import type { ID } from '../../store/types'
import { loadTask, useTaskLog } from './local'
import { useCoding } from './state'
import { lineText } from './lines'
import type { GitFile } from './protocol'

function useAgo(since: number | null): string {
  const t = useT()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  const time = s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`
  return t('features.coding.now.ago', { time })
}

export function NowLine({ taskId }: { taskId: ID }) {
  const t = useT()
  const log = useTaskLog(taskId)
  const last = log.length ? log[log.length - 1]! : null
  const ago = useAgo(last?.t ?? null)
  useEffect(() => {
    void loadTask(taskId)
  }, [taskId])
  const text = last ? lineText(t, last).split('\n')[0]!.trim() : t('features.coding.now.waiting')
  return (
    <p className="ctk-now" data-k={last?.k} data-testid="coding-now">
      <span className="label ctk-now__label">{t('features.coding.now.label')}</span>
      <span className="ctk-now__s" title={text}>
        {text}
      </span>
      {ago && <span className="label ctk-now__ago">{ago}</span>}
    </p>
  )
}

export function RunCounters({ taskId, files, onFiles }: { taskId: ID; files: GitFile[]; onFiles?: () => void }) {
  const t = useT()
  const lang = useLang()
  const p = useCoding((s) => s.progress[taskId])
  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  const money = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  if (!p && !files.length) return null
  return (
    <div className="ctk-chips">
      {p && p.maxTurns > 0 && (
        <span className="label ctk-chip" title={t('features.coding.now.stepsHint')} data-testid="coding-steps">
          {t('features.coding.now.steps', { n: p.turns, max: p.maxTurns })}
        </span>
      )}
      {p && p.cost !== null && (
        <span className="label ctk-chip" title={t('features.coding.now.costHint')} data-testid="coding-estimate">
          ≈ +{money(p.cost)}
        </span>
      )}
      {files.length > 0 && (
        <button type="button" className="label ctk-chip ctk-chip--btn" onClick={onFiles} title={t('features.coding.now.filesHint')} data-testid="coding-files">
          {t('features.coding.now.files', { n: files.length })} <span className="ctk-chip__add">+{add}</span> <span className="ctk-chip__del">−{del}</span>
        </button>
      )}
    </div>
  )
}
