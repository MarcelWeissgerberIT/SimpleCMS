/** Read-only highlighted code (template previews, review cards): the code area's lines without the textarea. */
import { useMemo } from 'react'
import type { Tokenizer } from './types'
import { lineStarts, tokensByLine } from './lines'
import { NONE, NONE_DECO, Row, type RenderToken } from './render'
import './syntax.css'
import './code.css'

export function CodeView({ code, tokenize, renderToken, lineNumbers = false, wrap = false, className, testId, firstLine = 1, highlightLines }: { code: string; tokenize?: Tokenizer; renderToken?: RenderToken; lineNumbers?: boolean; wrap?: boolean; className?: string; testId?: string; firstLine?: number; highlightLines?: [number,number] }) {
  const segs = useMemo(() => tokensByLine(code, lineStarts(code), tokenize ? tokenize(code) : []), [code, tokenize])
  const lines = code.split('\n')
  return (
    <div className={`ca-view${className ? ` ${className}` : ''}`} data-wrap={wrap ? 'on' : 'off'} data-ln={lineNumbers ? 'on' : 'off'} data-testid={testId} style={{ ['--ca-digits' as string]: Math.max(2, String(firstLine + lines.length - 1).length) }}>
      {lines.map((text, i) => (
        <Row key={i} n={firstLine + i} text={text} segs={segs[i] ?? NONE} decos={NONE_DECO} mark={null} lens={null} cur={!!highlightLines && firstLine+i>=highlightLines[0] && firstLine+i<=highlightLines[1]} ln={lineNumbers} renderToken={renderToken} />
      ))}
    </div>
  )
}
