/**
 * One MCP — the approval card (Ask first): bottom right, one change at a time (a queue counter
 * when more wait). It names the workspace the change is for (switching the tab's workspace cancels
 * it). Approve ↵ / Reject Esc while the card has focus; it takes focus when it appears unless the
 * person is typing. A hairline drains over the two-minute window.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import { useT } from '../../i18n'
import { approveMcp, rejectMcp } from './service'
import { clientLabel, useMcp, type McpApproval } from './state'
import { titleIfClipped } from '../../ui/clip'
import type { PlanLine } from './write'
import './mcp.css'

export function ApprovalHost() {
  const approvals = useMcp((s) => s.approvals)
  const t = useT()
  if (!approvals.length) return null
  const a = approvals[0]
  return (
    <div className="mcp-dock" role="region" aria-label={t('features.mcp.card.region')}>
      <ApprovalCard key={a.id} approval={a} total={approvals.length} />
    </div>
  )
}

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

function Countdown({ approval }: { approval: McpApproval }) {
  const [left, setLeft] = useState(() => Math.max(0, approval.expiresAt - Date.now()))
  useEffect(() => {
    const i = window.setInterval(() => setLeft(Math.max(0, approval.expiresAt - Date.now())), 1000)
    return () => window.clearInterval(i)
  }, [approval.expiresAt])
  const s = Math.ceil(left / 1000)
  const total = approval.expiresAt - approval.at
  return (
    <>
      <span className="mcp-card__clock" aria-hidden>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </span>
      <span className="mcp-card__drain" aria-hidden>
        <span style={{ animationDuration: `${total}ms`, animationDelay: `${-(total - left)}ms` }} />
      </span>
    </>
  )
}

function Line({ line }: { line: PlanLine }) {
  const t = useT()
  switch (line.k) {
    case 'prop':
      return (
        <div className="mcp-line">
          <dt>{line.name}</dt>
          <dd>
            {line.before !== undefined && (
              <>
                <span className="mcp-line__before">{line.before || '—'}</span>
                <span className="mcp-line__arrow" aria-label={t('features.mcp.card.to')}>
                  →
                </span>
              </>
            )}
            <span className="mcp-line__after">{line.after || '—'}</span>
            {line.fresh?.length ? <span className="mcp-line__new">{t('features.mcp.card.newOption')}</span> : null}
          </dd>
        </div>
      )
    case 'fact':
      return (
        // a batch's numbered line ("01"): the number takes only its own width, the title gets the rest
        <div className="mcp-line" data-num={numbered(line) || undefined}>
          <dt onMouseEnter={titleIfClipped}>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      )
    case 'md':
      return (
        <div className="mcp-line mcp-line--md">
          <dt>{line.label}</dt>
          <dd>
            <pre className="mcp-md">{line.value}</pre>
          </dd>
        </div>
      )
    case 'note':
      return <p className="mcp-line__note">{line.value}</p>
    case 'item':
      return (
        <div className="mcp-line mcp-line--item" data-tag={line.tag}>
          <dt>
            {t('features.workItems.facts.task')} · {t(`features.workItems.facts.${line.tag}`)}
          </dt>
          <dd>
            <span className="mcp-line__title">{line.title}</span>
            {line.facts && <span className="mcp-line__facts">{line.facts}</span>}
            {line.warn && <span className="mcp-line__warn">{line.warn}</span>}
          </dd>
        </div>
      )
  }
}

/** A batch's numbered line ("01"): the number takes only its own width, the title gets the rest. */
const numbered = (l: PlanLine) => l.k === 'fact' && /^\d{1,3}$/.test(l.label)

/** How many of the lines are things the person approves (a batch's rows, pages …) — never its facts, notes or texts. */
const entriesOf = (lines: readonly PlanLine[]) => lines.filter((l) => numbered(l) || (l.k === 'fact' && l.entry)).length

/**
 * The card's lines: its only scroll area (the card is capped at the viewport — head, workspace, summary, time and the
 * keys always stay in view, however many lines a batch has). Focusable while it scrolls, so the keyboard can read it.
 */
function Lines({ id, lines }: { id: string; lines: PlanLine[] }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setScrolls(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [lines])
  const entries = entriesOf(lines)
  return (
    <>
      <div ref={ref} className="mcp-card__scroll" role="region" aria-label={t('features.mcp.card.lines')} tabIndex={scrolls ? 0 : -1} data-scrolls={scrolls || undefined}>
        <dl className="mcp-card__lines" id={id}>
          {lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </dl>
      </div>
      {scrolls && (
        <p className="label mcp-card__more" aria-hidden>
          {/* the entries the person approves (the summary's number), else no number at all */}
          {entries > 1 ? t('features.mcp.card.scrollHint', { n: entries }) : t('features.mcp.card.scrollHintAll')}
        </p>
      )}
    </>
  )
}

function ApprovalCard({ approval, total }: { approval: McpApproval; total: number }) {
  const t = useT()
  const uid = useId()
  const client = useMcp((s) => clientLabel(s.client))
  const approveRef = useRef<HTMLButtonElement>(null)
  const { plan } = approval

  useEffect(() => {
    if (!typing()) approveRef.current?.focus({ preventScroll: true })
  }, [approval.id])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      rejectMcp(approval.id)
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      approveMcp(approval.id)
    }
  }

  return (
    <section
      className="mcp-card"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${uid}-sum`}
      aria-describedby={`${uid}-ws ${uid}-lines`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-tool={plan.tool}
    >
      <header className="mcp-card__head">
        <span className="led led--on mcp-card__led" aria-hidden />
        <span className="label mcp-card__who">{client ? t('features.mcp.card.from', { client }) : t('features.mcp.card.agent')}</span>
        <span className="label mcp-card__verb">{plan.verb}</span>
        {total > 1 && <span className="label mcp-card__count">{t('features.mcp.card.queue', { n: 1, total })}</span>}
      </header>
      <p className="mcp-card__ws" id={`${uid}-ws`} data-testid="mcp-card-workspace" title={approval.workspace.id}>
        <span className="label">{t('features.mcp.card.workspace')}</span>
        <span className="mcp-card__wsname">{approval.workspace.name}</span>
      </p>
      <p className="mcp-card__sum" id={`${uid}-sum`}>
        {plan.summary}
      </p>
      {plan.lines.length > 0 && <Lines id={`${uid}-lines`} lines={plan.lines} />}
      <div className="mcp-card__time">
        <span className="label">{t('features.mcp.card.expires')}</span>
        <Countdown approval={approval} />
      </div>
      <footer className="mcp-card__actions">
        <button type="button" className="btn btn--sm mcp-card__reject" onClick={() => rejectMcp(approval.id)}>
          <X size={13} strokeWidth={1.75} aria-hidden />
          {t('features.mcp.card.reject')}
          <kbd className="kbd" aria-hidden>
            Esc
          </kbd>
        </button>
        <button ref={approveRef} type="button" className="btn btn--sm btn--primary mcp-card__approve" onClick={() => approveMcp(approval.id)}>
          <Check size={13} strokeWidth={1.75} aria-hidden />
          {t('features.mcp.card.approve')}
          <kbd className="kbd" aria-hidden>
            ↵
          </kbd>
        </button>
      </footer>
    </section>
  )
}
