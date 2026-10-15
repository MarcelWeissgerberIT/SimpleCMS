/**
 * A jack (plan §3.3, §3.9): the socket the cables plug into — `data-j` is the cable layer's anchor (Wires.tsx measures
 * it) — with its mono label where the mock has one (a server's READ 3 / WRITE? 4 / OUT 2 · BY HAND, a source's START /
 * PRESS, EVERYTHING · 9 DB). Its title (and its name when it has the keyboard) names the module, the jack and what it is
 * connected to.
 *
 * The keyboard reaches a jack through the jack picker (J, JackPicker.tsx) — it is never a tab stop of its own
 * (`tabIndex -1`, `data-jack`). On a jack: its cables light in ink; ↵ opens its module, Space selects the module, Esc
 * gives the keyboard back to the module, the arrows go on from the module (Rack.tsx).
 *
 * B16 — patching (the switch on): J on the jack opens "Connect to …", Delete / Backspace unplugs it (the page's keys,
 * Patchbay.tsx), a click / tap opens the picker and a press that moves pulls a cable (PatchDrag.tsx). During a drag the
 * jack says what it is to the cable: the source, a jack it may plug into (`data-pdrag="accept"`, lit in ink), or not
 * (dimmed); `data-pover` while the pointer is on it. Its hit area grows to 24 × 24 px × the text size (patchbay.css).
 */
import type { KeyboardEvent } from 'react'
import type { Jack as JackT } from '../types'
import { setCursor, setJack } from './store'
import { useDragOver, useJackDrag } from './patchUI'

export interface JackKeys {
  /** ↵ */
  open: () => void
  /** Space */
  select: () => void
  /** Esc: back to the module */
  back: () => void
}

export function Jack({ jack, label, title, roleLabel, guessedTitle, lit, keys, patching }: { jack: JackT; label: string; title: string; roleLabel: string; guessedTitle?: string; lit?: boolean; keys: JackKeys; patching?: { keysId: string } | null }) {
  const drag = useJackDrag(jack.key)
  const over = useDragOver(jack.key)
  const text = label ? (
    <span className="pb-jk__l" title={jack.guessed ? guessedTitle : undefined}>
      {label}
    </span>
  ) : null
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      keys.open()
    } else if (e.key === ' ') {
      e.preventDefault()
      keys.select()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      keys.back()
    }
  }
  return (
    <span
      className="pb-jk"
      data-side={jack.side}
      data-role={jack.role}
      data-jack={jack.key}
      title={title}
      role="group"
      aria-roledescription={roleLabel}
      aria-label={title}
      aria-keyshortcuts={patching ? 'Enter Space J Delete' : undefined}
      aria-describedby={patching ? patching.keysId : undefined}
      data-pdrag={drag ?? undefined}
      data-pover={over || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return
        setJack(jack.key)
        // the rack's tab stop follows to the jack's module (it sits before the jack): Tab from here leaves the rack
        const stop = e.currentTarget.closest<HTMLElement>('[data-stop]')?.dataset.stop
        if (stop) setCursor(stop)
      }}
      onBlur={(e) => e.target === e.currentTarget && setJack(null)}
    >
      {jack.side === 'out' && text}
      <span className="pb-jack" data-j={jack.key} data-plugged={jack.plugged || undefined} data-lit={lit || undefined} aria-hidden="true" />
      {jack.side === 'in' && text}
    </span>
  )
}
