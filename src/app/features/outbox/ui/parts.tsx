/**
 * Small shared pieces of the Outbox's screens: server tag, `tool → #key`, the origin chip, the FREMD mark, times —
 * and `Shown`: any text that came from a slip, a row or a source, with hidden code points drawn as ⟦U+202E⟧ (never
 * rendered raw: a bidi override would reverse what the person reads).
 */
import { useEffect } from 'react'
import { Bot, Command, MessageSquare, Mic, PenLine, Plug, Puzzle, Repeat, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { loadAgentRuns, mirrorSourceOf, useAgentRuns } from '../../agents'
import { hiddenParts, showHidden } from '../seal'
import type { OriginKind, Slip } from '../types'

/** A text as it is: hidden code points as visible ⟦U+…⟧ marks (each with its name on hover). */
export function Shown({ text }: { text: string }) {
  const t = useT()
  return (
    <>
      {hiddenParts(text).map((p, i) =>
        'hidden' in p ? (
          <span key={i} className="obx-hidden" title={t('features.outbox.text.hiddenTitle', { code: p.hidden })}>
            ⟦{p.hidden}⟧
          </span>
        ) : (
          p.text
        ),
      )}
    </>
  )
}

/** For a `title` / `aria-label`: the same text with hidden code points written out. */
export const shownText = (text: string) => showHidden(text)

/** A quote in the UI's own marks (“…” / „…“). */
export function Quote({ text }: { text: string }) {
  const t = useT()
  const [open, close] = t('features.outbox.quote').split('{text}')
  return (
    <>
      {open}
      <Shown text={text} />
      {close}
    </>
  )
}

/**
 * When the database's mirror last finished a run on this device (null: none seen here — another device or the team
 * server ran it). "Per mirror HH:MM" names this, never the time the slip was drafted.
 */
export function useMirrorRanAt(dbId: ID): number | null {
  const agentId = mirrorSourceOf(dbId)?.agentId ?? null
  const runs = useAgentRuns((s) => (agentId ? s.byAgent[agentId] : undefined))
  useEffect(() => {
    if (agentId) void loadAgentRuns(agentId).catch(() => undefined)
  }, [agentId])
  let at: number | null = null
  for (const r of runs ?? []) if ((r.status === 'ok' || r.status === 'staged') && r.endedAt && (at === null || r.endedAt > at)) at = r.endedAt
  return at
}

const ORIGIN_ICONS: Record<OriginKind, LucideIcon> = {
  command: Command,
  manual: PenLine,
  loop: Repeat,
  meeting: Mic,
  terminal: SquareTerminal,
  agent: Bot,
  menu: MessageSquare,
  bridge: Plug,
  api: Puzzle,
}

/** "07:48" (24 h) today, else "09.10. 07:48" / "Oct 9 07:48". */
export function clock(at: number, lang: Lang): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (new Date().toDateString() === d.toDateString()) return time
  const day = lang === 'de' ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day} ${time}`
}

export function ServerTag({ name }: { name: string }) {
  return (
    <span className="obx-srv" title={shownText(name)}>
      <Shown text={name.toUpperCase()} />
    </span>
  )
}

export function ToolTarget({ slip, keyOnly }: { slip: Slip; keyOnly?: boolean }) {
  return (
    <span className="obx-tt" title={`${slip.route.tool} → #${slip.target.key}`}>
      {!keyOnly && <span className="obx-tt__tool">{slip.route.tool}</span>}
      {!keyOnly && (
        <span className="obx-tt__to" aria-hidden>
          →
        </span>
      )}
      <span className="obx-tt__key">#{slip.target.key}</span>
    </span>
  )
}

export function OriginChip({ slip, lang }: { slip: Slip; lang: Lang }) {
  const t = useT()
  const Icon = ORIGIN_ICONS[slip.origin.kind] ?? Puzzle
  return (
    <span className="obx-origin label">
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      {t(`features.outbox.origin.${slip.origin.kind}`)} · {clock(slip.createdAt, lang)}
    </span>
  )
}

/** FREMD is never colour alone: the "!" box and the word, always together. */
export function ForeignMark() {
  return (
    <span className="obx-fmark" aria-hidden>
      !
    </span>
  )
}

/** A closed cover as a tiny glyph (neutral steel; only the cover you act on is orange). */
export function Lid({ title }: { title?: string }) {
  return <span className="obx-lid" title={title} aria-hidden={!title} />
}
