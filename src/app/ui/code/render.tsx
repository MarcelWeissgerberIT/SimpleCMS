/**
 * The highlighted lines (aria-hidden): what the code area draws under its transparent textarea, and what a
 * read-only preview shows. One row per line — the line number (when shown) and the text with its tokens,
 * placeholders, problem squiggles, the bracket pair at the caret, unmatched brackets and the end-of-line
 * message. A row renders again only when its own text or decorations change (2,000 lines stay quick).
 */
import { memo, type ReactNode } from 'react'
import type { CodeToken, MarkerSeverity, SynClass } from './types'
import type { LineSeg } from './lines'

/** A decoration on a line: offsets relative to the line. */
export interface LineDeco {
  start: number
  end: number
  kind: 'error' | 'warning' | 'info' | 'match' | 'bad'
}

export type RenderToken = (token: CodeToken, text: string) => ReactNode | null

export interface RowProps {
  n: number
  text: string
  segs: LineSeg[]
  decos: LineDeco[]
  /** the worst problem on this line (gutter mark) */
  mark: MarkerSeverity | null
  lens: string | null
  cur: boolean
  ln: boolean
  renderToken?: RenderToken
}

/** What a drawn row was made from (the code area keeps the element of a line that did not change). */
export interface RowEntry {
  text: string
  segs: LineSeg[]
  decos: LineDeco[]
  mark: MarkerSeverity | null
  lens: string | null
  cur: boolean
  ln: boolean
  rt: RenderToken | undefined
  el: ReactNode
}

export const NONE: LineSeg[] = []
export const NONE_DECO: LineDeco[] = []

export function sameSegs(a: LineSeg[], b: LineSeg[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].start !== b[i].start || a[i].end !== b[i].end || a[i].cls !== b[i].cls) return false
  return true
}

export function sameDecos(a: LineDeco[], b: LineDeco[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].start !== b[i].start || a[i].end !== b[i].end || a[i].kind !== b[i].kind) return false
  return true
}

const decoClass = (k: LineDeco['kind']) => (k === 'match' ? 'ca-match' : k === 'bad' ? 'ca-bad' : `ca-sq ca-sq--${k}`)

function Text({ text, segs, decos, renderToken }: Pick<RowProps, 'text' | 'segs' | 'decos' | 'renderToken'>): ReactNode {
  if (!segs.length && !decos.length) return text
  // every place where a token or a decoration starts or ends
  const cuts = new Set<number>([0, text.length])
  for (const s of segs) cuts.add(s.start).add(s.end)
  for (const d of decos) cuts.add(Math.max(0, Math.min(text.length, d.start))).add(Math.max(0, Math.min(text.length, d.end)))
  const at = [...cuts].sort((a, b) => a - b)
  const out: ReactNode[] = []
  let si = 0
  for (let i = 0; i < at.length - 1; i++) {
    const a = at[i]
    const b = at[i + 1]
    if (b <= a) continue
    while (si < segs.length && segs[si].end <= a) si++
    const seg = segs[si] && segs[si].start <= a ? segs[si] : null
    // a token the caller draws itself (One Script's @ chips): one piece, decorations around it
    if (seg && renderToken && seg.start === a) {
      const drawn = renderToken({ start: seg.start, end: seg.end, cls: seg.cls }, text.slice(seg.start, seg.end))
      if (drawn !== null && drawn !== undefined) {
        const sq = decos.find((d) => d.start < seg.end && d.end > seg.start && d.kind !== 'match')
        out.push(
          <span key={a} className={sq ? decoClass(sq.kind) : undefined}>
            {drawn}
          </span>,
        )
        while (i < at.length - 1 && at[i + 1] < seg.end) i++
        continue
      }
    }
    const cls: string[] = []
    if (seg) cls.push(`syn-${seg.cls as SynClass}`)
    for (const d of decos) if (d.start <= a && d.end >= b) cls.push(decoClass(d.kind))
    const piece = text.slice(a, b)
    out.push(
      cls.length ? (
        <span key={a} className={cls.join(' ')}>
          {piece}
        </span>
      ) : (
        piece
      ),
    )
  }
  return out
}

/** A row that draws outside its own box: the message after the line, a squiggle below the text. */
const drawsOver = (lens: string | null, decos: LineDeco[]) => !!lens || decos.some((d) => d.kind !== 'match' && d.kind !== 'bad')

export const Row = memo(
  function Row({ n, text, segs, decos, mark, lens, cur, ln, renderToken }: RowProps) {
    return (
      <div className="ca__row" data-line={n} data-cur={cur || undefined} data-mark={mark ?? undefined} data-over={drawsOver(lens, decos) || undefined}>
        {ln && <span className="ca__ln" data-n={n} />}
        <span className="ca__text">
          <Text text={text} segs={segs} decos={decos} renderToken={renderToken} />
          {lens && (
            <span className="ca__lens-at">
              <span className={`ca__lens ca__lens--${mark ?? 'error'}`}>{lens}</span>
            </span>
          )}
        </span>
      </div>
    )
  },
  (a, b) => a.n === b.n && a.text === b.text && a.mark === b.mark && a.lens === b.lens && a.cur === b.cur && a.ln === b.ln && a.renderToken === b.renderToken && sameSegs(a.segs, b.segs) && sameDecos(a.decos, b.decos),
)
