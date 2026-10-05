/**
 * The run log of a script on this device: every run and dry run (status LED, when, how long, what it
 * did), its console, and "Undo run" for runs that changed something.
 */
import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { toast } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { loadScriptRuns, scriptScope, useScriptRuns } from '../runtime/runs'
import { canUndo, undoRun } from '../runtime/run'
import type { ScriptRun } from '../runtime/types'
import { ErrorLine, LogLines, Summary } from './Console'

const EMPTY: ScriptRun[] = []

export function useRuns(scriptId: ID): ScriptRun[] {
  const scope = scriptScope()
  const runs = useScriptRuns((s) => s.byScript[`${scope}|${scriptId}`])
  useEffect(() => {
    void loadScriptRuns(scriptId, scope)
  }, [scriptId, scope])
  return runs ?? EMPTY
}

function when(at: number, lang: string): string {
  const d = new Date(at)
  const today = new Date()
  const same = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return same ? time : `${d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: 'short' })} ${time}`
}

export function Runs({ scriptId, onJump }: { scriptId: ID; onJump: (line: number, col: number) => void }) {
  const t = useT()
  const lang = useLang()
  const runs = useRuns(scriptId)
  const [open, setOpen] = useState<string | null>(null)
  if (!runs.length) return <p className="sc-console__empty">{t('features.script.runs.empty')}</p>
  return (
    <ol className="sc-runs" data-testid="sc-runs">
      {runs.map((r) => {
        const expanded = open === r.id
        const led = r.status === 'ok' ? 'led led--ok' : r.status === 'error' ? 'led sc-led--err' : 'led'
        return (
          <li key={r.id} className={`sc-run${expanded ? ' is-open' : ''}`} data-mode={r.mode} data-status={r.status}>
            <button type="button" className="sc-run__head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}>
              <span className={led} aria-hidden />
              <span className={`sc-run__mode label${r.mode === 'dry' ? ' is-dry' : ''}`}>{t(`features.script.mode.${r.mode}`)}</span>
              <span className="sc-run__when mono">{when(r.at, lang)}</span>
              <span className="sc-run__status">{t(`features.script.status.${r.status}`)}</span>
              {r.undone && <span className="sc-run__undone label">{t('features.script.runs.undone')}</span>}
              <span className="sc-run__ms mono">{t('features.script.console.ms', { ms: r.ms })}</span>
            </button>
            {expanded && (
              <div className="sc-run__body">
                {r.status !== 'cancelled' && <Summary result={r} mode={r.mode} />}
                <LogLines log={r.log} onJump={onJump} />
                {r.error && <ErrorLine error={r.error} onJump={onJump} />}
                {canUndo(r) && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={async () => {
                      if (await undoRun(r)) toast({ message: t('features.script.runs.undoneToast'), kind: 'success' })
                    }}
                  >
                    <RotateCcw size={13} strokeWidth={1.8} aria-hidden /> {t('features.script.runs.undo')}
                  </button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
