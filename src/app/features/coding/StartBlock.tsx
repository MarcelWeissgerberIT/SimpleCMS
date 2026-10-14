/**
 * The worker's start lines for the person's computer (startLines.ts): a two-key switch Windows | macOS · Linux —
 * one choice per tab, shared by every place that shows lines (the card's step 2, the manual setup, the init line of
 * a refusal); the default comes from the browser's platform — and per shell its copy key; Windows lines are labelled
 * PowerShell / Command Prompt (cmd).
 */
import { useId, useSyncExternalStore } from 'react'
import { useT } from '../../i18n'
import { onRovingKey } from '../../ui/roving'
import { CodeBlock } from './CodeBlock'
import type { StartLine, StartOs, StartShell } from './startLines'
import { browserOs } from './winWorker'

let picked: StartOs | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The computer the lines are for: the person's pick in this tab, else what the browser says it runs on. */
export function startOs(): StartOs {
  return picked ?? browserOs()
}

export function setStartOs(os: StartOs): void {
  picked = os
  for (const fn of listeners) fn()
}

export function useStartOs(): StartOs {
  return useSyncExternalStore(subscribe, startOs)
}

const OPTIONS: StartOs[] = ['windows', 'posix']

/** Windows | macOS · Linux — a radiogroup with roving focus (all four arrows, as every radio group; Home, End). */
export function OsSwitch() {
  const t = useT()
  const os = useStartOs()
  const id = useId()
  return (
    <div className="cw-os">
      <span className="label cw-os__k" id={id}>
        {t('features.coding.os.label')}
      </span>
      <div className="cn-seg cw-os__seg" role="radiogroup" aria-labelledby={id} onKeyDown={(e) => onRovingKey(e, '[role="radio"]')} data-testid="coding-os">
        {OPTIONS.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={os === o} tabIndex={os === o ? 0 : -1} className="cn-seg__opt cw-os__opt" onClick={() => setStartOs(o)} data-testid={`coding-os-${o}`}>
            {t(`features.coding.os.${o}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * One block per shell for the switch's computer: `make(os)` gives the commands (each one line per shell), joined
 * line by line. `testId` marks the whole, `<testId>-<shell>` each block.
 */
export function StartBlock({ make, label, testId }: { make: (os: StartOs) => StartLine[][]; label: string; testId?: string }) {
  const t = useT()
  const os = useStartOs()
  const byShell = new Map<StartShell, string[]>()
  for (const command of make(os)) for (const l of command) byShell.set(l.shell, [...(byShell.get(l.shell) ?? []), l.line])
  return (
    <div className="cw-start" data-os={os} data-testid={testId}>
      {[...byShell].map(([shell, lines]) => {
        const code = lines.join('\n')
        const id = testId ? `${testId}-${shell}` : undefined
        if (os !== 'windows') return <CodeBlock key={shell} code={code} label={label} testId={id} />
        const name = t(`features.coding.shell.${shell}`)
        return (
          <div key={shell} className="cw-start__shell">
            <span className="label cw-start__k">{name}</span>
            <CodeBlock code={code} label={`${label} · ${name}`} testId={id} />
          </div>
        )
      })}
    </div>
  )
}
