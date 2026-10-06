/**
 * The preview of "Turn into free board" inside the Transform panel: the record types (new / reused, their
 * fields) and the lanes with their cards as they will be. Nothing is written before Transform.
 */
import { useT } from '../../../i18n'
import type { FreeBoardResult } from './apply'
import './freeboard.css'

export function FreeBoardPreview({ res }: { res: FreeBoardResult }) {
  const t = useT()
  const { board } = res
  const stays = res.keep.length + res.left.length
  return (
    <div className="fbp" data-testid="freeboard-preview">
      <div className="trf__spec label" data-testid="transform-spec">
        {t('features.ai.freeboard.spec', { lanes: board.lanes.length, cards: board.cards.length, types: board.types.length })}
        {stays > 0 && ` · ${t('features.ai.transform.spec.stays', { n: stays })}`}
      </div>
      {board.types.length > 0 && (
        <ul className="fbp__types">
          {board.types.map((ty, i) => (
            <li key={i} className="fbp__type" style={{ ['--rt' as string]: `var(--c-${ty.color}-text)` }} data-testid="freeboard-type">
              <span className="fbp__led" aria-hidden />
              <span className="fbp__name">{ty.name}</span>
              <span className="label fbp__tag">{ty.existing ? t('features.ai.freeboard.reused') : t('features.ai.freeboard.new')}</span>
              <span className="fbp__fields">{ty.fields.map((f) => f.name).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="fbp__lanes">
        {board.lanes.map((lane, li) => {
          const cards = board.cards.filter((c) => c.lane === li)
          return (
            <section key={li} className="fbp__lane" aria-label={lane}>
              <header className="fbp__lanehead">
                <span>{lane}</span>
                <span className="label">{cards.length}</span>
              </header>
              {cards.map((c, ci) => {
                const ty = c.type !== null ? board.types[c.type] : null
                const vals = Object.entries(c.values).slice(0, 2)
                return (
                  <article key={ci} className="fbp__card" data-typed={ty ? true : undefined} style={ty ? { ['--rt' as string]: `var(--c-${ty.color}-text)` } : undefined} data-testid="freeboard-card">
                    {ty && <span className="label fbp__cardtype">{ty.name}</span>}
                    <span className="fbp__title">{c.title}</span>
                    {vals.map(([k, v]) => (
                      <span key={k} className="fbp__val">
                        <span className="label">{k}</span> {v}
                      </span>
                    ))}
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>
      {res.left.length > 0 && (
        <ul className="trf__left-list" data-testid="transform-left">
          {res.left.map((l, i) => (
            <li key={i}>
              <span className="trf__mark" aria-hidden>
                ↳
              </span>
              <span className="trf__left-text">{l}</span>
              <span className="trf__left-why label">{t('features.ai.transform.left.below')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
