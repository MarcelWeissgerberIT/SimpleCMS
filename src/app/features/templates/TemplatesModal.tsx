/**
 * Template gallery: a parts catalogue (T-01 … T-11) with category filter and a schematic preview.
 * "Use template" builds real pages/databases under parentId and opens the result.
 */
import { useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import { toast } from '../../store/ui'
import { flushSave } from '../../store/persistence'
import { resolveAssetUrl } from '../../lib/files'
import { openPage } from '../../lib/router'
import type { ID } from '../../store/types'
import { pauseAutomations } from '../automations/engine'
import { TEMPLATES, outlineStats, translator, type OutlineKind, type TemplateCategory, type TemplateDef } from './catalog'
import './templates.css'

const CATS: Array<'all' | TemplateCategory> = ['all', 'work', 'product', 'personal', 'knowledge']
const GLYPH: Record<OutlineKind, string> = { page: '▤', db: '▦', views: '◫', fields: '≡', rows: '⋯' }

export function TemplatesModal({ parentId, onClose }: { parentId?: ID | null; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const L = useMemo(() => translator(lang), [lang])
  const parent = usePage(parentId ?? null)
  const target = parent && !parent.trashed && !parent.databaseId && parent.kind === 'page' ? parent : undefined
  const [cat, setCat] = useState<'all' | TemplateCategory>('all')
  const list = useMemo(() => TEMPLATES.filter((x) => cat === 'all' || x.category === cat), [cat])
  const [selId, setSelId] = useState(TEMPLATES[0].id)
  const sel = list.find((x) => x.id === selId) ?? list[0]
  const [busy, setBusy] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const use = (tpl: TemplateDef) => {
    if (busy) return
    setBusy(true)
    const resume = pauseAutomations()
    try {
      const id = tpl.build(target?.id ?? null, L)
      void flushSave()
      onClose()
      openPage(id)
      toast({ message: t('features.tpl.created', { name: tpl.title(L) }), kind: 'success' })
    } catch (err) {
      console.error('[templates] build failed', err)
      toast({ message: t('features.tpl.failed'), kind: 'error' })
      setBusy(false)
    } finally {
      resume()
    }
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    const idx = list.findIndex((x) => x.id === sel?.id)
    const cols = Math.max(1, Math.round((gridRef.current?.clientWidth ?? 600) / 200))
    const move = (d: number) => {
      e.preventDefault()
      const next = list[Math.max(0, Math.min(list.length - 1, idx + d))]
      if (next) {
        setSelId(next.id)
        gridRef.current?.querySelector<HTMLElement>(`[data-tpl="${next.id}"]`)?.focus()
      }
    }
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(cols)
    else if (e.key === 'ArrowUp') move(-cols)
    else if (e.key === 'Enter' && sel) {
      e.preventDefault()
      use(sel)
    }
  }

  const outline = sel ? sel.outline(L) : []

  return (
    <Modal open onClose={onClose} label="§ TPL" title={t('features.tpl.title')} width={1080} className="tpl-modal">
      <div className="tpl">
        <div className="tpl-filter" role="tablist" aria-label={t('features.tpl.categories')}>
          {CATS.map((c) => {
            const n = c === 'all' ? TEMPLATES.length : TEMPLATES.filter((x) => x.category === c).length
            return (
              <button key={c} type="button" role="tab" aria-selected={cat === c} className="tpl-filter__tab" onClick={() => setCat(c)}>
                <span>{t(`features.tpl.cat.${c}`)}</span>
                <span className="tpl-filter__n">{String(n).padStart(2, '0')}</span>
              </button>
            )
          })}
        </div>

        <div className="tpl-body">
          <div className="tpl-grid" ref={gridRef} role="listbox" aria-label={t('features.tpl.title')} onKeyDown={onGridKey}>
            {list.map((tpl) => {
              const s = outlineStats(tpl.outline(L))
              return (
                <button
                  key={tpl.id}
                  type="button"
                  role="option"
                  aria-selected={tpl.id === sel?.id}
                  tabIndex={tpl.id === sel?.id ? 0 : -1}
                  data-tpl={tpl.id}
                  className="tpl-card"
                  onClick={() => setSelId(tpl.id)}
                  onDoubleClick={() => use(tpl)}
                  data-autofocus={tpl.id === sel?.id ? '' : undefined}
                >
                  <span className="tpl-card__top">
                    <span className="tpl-card__code mono">{tpl.code}</span>
                    <span className="tpl-card__cat label">{t(`features.tpl.cat.${tpl.category}`)}</span>
                  </span>
                  <span className="tpl-card__art">
                    <img src={resolveAssetUrl(`assets/icons/${tpl.icon}.webp`)} alt="" width={64} height={64} draggable={false} loading="lazy" />
                  </span>
                  <span className="tpl-card__title">{tpl.title(L)}</span>
                  <span className="tpl-card__spec mono">
                    {[
                      s.pages ? t(s.pages === 1 ? 'features.tpl.nPage' : 'features.tpl.nPages', { n: s.pages }) : null,
                      s.dbs ? t(s.dbs === 1 ? 'features.tpl.nDb' : 'features.tpl.nDbs', { n: s.dbs }) : null,
                      s.views ? t('features.tpl.nViews', { n: s.views }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              )
            })}
          </div>

          {sel && (
            <aside className="tpl-preview" aria-live="polite">
              <div className="tpl-preview__art">
                <img src={resolveAssetUrl(`assets/icons/${sel.icon}.webp`)} alt="" width={112} height={112} draggable={false} />
                <span className="tpl-preview__code mono">{sel.code}</span>
              </div>
              <div className="label tpl-preview__cat">{t(`features.tpl.cat.${sel.category}`)}</div>
              <h3 className="display tpl-preview__title">{sel.title(L)}</h3>
              <p className="tpl-preview__desc muted">{sel.description(L)}</p>

              <div className="tpl-section label">
                <b>§</b> {t('features.tpl.structure')}
              </div>
              <ul className="tpl-outline">
                {outline.map((line, k) => (
                  <li key={k} className={`tpl-outline__line tpl-outline__line--${line.kind}`} data-depth={line.depth} style={{ '--d': line.depth } as React.CSSProperties}>
                    <span className="tpl-outline__glyph mono" aria-hidden>
                      {GLYPH[line.kind]}
                    </span>
                    <span className="tpl-outline__kind label">{t(`features.tpl.kind.${line.kind}`)}</span>
                    <span className="tpl-outline__label">{line.label}</span>
                  </li>
                ))}
              </ul>

              <div className="tpl-preview__foot">
                <div className="tpl-target">
                  <span className="label">{t('features.tpl.target')}</span>
                  <span className="tpl-target__name">
                    {target ? (
                      <>
                        <PageIcon icon={target.icon} kind={target.kind} size={14} /> {target.title.trim() || t('common.untitled')}
                      </>
                    ) : (
                      t('features.tpl.root')
                    )}
                  </span>
                </div>
                <button type="button" className="btn btn--primary btn--lg tpl-use" onClick={() => use(sel)} disabled={busy}>
                  {t('features.tpl.use')} <ArrowRight size={16} />
                </button>
                <span className="tpl-preview__creates mono faint">
                  {t('features.tpl.creates')}
                </span>
              </div>
            </aside>
          )}
        </div>
      </div>
    </Modal>
  )
}
