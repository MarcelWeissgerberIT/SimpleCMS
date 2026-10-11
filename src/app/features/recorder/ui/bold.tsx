/** A sentence with one bold part: the string holds '\u0001' where `bold` goes ("<b>2 Zeilen</b> seitdem geändert …"). */
export const BOLD = '\u0001'

export function Bold({ text, bold }: { text: string; bold: string }) {
  const i = text.indexOf(BOLD)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <b>{bold}</b>
      {text.slice(i + 1)}
    </>
  )
}
