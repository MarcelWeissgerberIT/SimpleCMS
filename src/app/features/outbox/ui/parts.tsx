/** Small shared pieces of the Outbox's screens: server tag, `tool → #key`, the origin chip, the FREMD mark, times. */
import { Bot, Command, MessageSquare, Mic, PenLine, Plug, Puzzle, Repeat, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { useT } from '../../../i18n'
import type { OriginKind, Slip } from '../types'

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
    <span className="obx-srv" title={name}>
      {name.toUpperCase()}
    </span>
  )
}

export function ToolTarget({ slip, keyOnly }: { slip: Slip; keyOnly?: boolean }) {
  return (
    <span className="obx-tt">
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
