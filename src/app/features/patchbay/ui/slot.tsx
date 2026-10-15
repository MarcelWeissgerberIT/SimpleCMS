/**
 * A translated sentence with one part drawn on its own (a bold "F1" in "Fuse F1 · open path", a bold name in "can set
 * “Weiterleiten”"): the string is asked with SLOT where that part goes, so each language keeps its own word order.
 */
import type { ReactNode } from 'react'

/** Put this in the vars where the drawn part goes. */
export const SLOT = '\u0000'

export function Slotted({ text, children }: { text: string; children: ReactNode }) {
  const at = text.indexOf(SLOT)
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      {children}
      {text.slice(at + SLOT.length).split(SLOT).join('')}
    </>
  )
}
