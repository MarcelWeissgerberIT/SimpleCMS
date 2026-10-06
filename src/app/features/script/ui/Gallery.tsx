/**
 * The template gallery ("Vorlagen"): categories on the left, the templates as instrument cards (code,
 * name, purpose, what it touches, which database it will use — or what it needs), the selected one's
 * code for THIS workspace on the right, and Use. Opened from #/scripts ("From template", the empty
 * state) and ⌘K "New script from template…". At phone width the categories scroll sideways and every
 * card has its own Use key.
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '../../../ui/Modal'
import { useLang, useT } from '../../../i18n'
import { createScript } from '../actions'
import { CodePreview } from '../editor/CodeEditor'
import { TEMPLATES, TEMPLATE_CATS, buildTemplate, type Built, type TemplateCat, type TemplateDef } from '../templates/catalog'
import { closeTemplateGallery, useTemplateGallery } from '../templates/open'
import { pad2 } from './format'
import './gallery.css'

interface Entry {
  def: TemplateDef
  n: number
  built: Built
  name: string
  desc: string
}

/** Create a script from a template (adapted to this workspace) and open it. */
export function createFromTemplate(id: string, lang: 'en' | 'de', name: string): string | null {
  const def = TEMPLATES.find((x) => x.id === id)
  const built = buildTemplate(id, lang)
  if (!def || !built) return null
  return createScript(def.kind, { name, code: built.code })
}

function Fit({ e }: { e: Entry }) {
  const t = useT()
  if (!e.built.ready)
    return (
      <span className="sc-tpl__fit is-missing">
        <span className="led sc-led--err" aria-hidden />
        <span>{t('features.script.tpl.needsLabel', { what: t(`features.script.tpl.${e.def.id}.needs`) })}</span>
      </span>
    )
  return (
    <span className="sc-tpl__fit">
      <span className={`led ${e.built.note ? 'sc-led--warn' : 'led--ok'}`} aria-hidden />
      <span>{t('features.script.tpl.uses', { names: e.built.uses.join(' · ') })}</span>
    </span>
  )
}

export function TemplateGallery() {
  const t = useT()
  const lang = useLang()
  const open = useTemplateGallery((s) => s.open)
  const cat = useTemplateGallery((s) => s.cat)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const all = useMemo<Entry[]>(
    () => (open ? TEMPLATES.map((def, i) => ({ def, n: i + 1, built: buildTemplate(def.id, lang)!, name: t(`features.script.tpl.${def.id}.name`), desc: t(`features.script.tpl.${def.id}.desc`) })) : []),
    // built once per opening (the workspace as it is now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, lang],
  )
  const needle = q.trim().toLowerCase()
  const shown = all.filter((e) => (cat === 'all' || e.def.cat === cat) && (!needle || `${e.name} ${e.desc}`.toLowerCase().includes(needle)))
  const active = shown.find((e) => e.def.id === sel) ?? shown[0] ?? null

  const use = (e: Entry) => {
    closeTemplateGallery()
    setQ('')
    createFromTemplate(e.def.id, lang, e.name)
  }
  const setCat = (c: TemplateCat | 'all') => useTemplateGallery.setState({ cat: c })
  const touches = (e: Entry) => e.def.touches.map((x) => t(`features.script.tpl.touch.${x}`)).join(' · ')

  return (
    <Modal open={open} onClose={closeTemplateGallery} bare width={1180} className="sc-gal-modal" ariaLabel={t('features.script.tpl.title')}>
      <div className="sc-gal" data-testid="sc-gallery">
        <header className="sc-gal__head">
          <div className="sc-gal__meta label">
            <span className="sc-head__sec">§ SC-T</span>
            <span>{t('features.script.tpl.kicker')}</span>
            <span className="sc-head__rule" aria-hidden />
            <span className="mono">{t('features.script.tpl.count', { n: pad2(all.length) })}</span>
            <button type="button" className="icon-btn sc-gal__close" onClick={closeTemplateGallery} aria-label={t('common.close')}>
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>
          <div className="sc-gal__row">
            <h2 className="sc-gal__title" data-modal-title>
              {t('features.script.tpl.title')}
            </h2>
            <input className="input sc-gal__search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('features.script.tpl.search')} aria-label={t('features.script.tpl.search')} />
          </div>
          <p className="sc-gal__lead">{t('features.script.tpl.lead')}</p>
        </header>
        <div className="sc-gal__body">
          <nav className="sc-gal__cats" aria-label={t('features.script.tpl.cats')}>
            {(['all', ...TEMPLATE_CATS] as const).map((c) => {
              const n = c === 'all' ? all.length : all.filter((e) => e.def.cat === c).length
              return (
                <button key={c} type="button" className={`sc-gal__cat${cat === c ? ' is-on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)} data-cat={c}>
                  <span>{c === 'all' ? t('features.script.tpl.all') : t(`features.script.tpl.cat.${c}`)}</span>
                  <span className="sc-gal__n mono">{pad2(n)}</span>
                </button>
              )
            })}
          </nav>
          <ul className="sc-gal__cards" aria-label={t('features.script.tpl.kicker')}>
            {shown.map((e) => (
              <li key={e.def.id} className={`sc-tpl${active?.def.id === e.def.id ? ' is-on' : ''}${e.built.ready ? '' : ' is-missing'}`} data-template={e.def.id}>
                <button type="button" className="sc-tpl__main" aria-pressed={active?.def.id === e.def.id} onClick={() => setSel(e.def.id)} onDoubleClick={() => use(e)} data-autofocus={active?.def.id === e.def.id ? '' : undefined}>
                  <span className="sc-tpl__top label">
                    <span>TP-{pad2(e.n)}</span>
                    <span>{t(`features.script.tpl.cat.${e.def.cat}`)}</span>
                    <span className={`sc-chip-kind sc-chip-kind--${e.def.kind}`}>{t(`features.script.kind.${e.def.kind}`)}</span>
                  </span>
                  <span className="sc-tpl__name">{e.name}</span>
                  <span className="sc-tpl__desc">{e.desc}</span>
                  <span className="sc-tpl__touch label">{touches(e)}</span>
                  <Fit e={e} />
                </button>
                <button type="button" className="btn btn--sm sc-tpl__use" onClick={() => use(e)} aria-label={t('features.script.tpl.useNamed', { name: e.name })} data-testid="sc-tpl-use">
                  {t('features.script.tpl.use')}
                </button>
              </li>
            ))}
            {!shown.length && <li className="sc-gal__none">{t('features.script.tpl.none')}</li>}
          </ul>
          {active && (
            <aside className="sc-gal__preview" aria-label={t('features.script.tpl.preview')} data-testid="sc-gallery-preview">
              <div className="sc-gal__ptop label">
                <span>TP-{pad2(active.n)}</span>
                <span className="sc-head__rule" aria-hidden />
                <span>{t('features.script.tpl.preview')}</span>
              </div>
              <h3 className="sc-gal__pname">{active.name}</h3>
              <Fit e={active} />
              {active.built.note && <p className="sc-gal__note">{t(active.built.note)}</p>}
              <CodePreview code={active.built.code} className="sc-gal__code" />
              <button type="button" className="btn btn--primary sc-gal__use" onClick={() => use(active)} data-testid="sc-gallery-use">
                {t('features.script.tpl.useThis')}
              </button>
            </aside>
          )}
        </div>
      </div>
    </Modal>
  )
}
