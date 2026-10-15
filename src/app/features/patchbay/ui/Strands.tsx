/**
 * The strands view (plan §3.8, §6 U13 / U14) — what the rack becomes on a phone, and wherever the bench is narrower
 * than 880 px × the text size or a module's name would fall under ~12ch (an open Outbox dock or AI terminal, XL text
 * at 1024 / 1280): one card per processor, its lines "from …" / "to …" (the arrows are decoration, the words carry the
 * direction), in an order fixed when the page opens (layout.ts strandOrder — nothing reorders under the finger), then
 * "§ 03 Not processed · n" naming every other module. A tap on a card opens its editor.
 *
 * B6 ships the cards and the order (the rack's narrow fallback); B8 adds the fuse cards on top, the running jump chip,
 * the per-line taps and the topbar ⋯.
 */
import { useMemo, useRef } from 'react'
import { strandOrder } from '../layout'
import type { Model, Module, ModuleKey } from '../types'
import { edgesAt, moduleOfJack } from './lit'
import { canOpen, openModule } from './open'
import type { FuseMarks, Words } from './words'

const P = 'features.patchbay'

function lineNames(model: Model, w: Words, m: Module, side: 'in' | 'out'): string[] {
  const names: string[] = []
  for (const j of side === 'in' ? m.inJacks : m.outJacks) {
    for (const e of edgesAt(model, j.key)) {
      const other = side === 'in' ? e.from : e.to
      let name: string
      if (other.startsWith('net:')) {
        const net = model.nets.find((n) => n.key === other)
        name = net ? w.flag(net) : other
      } else {
        const k = moduleOfJack(model, other)
        const om = k ? model.modules.find((x) => x.key === k) : null
        name = om ? w.name(om) : other
      }
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

export function Strands({ model, words: w, marks, runs }: { model: Model; words: Words; marks: FuseMarks; runs: Record<ModuleKey, number> }) {
  const t = w.t
  // the order is fixed for this visit (a run starting never reorders the list)
  const first = useRef<ReturnType<typeof strandOrder> | null>(null)
  const order = useMemo(() => {
    const fresh = strandOrder(model, { name: (k) => { const m = model.modules.find((x) => x.key === k); return m ? w.name(m) : k }, lang: w.lang, fuses: marks.open })
    const prev = first.current
    if (!prev) return (first.current = fresh)
    const keep = (old: ModuleKey[], now: ModuleKey[]) => [...old.filter((k) => now.includes(k)), ...now.filter((k) => !old.includes(k))]
    return { fuses: fresh.fuses, strands: keep(prev.strands, fresh.strands), rest: keep(prev.rest, fresh.rest) }
  }, [model, w, marks])
  const byKey = new Map(model.modules.map((m) => [m.key, m]))
  const strands = order.strands.map((k) => byKey.get(k)).filter((m): m is Module => !!m)
  const rest = order.rest.map((k) => byKey.get(k)).filter((m): m is Module => !!m)

  return (
    <div className="pb-strands" role="region" aria-label={t(`${P}.strands.aria`)} data-testid="pb-strands">
      <div className="pb-sh">
        <span className="label pb-colh__n">§ 02</span>
        <span className="label">
          {t(`${P}.strands.head`)} · {strands.length}
        </span>
        <span className="pb-colh__rule" aria-hidden="true" />
      </div>
      <ul className="pb-strands__list">
        {strands.map((m) => {
          const fuses = marks.modules.get(m.key) ?? []
          const from = lineNames(model, w, m, 'in')
          const to = lineNames(model, w, m, 'out')
          const n = runs[m.key] ?? 0
          return (
            <li key={m.key}>
              <button type="button" className="pb-strand" data-path={fuses.length ? '' : undefined} data-key={m.key} data-testid="pb-strand" onClick={(e) => canOpen(m) && openModule(m, e.currentTarget)}>
                <span className="pb-strand__h">
                  <span className={m.tags.includes('disabled') ? 'led' : 'led pb-led--ok'} aria-hidden="true" />
                  <span className="label">{w.kind(m)}</span>
                  {w.tags(m).slice(0, 2).map((x) => (
                    <span key={x.tag} className="pb-tag">
                      {x.text}
                    </span>
                  ))}
                  {fuses.map((f) => (
                    <span key={f} className="pb-tag pb-tag--f">
                      {f}
                    </span>
                  ))}
                  <span className="pb-strand__sp" />
                  {n > 0 && <span className="pb-win">{t(`${P}.win.runs`, { n })}</span>}
                </span>
                <span className="pb-strand__n">{w.name(m)}</span>
                <span className="pb-lines">
                  <span className="pb-line">
                    <span className="pb-line__ar" aria-hidden="true">
                      ←
                    </span>
                    <span className="pb-line__t">
                      {t(`${P}.strands.from`)} <b>{from.length ? from.join(' · ') : t(`${P}.strands.none`)}</b>
                    </span>
                  </span>
                  <span className="pb-line">
                    <span className="pb-line__ar" aria-hidden="true">
                      →
                    </span>
                    <span className="pb-line__t">
                      {t(`${P}.strands.to`)} <b>{to.length ? to.join(' · ') : t(`${P}.strands.none`)}</b>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rest.length > 0 && (
        <>
          <div className="pb-sh">
            <span className="label pb-colh__n">§ 03</span>
            <span className="label">
              {t(`${P}.strands.rest`)} · {rest.length}
            </span>
            <span className="pb-colh__rule" aria-hidden="true" />
          </div>
          <p className="pb-strands__rest" data-testid="pb-strands-rest">
            {rest.map((m) => w.name(m)).join(' · ')}
          </p>
        </>
      )}
    </div>
  )
}
