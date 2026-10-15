/**
 * "§ In plain words" / "§ Im Klartext" (plan §3.6, §6 U6): a visible section under the rack with a real heading, read
 * in order — every counted strand (plain.ts plainOf: one per drawn processor, then the sources acting on their own), in
 * rack order, flowing as one text like the mock's. Names are bold. The selected module's strand is marked where it is
 * (`data-on`, ink — never orange), never scrolled to: Space on the rack shows the connections and the sentence in
 * place (§6 U21). B8 places the fuse plate above it.
 */
import { Fragment, useMemo } from 'react'
import { plainOf } from '../plain'
import type { Model, ModelInput } from '../types'
import { usePbUI } from './store'
import type { Words } from './words'

const P = 'features.patchbay'

export function Plain({ model, input, words: w }: { model: Model; input: ModelInput; words: Words }) {
  const strands = useMemo(() => plainOf(model, input, w.ctx), [model, input, w])
  const selected = usePbUI((s) => s.selected)
  if (!strands.length) return null
  return (
    <section className="pb-plain" aria-labelledby="pb-plain-h" data-testid="pb-plain">
      <h2 id="pb-plain-h" className="label pb-plain__h">
        {w.t(`${P}.plain.head`)}
      </h2>
      <p className="pb-plain__p">
        {strands.map((s, i) => (
          <Fragment key={s.module}>
            {i > 0 && ' '}
            <span className="pb-plain__s" data-strand={s.module} data-on={selected === s.module || undefined}>
              {s.parts.map((p, j) => (p.b ? <b key={j}>{p.t}</b> : <span key={j}>{p.t}</span>))}
            </span>
          </Fragment>
        ))}
      </p>
    </section>
  )
}
