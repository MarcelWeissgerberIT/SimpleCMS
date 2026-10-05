/**
 * The run console under the editor: status readout, what a dry run would do (or a run did), the
 * script's print / log lines (lists of rows as small tables), the result of "evaluate", the error
 * with a link to its line.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '../../../i18n'
import { openPage } from '../../../lib/router'
import type { ChangeItem, ErrorInfo, LogLine } from '../runtime/types'
import type { RunResult } from '../runtime/run'
import { ResultTable } from './ResultTable'
import { summarize } from './summary'
import { errorMessage } from './errors'
import { rowsLabel } from './format'

export interface Output {
  mode: 'run' | 'dry' | 'query' | 'eval'
  running: boolean
  log: LogLine[]
  result: RunResult | null
}

const GLYPH: Record<LogLine['kind'], string> = { print: '›', log: '·', info: 'i', warn: '!', error: '✕', effect: '↗' }

export function ErrorLine({ error, onJump }: { error: ErrorInfo; onJump?: (line: number, col: number) => void }) {
  const t = useT()
  return (
    <div className="sc-err" role="alert">
      <span className="sc-err__glyph" aria-hidden>
        ✕
      </span>
      {error.line !== null && onJump ? (
        <button type="button" className="sc-err__at mono" onClick={() => onJump(error.line!, error.col ?? 1)} title={t('features.script.console.jump')}>
          {error.line}:{error.col ?? 1}
        </button>
      ) : error.line !== null ? (
        <span className="sc-err__at mono">
          {error.line}:{error.col ?? 1}
        </span>
      ) : null}
      <span className="sc-err__text">{errorMessage(error, t)}</span>
    </div>
  )
}

export function ChangeList({ items }: { items: ChangeItem[] }) {
  const t = useT()
  return (
    <ul className="sc-changes">
      {items.slice(0, 50).map((c, i) => (
        <li key={`${c.pageId}${i}`}>
          {c.pageId.startsWith('draft-') ? (
            <span className="sc-changes__title">{c.title || t('common.untitled')}</span>
          ) : (
            <a
              href={`#/p/${c.pageId}`}
              className="sc-changes__title"
              onClick={(e) => {
                e.preventDefault()
                openPage(c.pageId)
              }}
            >
              {c.title || t('common.untitled')}
            </a>
          )}
          {c.props?.map((p) => (
            <span key={p.name} className="sc-changes__prop">
              <span className="label">{p.name}</span> <s>{p.before || '—'}</s> → <b>{p.after || '—'}</b>
            </span>
          ))}
          {c.how && <span className="sc-changes__prop label">{t(`features.script.console.how.${c.how}`)}</span>}
        </li>
      ))}
      {items.length > 50 && <li className="label">{t('features.script.result.more', { n: items.length - 50 })}</li>}
    </ul>
  )
}

export function Summary({ result, mode }: { result: Pick<RunResult, 'changes' | 'effects'>; mode: 'dry' | 'run' }) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)
  const lines = summarize(result.changes, result.effects, mode, t)
  return (
    <section className={`sc-summary sc-summary--${mode}`} aria-label={t(mode === 'dry' ? 'features.script.sum.dryHead' : 'features.script.sum.runHead')}>
      <h3 className="sc-summary__head label">{t(mode === 'dry' ? 'features.script.sum.dryHead' : 'features.script.sum.runHead')}</h3>
      {lines.length ? (
        <ul className="sc-summary__list">
          {lines.map((l) => (
            <li key={l.key}>
              {l.items?.length ? (
                <>
                  <button type="button" className="sc-summary__toggle" aria-expanded={open === l.key} onClick={() => setOpen(open === l.key ? null : l.key)}>
                    <ChevronRight size={13} strokeWidth={1.8} aria-hidden className={open === l.key ? 'is-open' : ''} />
                    {l.text}
                  </button>
                  {open === l.key && <ChangeList items={l.items} />}
                </>
              ) : (
                <span className="sc-summary__plain">{l.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sc-summary__none">{t(mode === 'dry' ? 'features.script.sum.dryNothing' : 'features.script.sum.runNothing')}</p>
      )}
    </section>
  )
}

export function LogLines({ log, onJump }: { log: LogLine[]; onJump?: (line: number, col: number) => void }) {
  const t = useT()
  if (!log.length) return null
  return (
    <ol className="sc-log">
      {log.map((l, i) => (
        <li key={i} className={`sc-log__line sc-log__line--${l.kind}`}>
          <span className="sc-log__glyph" aria-hidden>
            {GLYPH[l.kind]}
          </span>
          {l.line && onJump ? (
            <button type="button" className="sc-log__at mono" onClick={() => onJump(l.line!, 1)} aria-label={t('features.script.console.line', { n: l.line })}>
              L{l.line}
            </button>
          ) : (
            <span className="sc-log__at mono">{l.line ? `L${l.line}` : ''}</span>
          )}
          {l.table ? (
            <div className="sc-log__body">
              <span className="sc-log__count label">{rowsLabel(t, l.table.total)}</span>
              <ResultTable table={l.table} compact />
            </div>
          ) : (
            <span className="sc-log__text">{l.text}</span>
          )}
        </li>
      ))}
    </ol>
  )
}

export function Console({ out, onJump }: { out: Output | null; onJump: (line: number, col: number) => void }) {
  const t = useT()
  if (!out) return <p className="sc-console__empty">{t('features.script.console.empty')}</p>
  const r = out.result
  const status = out.running ? 'running' : (r?.status ?? 'ok')
  return (
    <div className="sc-console__body" data-testid="sc-console" data-status={status}>
      <div className="sc-console__status label">
        <span className={`led ${status === 'running' ? 'led--on sc-led--live' : status === 'ok' ? 'led--ok' : status === 'error' ? 'sc-led--err' : ''}`} aria-hidden />
        <span>{t(`features.script.status.${status}`)}</span>
        <span className="sc-console__mode">{t(`features.script.mode.${out.mode}`)}</span>
        {r && !out.running && <span className="mono">{t('features.script.console.ms', { ms: r.ms })}</span>}
      </div>
      {r && !out.running && (out.mode === 'dry' || out.mode === 'run') && r.status !== 'cancelled' && <Summary result={r} mode={out.mode} />}
      <LogLines log={out.log} onJump={onJump} />
      {r && !out.running && (out.mode === 'eval' || out.mode === 'query') && !r.error && (
        <div className="sc-console__value">
          {r.table ? (
            <>
              <span className="sc-log__count label">{rowsLabel(t, r.table.total)}</span>
              <ResultTable table={r.table} compact />
            </>
          ) : (
            <pre className="sc-console__pre">= {r.text || 'null'}</pre>
          )}
        </div>
      )}
      {r?.error && !out.running && <ErrorLine error={r.error} onJump={onJump} />}
    </div>
  )
}
