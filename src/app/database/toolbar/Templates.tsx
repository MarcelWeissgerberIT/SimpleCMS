/**
 * Row templates: the "New" split button dropdown + template editor modal.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, FileText, Pencil, Plus, Trash } from 'lucide-react'
import type { Database, ID, Page, PageIcon as PageIconT, PropertyDef, PropertyValue } from '../../store/types'
import { useWorkspace, DEFAULT_PAGE_SETTINGS } from '../../store/store'
import { useUI } from '../../store/ui'
import { Popover } from '../../ui/Popover'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { IconPicker } from '../../ui/IconPicker'
import { Kbd } from '../../ui/controls'
import { useT, t as tt } from '../../i18n'
import { newId } from '../../lib/ids'
import { PropertyRows } from '../RowProperties'
import { isComputed } from '../model/schema'
import type { DbModel } from '../hooks'

export type Template = NonNullable<Database['templates']>[number]

export function NewButton({ m, onNew }: { m: DbModel; onNew: (tpl?: Template) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<Template | null>(null)
  const templates = m.db.templates ?? []
  const save = (list: Template[]) => useWorkspace.getState().updateDatabase(m.db.id, { templates: list })
  return (
    <span className="db-newbtn">
      <button type="button" className="btn btn--primary btn--sm db-newbtn__main" onClick={() => onNew()} title={t('database.new.tooltip')}>
        {t('common.new')}
      </button>
      <button type="button" className="btn btn--primary btn--sm db-newbtn__more" aria-label={t('database.templates.title')} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <ChevronDown size={13} />
      </button>
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end" className="db-tplmenu">
        <div className="menu-section label">{t('database.templates.title')}</div>
        {templates.length === 0 && <div className="db-tplmenu__empty">{t('database.templates.none')}</div>}
        {templates.map((tpl) => (
          <div key={tpl.id} className="db-tplmenu__row">
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setAnchor(null)
                onNew(tpl)
              }}
            >
              <span className="menu-item__icon">{tpl.icon ? <PageIcon icon={tpl.icon} size={16} /> : <FileText size={14} />}</span>
              <span className="menu-item__label">{tpl.name || t('common.untitled')}</span>
            </button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.edit')} onClick={() => (setAnchor(null), setEditing(tpl))}>
              <Pencil size={13} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.duplicate')} onClick={() => save([...templates, { ...JSON.parse(JSON.stringify(tpl)), id: newId(), name: `${tpl.name} (${t('database.copySuffix')})` }])}>
              <Copy size={13} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.delete')} onClick={() => deleteTemplate(m.db.id, tpl)}>
              <Trash size={13} />
            </button>
          </div>
        ))}
        <div className="menu-sep" />
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setAnchor(null)
            setEditing({ id: newId(), name: '', icon: null, content: null, properties: {} })
          }}
        >
          <span className="menu-item__icon">
            <Plus size={14} />
          </span>
          <span className="menu-item__label">{t('database.templates.new')}</span>
        </button>
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setAnchor(null)
            onNew()
          }}
        >
          <span className="menu-item__icon">
            <FileText size={14} />
          </span>
          <span className="menu-item__label">{t('database.templates.empty')}</span>
          <Kbd>⏎</Kbd>
        </button>
      </Popover>
      {editing && <TemplateModal m={m} template={editing} onClose={() => setEditing(null)} />}
    </span>
  )
}

function deleteTemplate(dbId: ID, tpl: Template) {
  const s = useWorkspace.getState()
  const list = s.databases[dbId]?.templates ?? []
  const idx = list.findIndex((x) => x.id === tpl.id)
  s.updateDatabase(dbId, { templates: list.filter((x) => x.id !== tpl.id) })
  useUI.getState().toast({
    message: tt('database.templates.deleted', { name: tpl.name || tt('common.untitled') }),
    action: {
      label: tt('common.undo'),
      run: () => {
        const cur = useWorkspace.getState().databases[dbId]?.templates ?? []
        const next = [...cur]
        next.splice(Math.max(0, idx), 0, tpl)
        useWorkspace.getState().updateDatabase(dbId, { templates: next })
      },
    },
  })
}

/** Capture a row as a template (title becomes the template name). */
export function saveRowAsTemplate(db: Database, row: Page): void {
  const props: Record<ID, PropertyValue> = {}
  for (const p of db.properties) {
    if (p.type === 'title' || isComputed(p)) continue
    const v = row.properties[p.id]
    if (v !== undefined && v !== null) props[p.id] = JSON.parse(JSON.stringify(v))
  }
  const tpl: Template = { id: newId(), name: row.title || tt('common.untitled'), icon: row.icon, content: row.content ? JSON.parse(JSON.stringify(row.content)) : null, properties: props }
  const s = useWorkspace.getState()
  s.updateDatabase(db.id, { templates: [...(s.databases[db.id]?.templates ?? []), tpl] })
  useUI.getState().toast({ message: tt('database.templates.saved', { name: tpl.name }), kind: 'success' })
}

function TemplateModal({ m, template, onClose }: { m: DbModel; template: Template; onClose: () => void }) {
  const t = useT()
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState<PageIconT | null>(template.icon ?? null)
  const [props, setProps] = useState<Record<ID, PropertyValue>>(template.properties ?? {})
  const [md, setMd] = useState('')
  const [conv, setConv] = useState<typeof import('../../editor') | null>(null)
  useEffect(() => {
    let alive = true
    // Load the editor's Markdown converters lazily so the database UI never depends on the editor bundle.
    import('../../editor')
      .then((mod) => {
        if (!alive) return
        setConv(mod)
        try {
          setMd(template.content ? mod.docToMarkdown(template.content) : '')
        } catch {
          setMd('')
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [template.content])
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const exists = (m.db.templates ?? []).some((x) => x.id === template.id)

  const fakeRow: Page = useMemo(
    () => ({
      id: '__template__',
      kind: 'page',
      title: name,
      icon,
      cover: null,
      parentId: m.db.id,
      databaseId: m.db.id,
      properties: props,
      content: null,
      contentRev: 0,
      contentOrigin: null,
      favorite: false,
      trashed: false,
      trashedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: 0,
      settings: DEFAULT_PAGE_SETTINGS,
    }),
    [name, icon, props, m.db.id],
  )
  const editable = m.db.properties.filter((p: PropertyDef) => p.type !== 'title' && !isComputed(p))

  const save = () => {
    let content = template.content
    if (conv) {
      try {
        content = md.trim() ? conv.markdownToDoc(md) : null
      } catch {
        /* keep previous content */
      }
    }
    const tpl: Template = { ...template, name: name.trim() || t('common.untitled'), icon, properties: props, content }
    const list = m.db.templates ?? []
    useWorkspace.getState().updateDatabase(m.db.id, { templates: exists ? list.map((x) => (x.id === tpl.id ? tpl : x)) : [...list, tpl] })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={t('database.templates.label')}
      title={exists ? t('database.templates.edit') : t('database.templates.new')}
      width={640}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="db-tpl">
        <div className="db-tpl__title">
          <button type="button" className="db-tpl__icon" aria-label={t('database.templates.icon')} onClick={(e) => setIconAnchor(e.currentTarget)}>
            {icon ? <PageIcon icon={icon} size={22} /> : <FileText size={18} />}
          </button>
          <input className="db-tpl__name display" data-autofocus="" value={name} placeholder={t('database.templates.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="label db-tpl__sec">{t('database.templates.properties')}</div>
        <PropertyRows
          db={m.db}
          row={fakeRow}
          resolver={m.resolver}
          props={editable}
          getValue={(p) => props[p.id] ?? null}
          onChange={(p, v) => setProps((cur) => ({ ...cur, [p.id]: v }))}
          noPropMenu
        />
        <div className="label db-tpl__sec">{t('database.templates.content')}</div>
        <textarea className="input db-tpl__md" rows={8} value={md} disabled={!conv} placeholder={t('database.templates.contentPlaceholder')} onChange={(e) => setMd(e.target.value)} />
      </div>
      <Popover open={!!iconAnchor} anchor={iconAnchor} onClose={() => setIconAnchor(null)} bare>
        <IconPicker
          onSelect={(i) => {
            setIcon(i)
            setIconAnchor(null)
          }}
          onRemove={() => {
            setIcon(null)
            setIconAnchor(null)
          }}
        />
      </Popover>
    </Modal>
  )
}
