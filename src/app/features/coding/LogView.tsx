/**
 * The live log of a task on this device (≤ 2000 lines, IndexedDB "one-coding"): time, kind, text. Sticks to
 * the bottom while new lines arrive (unless the person scrolled up); the newest 400 lines first, all on ask.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useT } from '../../i18n'
import type { LogLine } from './protocol'
import { lineText } from './lines'

const SHOW = 400

/** A tool call: only its name ("Read", "Bash", "one-task · one_task_note"); what it was called with opens on a click. */
function ToolCall({ s }: { s: string }) {
  const cut = s.indexOf(' ')
  const name = (cut < 0 ? s : s.slice(0, cut)).replace(/^mcp__(.+?)__/, '$1 · ')
  const arg = cut < 0 ? '' : s.slice(cut + 1).trim()
  if (!arg) return <span className="clog-s clog-tool__name">{name}</span>
  return (
    <details className="clog-s clog-tool">
      <summary>
        <span className="clog-tool__name">{name}</span>
      </summary>
      <span className="clog-tool__arg">{arg}</span>
    </details>
  )
}

export function LogView({ lines, onClear }: { lines: LogLine[]; onClear?: () => void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  const stick = useRef(true)
  const shown = all ? lines : lines.slice(-SHOW)

  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown.length, lines])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  if (!lines.length) return <p className="ctk-empty">{t('features.coding.log.empty')}</p>
  return (
    <div className="clog">
      {!all && lines.length > SHOW && (
        <button type="button" className="btn btn--sm btn--ghost clog-more" onClick={() => setAll(true)}>
          {t('features.coding.log.all', { n: lines.length })}
        </button>
      )}
      <div ref={box} className="clog-lines" role="log" aria-live="polite" aria-label={t('features.coding.tab.log')} data-testid="coding-log" tabIndex={0}>
        {shown.map((l, i) => (
          <div key={i} className="clog-line" data-k={l.k}>
            <span className="clog-t">{format(l.t, 'HH:mm:ss')}</span>
            <span className="clog-k">{t(`features.coding.log.k.${l.k}`)}</span>
            {l.k === 'tool' ? <ToolCall s={l.s} /> : <span className="clog-s">{lineText(t, l)}</span>}
          </div>
        ))}
      </div>
      {onClear && (
        <div className="clog-foot">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClear}>
            {t('features.coding.log.clear')}
          </button>
        </div>
      )}
    </div>
  )
}
