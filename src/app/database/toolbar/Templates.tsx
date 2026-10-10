/**
 * Row templates: the "New" split button dropdown + template editor modal.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Copy, FileText, Pencil, Plus, Trash } from 'lucide-react'
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page, PageIcon as PageIconT, PropertyDef, PropertyValue, TemplateRepeat } from '../../store/types'
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
import { scheduleChanged } from '../../features'
import { RepeatSettings } from '../templates/RepeatSettings'
import { NextRun } from '../templates/NextRun'
import { isDbReadOnly, useDbReadOnly } from '../readonly'
import { heldTypes } from '../model/recordTypes'
import { TypeMark } from '../rtype/TypeTag'

export type Template = NonNullable<Database['templates']>[number]

export function NewButton({ m, onNew }: { m: DbModel; onNew: (tpl?: Template, typeId?: ID) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<Template | null>(null)
  const templates = m.db.templates ?? []
  const save = (list: Template[]) => useWorkspace.getState().updateDatabase(m.db.id, { templates: list })
  // viewers never see the button (the toolbar shows VIEW ONLY); this guards any other entry point
  if (useDbReadOnly()) return null
  return (
    <span className="db-newbtn">
      <button type="button" className="btn btn--primary btn--sm db-newbtn__main" onClick={() => onNew()} title={t('database.new.tooltip')}>
        {t('common.new')}
      </button>
      <button type="button" className="btn btn--primary btn--sm db-newbtn__more" aria-label={t('database.templates.title')} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <ChevronDown size={13} />
      </button>
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end" className="db-tplmenu" autoFocus={false}>
        <div onKeyDown={menuArrows} ref={focusFirst}>
          <button
            type="button"
            className="menu-item"
            data-nav=""
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
          {/* the record types this database holds: "New Lead" (the type's content as the body) */}
          {heldTypes(m.db, m.kit).length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-section label">{t('database.rtype.section')}</div>
              {heldTypes(m.db, m.kit).map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  className="menu-item"
                  data-nav=""
                  data-testid={`new-of-type-${rt.id}`}
                  onClick={() => {
                    setAnchor(null)
                    onNew(undefined, rt.id)
                  }}
                >
                  <span className="menu-item__icon">
                    <TypeMark rt={rt} />
                  </span>
                  <span className="menu-item__label">{t('database.rtype.newOf', { type: rt.name })}</span>
                </button>
              ))}
            </>
          )}
          <div className="menu-sep" />
          <div className="menu-section label">{t('database.templates.title')}</div>
          {templates.length === 0 && <div className="db-tplmenu__empty">{t('database.templates.none')}</div>}
          {templates.map((tpl) => (
            <div key={tpl.id} className="db-tplmenu__row">
              <button
                type="button"
                className="menu-item"
                data-nav=""
                onClick={() => {
                  setAnchor(null)
                  onNew(tpl)
                }}
              >
                <span className="menu-item__icon">{tpl.icon ? <PageIcon icon={tpl.icon} size={16} /> : <FileText size={14} />}</span>
                {tpl.repeat ? (
                  <span className="db-tplmenu__text">
                    <span className="menu-item__label">{tpl.name || t('common.untitled')}</span>
                    <NextRun repeat={tpl.repeat} />
                  </span>
                ) : (
                  <span className="menu-item__label">{tpl.name || t('common.untitled')}</span>
                )}
              </button>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.edit')} title={t('common.edit')} onClick={() => (setAnchor(null), setEditing(tpl))}>
                <Pencil size={13} />
              </button>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.duplicate')} title={t('common.duplicate')} onClick={() => save([...templates, copyOf(tpl, `${tpl.name} (${t('database.copySuffix')})`)])}>
                <Copy size={13} />
              </button>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.delete')} title={t('common.delete')} onClick={() => deleteTemplate(m.db.id, tpl)}>
                <Trash size={13} />
              </button>
            </div>
          ))}
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            data-nav=""
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
        </div>
      </Popover>
      {editing && <TemplateModal m={m} template={editing} onClose={() => setEditing(null)} />}
    </span>
  )
}

/** ↑↓ move between the dropdown's main entries (the row tools stay reachable with Tab). */
function menuArrows(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]'))
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items[next]?.focus()
}

/** Focus "Empty page" when the dropdown opens — the ⏎ hint must be true. */
function focusFirst(el: HTMLDivElement | null) {
  if (el) requestAnimationFrame(() => el.querySelector<HTMLElement>('[data-nav]')?.focus({ preventScroll: true }))
}

/** A copy never repeats on its own: it would create a second row for every occurrence. */
function copyOf(tpl: Template, name: string): Template {
  const copy: Template = { ...JSON.parse(JSON.stringify(tpl)), id: newId(), name }
  delete copy.repeat
  return copy
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
  if (isDbReadOnly()) return
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

/** The editor's Markdown serializer escapes HTML entities — show plain characters in the textarea. */
function decodeEntities(s: string): string {
  const map: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': '\u00a0' }
  return s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => map[m] ?? m)
}

/** Does Markdown carry this content without loss? (null attrs are defaults and don't count) */
function roundTrips(conv: typeof import('../../editor'), content: JSONContent, md: string): boolean {
  const norm = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(norm)
    if (!n || typeof n !== 'object') return n
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n)) {
      if (v === null || v === undefined || (k === 'attrs' && v && typeof v === 'object' && Object.values(v).every((x) => x === null || x === undefined))) continue
      out[k] = norm(v)
    }
    return out
  }
  try {
    return JSON.stringify(norm(conv.markdownToDoc(md))) === JSON.stringify(norm(content))
  } catch {
    return false
  }
}

function TemplateModal({ m, template, onClose }: { m: DbModel; template: Template; onClose: () => void }) {
  const t = useT()
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState<PageIconT | null>(template.icon ?? null)
  const [props, setProps] = useState<Record<ID, PropertyValue>>(template.properties ?? {})
  const [repeat, setRepeat] = useState<TemplateRepeat | null>(template.repeat ?? null)
  const [md, setMd] = useState('')
  const [conv, setConv] = useState<typeof import('../../editor') | null>(null)
  /** Markdown as first shown — content is only re-parsed when the text was actually edited. */
  const initialMd = useRef('')
  /** The content holds blocks Markdown can't carry (database embeds, columns, colours …). */
  const [lossy, setLossy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  useEffect(() => {
    let alive = true
    // Load the editor's Markdown converters lazily so the database UI never depends on the editor bundle.
    import('../../editor')
      .then((mod) => {
        if (!alive) return
        setConv(mod)
        let text = ''
        try {
          text = template.content ? decodeEntities(mod.docToMarkdown(template.content)) : ''
        } catch {
          text = ''
        }
        initialMd.current = text
        setMd(text)
        setLossy(!!template.content && !roundTrips(mod, template.content, text))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [template.content])
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // the modal focuses its first control (the icon button) — the name is what people type first
    const id = window.setTimeout(() => nameRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [])
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
    if (conv && md !== initialMd.current) {
      try {
        // its tasks written back as `> [!TODO] … {#wi_…}` stay those tasks
        content = md.trim() ? conv.keepItems(conv.markdownToDoc(md), template.content) : null
      } catch {
        /* keep previous content */
      }
    }
    // the scheduler may have advanced lastRunAt while the editor was open: build on the stored copy
    const list = useWorkspace.getState().databases[m.db.id]?.templates ?? m.db.templates ?? []
    const base = list.find((x) => x.id === template.id) ?? template
    const prev = base.repeat ?? null
    // a new or changed schedule counts from now (no backfill); otherwise keep how far runs were handled
    const nextRepeat: TemplateRepeat | null = repeat
      ? { ...repeat, lastRunAt: !prev || scheduleChanged(prev, repeat) || typeof prev.lastRunAt !== 'number' ? Date.now() : prev.lastRunAt }
      : null
    const tpl: Template = { ...base, name: name.trim() || t('common.untitled'), icon, properties: props, content }
    if (nextRepeat) tpl.repeat = nextRepeat
    else delete tpl.repeat
    useWorkspace.getState().updateDatabase(m.db.id, { templates: list.some((x) => x.id === tpl.id) ? list.map((x) => (x.id === tpl.id ? tpl : x)) : [...list, tpl] })
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
          <input ref={nameRef} className="db-tpl__name display" data-autofocus="" value={name} placeholder={t('database.templates.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </div>
        <RepeatSettings db={m.db} name={name} value={repeat} onChange={setRepeat} />
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
        {lossy && !unlocked && (
          <div className="db-tpl__note">
            <span className="label">{t('database.templates.richNote')}</span>
            <button type="button" className="btn btn--sm" onClick={() => setUnlocked(true)}>
              {t('database.templates.editAnyway')}
            </button>
          </div>
        )}
        <textarea
          className="input db-tpl__md"
          rows={8}
          value={md}
          disabled={!conv}
          readOnly={lossy && !unlocked}
          placeholder={t('database.templates.contentPlaceholder')}
          onChange={(e) => setMd(e.target.value)}
        />
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
