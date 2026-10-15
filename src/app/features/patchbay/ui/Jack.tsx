/**
 * A jack (plan §3.3): the socket the cables plug into — `data-j` is the cable layer's anchor (Wires.tsx measures it) —
 * with its mono label where the mock has one (a server's READ 3 / WRITE? 4 / OUT 2 · BY HAND, a source's START / PRESS,
 * EVERYTHING · 9 DB). Its title names the module, the jack and what it is connected to. B7's jack picker (J) and B16's
 * patching make the socket focusable and a drop target.
 */
import type { Jack as JackT } from '../types'

export function Jack({ jack, label, title, guessedTitle, lit }: { jack: JackT; label: string; title: string; guessedTitle?: string; lit?: boolean }) {
  const text = label ? (
    <span className="pb-jk__l" title={jack.guessed ? guessedTitle : undefined}>
      {label}
    </span>
  ) : null
  return (
    <span className="pb-jk" data-side={jack.side} data-role={jack.role} title={title}>
      {jack.side === 'out' && text}
      <span className="pb-jack" data-j={jack.key} data-plugged={jack.plugged || undefined} data-lit={lit || undefined} aria-hidden="true" />
      {jack.side === 'in' && text}
    </span>
  )
}
