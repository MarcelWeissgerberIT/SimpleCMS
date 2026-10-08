/** Read-only highlighted code (template previews, review cards): the code area's lines without the textarea. */
import { useMemo } from 'react'
import type { Tokenizer } from './types'
import { lineStarts, tokensByLine } from './lines'
import { Row, segSig, type RenderToken } from './render'
import './syntax.css'
import './code.css'

export function CodeView({ code, tokenize, renderToken, lineNumbers = false, wrap = false, className, testId }: { code: string; tokenize?: Tokenizer; renderToken?: RenderToken; lineNumbers?: boolean; wrap?: boolean; className?: string; testId?: string }) {
  const segs = useMemo(() => tokensByLine(code, lineStarts(code), tokenize ? tokenize(code) : []), [code, tokenize])
  const lines = code.split('\n')
  return (
    <div className={`ca-view${className ? ` ${className}` : ''}`} data-wrap={wrap ? 'on' : 'off'} data-ln={lineNumbers ? 'on' : 'off'} data-testid={testId} style={{ ['--ca-digits' as string]: Math.max(2, String(lines.length).length) }}>
      {lines.map((text, i) => (
        <Row key={i} n={i + 1} text={text} segs={segs[i] ?? []} decos={[]} mark={null} lens={null} cur={false} ln={lineNumbers} renderToken={renderToken} segSig={segSig(segs[i] ?? [])} decoSig="" />
      ))}
    </div>
  )
}
