/**
 * A message whose data is marked `<b>…</b>` (the setup lamps' sentences, setup/lamps.ts): drawn with that data bold —
 * never as HTML (names in it are data: a `<` stays a `<`). `plainText` is the same sentence without the marks (a title,
 * the live region).
 */
import { Fragment } from 'react'

const MARK = /(<b>[\s\S]*?<\/b>)/g

export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(MARK).map((p, i) =>
        p.startsWith('<b>') && p.endsWith('</b>') ? <b key={i}>{p.slice(3, -4)}</b> : p ? <Fragment key={i}>{p}</Fragment> : null,
      )}
    </>
  )
}

export const plainText = (text: string): string => text.replace(/<\/?b>/g, '')
