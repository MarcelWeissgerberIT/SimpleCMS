/** A sentence with bold parts: the string holds '\u0001' where each of `bold` goes, in order ("<b>2 Zeilen</b> seitdem …"). */
import { Fragment } from 'react'

export const BOLD = '\u0001'

export function Bold({ text, bold }: { text: string; bold: string | readonly string[] }) {
  const parts = text.split(BOLD)
  if (parts.length < 2) return <>{text}</>
  const list = typeof bold === 'string' ? [bold] : bold
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <b>{list[i] ?? ''}</b>}
        </Fragment>
      ))}
    </>
  )
}
