/**
 * The reference pane next to a script: One's library and the built-ins by group, each with its
 * signature and one line; a click inserts the call at the caret.
 */
import { useT } from '../../../i18n'
import { GLOBAL_FUNCTIONS, type FnGroup, type FnInfo } from '../catalog'
import { fnDesc } from './format'

const ORDER: FnGroup[] = ['one', 'ui', 'effect', 'text', 'number', 'date', 'list', 'other']

/** What a click inserts: `name(` for functions, `mail.send(` for the effect namespaces. */
export function insertionOf(f: FnInfo): string {
  if (!f.prop) return `${f.name}(`
  const m = /^([\w.]+)\(/.exec(f.sig)
  return m ? `${m[1]}(` : f.name
}

export function Reference({ onInsert }: { onInsert: (text: string) => void }) {
  const t = useT()
  return (
    <section className="sc-ref" aria-label={t('features.script.tab.reference')}>
      <h2 className="sc-pane__head label">{t('features.script.tab.reference')}</h2>
      <p className="sc-ref__lead">{t('features.script.ref.lead')}</p>
      {ORDER.map((g) => {
        const list = GLOBAL_FUNCTIONS.filter((f) => f.group === g)
        if (!list.length) return null
        return (
          <div key={g} className="sc-ref__group">
            <h3 className="sc-ref__head label">{t(`features.script.ref.group.${g}`)}</h3>
            <ul className="sc-ref__list">
              {list.map((f) => (
                <li key={f.name}>
                  <button type="button" className="sc-ref__item" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(insertionOf(f))} aria-label={t('features.script.ref.insert', { name: f.name })}>
                    <code className="sc-ref__sig">{f.sig}</code>
                    <span className="sc-ref__desc">{fnDesc(t, f.name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
