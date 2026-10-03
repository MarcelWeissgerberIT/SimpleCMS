/**
 * The plate on top of every page of a template ("TEMPLATE · <name>"): you are editing a template,
 * not a page of the workspace. "Use template" makes a fresh copy at the top level, "Done" goes back
 * to where editing started. Details: the gallery name, description, category and icon.
 * Renders nothing on pages outside templates.
 */
import { useId, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Lock } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { templateRootOf, usePage } from '../../store/selectors'
import { useCloud } from '../../cloud'
import { openPage } from '../../lib/router'
import { useT } from '../../i18n'
import { Popover } from '../../ui/Popover'
import { IconPicker } from '../../ui/IconPicker'
import { PageIcon } from '../../ui/PageIcon'
import type { ID, Page } from '../../store/types'
import { announceCopy, applyTemplate, consumeDetailsRequest, leaveTemplate, templateName, updateTemplateMeta } from './own'
import { CategoryChips } from './parts'
import { TEMPLATE_VARIABLES } from './vars'
import './templates.css'

export function TemplateBanner({ pageId }: { pageId: ID }) {
  const rootId = useWorkspace((s) => templateRootOf(s.pages, pageId))
  const root = usePage(rootId)
  if (!root?.template) return null
  return <Banner root={root} pageId={pageId} />
}

function Banner({ root, pageId }: { root: Page; pageId: ID }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const page = usePage(pageId)
  const [open, setOpen] = useState(() => consumeDetailsRequest(root.id))
  const [iconAnchor, setIconAnchor] = useState<Element | null>(null)
  const detailsId = useId()
  const meta = root.template!
  const sub = pageId !== root.id ? page?.title.trim() || t('common.untitled') : null

  const use = () => {
    const from = window.location.hash
    const id = applyTemplate(root.id, null)
    if (!id) return
    openPage(id)
    announceCopy(id, templateName(root), from)
  }

  return (
    <section className="tplb" aria-label={t('features.tpl.banner.region')} data-open={open || undefined}>
      <div className="tplb__bar">
        <span className="tplb__tag mono" aria-hidden>
          TPL
        </span>
        <span className="tplb__text">
          <span className="tplb__kind">{t('features.tpl.banner.label')}</span>
          <span className="tplb__sep" aria-hidden>
            ·
          </span>
          <span className="tplb__name">{templateName(root)}</span>
          {sub && <span className="tplb__sub">/ {sub}</span>}
          {root.private && <Lock size={11} className="tplb__lock" aria-label={t('features.tpl.private')} />}
        </span>
        <button type="button" className="btn btn--sm btn--ghost tplb__toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
          {t('features.tpl.banner.details')} <ChevronDown size={13} className="tplb__chev" />
        </button>
        {!readOnly && (
          <button type="button" className="btn btn--sm btn--primary tplb__use" onClick={use}>
            <span className="tplb__long">{t('features.tpl.use')}</span>
            <span className="tplb__short">{t('features.tpl.useShort')}</span> <ArrowRight size={13} />
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ink tplb__done" onClick={leaveTemplate}>
          <Check size={13} /> {t('features.tpl.banner.done')}
        </button>
      </div>
      {open && (
        <div className="tplb__details" id={detailsId}>
          <label className="tplb__field">
            <span className="label">{t('features.tpl.save.name')}</span>
            <input
              className="input"
              value={meta.name}
              placeholder={t('features.tpl.untitled')}
              readOnly={readOnly}
              maxLength={120}
              onChange={(e) => updateTemplateMeta(root.id, { name: e.target.value })}
            />
          </label>
          <div className="tplb__field tplb__field--icon">
            <span className="label">{t('features.tpl.banner.icon')}</span>
            <button type="button" className="tplb__icon" disabled={readOnly} aria-label={t('features.tpl.banner.icon')} onClick={(e) => setIconAnchor(iconAnchor ? null : e.currentTarget)}>
              <PageIcon icon={meta.icon ?? root.icon} kind={root.kind} size={22} />
            </button>
          </div>
          <label className="tplb__field tplb__field--wide">
            <span className="label">{t('features.tpl.save.description')}</span>
            <input
              className="input"
              value={meta.description ?? ''}
              placeholder={t('features.tpl.save.descriptionPh')}
              readOnly={readOnly}
              maxLength={400}
              onChange={(e) => updateTemplateMeta(root.id, { description: e.target.value })}
            />
          </label>
          <div className="tplb__field tplb__field--wide">
            <span className="label">{t('features.tpl.save.category')}</span>
            <CategoryChips value={meta.category ?? null} onChange={(category) => updateTemplateMeta(root.id, { category })} disabled={readOnly} label={t('features.tpl.save.category')} />
          </div>
          <p className="tplb__vars">
            <span className="label">{t('features.tpl.banner.variables')}</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <code key={v} className="tplb__var">
                {v}
              </code>
            ))}
            <span className="faint">{t('features.tpl.banner.varsHint')}</span>
          </p>
          <Popover open={!!iconAnchor} anchor={iconAnchor} onClose={() => setIconAnchor(null)} bare placement="bottom-start">
            <IconPicker
              symbols
              onSelect={(icon) => {
                updateTemplateMeta(root.id, { icon })
                setIconAnchor(null)
              }}
              onRemove={
                meta.icon
                  ? () => {
                      updateTemplateMeta(root.id, { icon: null })
                      setIconAnchor(null)
                    }
                  : undefined
              }
            />
          </Popover>
        </div>
      )}
    </section>
  )
}
