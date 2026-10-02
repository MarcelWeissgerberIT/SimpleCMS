/**
 * Pickers for person, relation and files properties.
 */
import { useMemo, useRef, useState } from 'react'
import { Check, Link2, Plus, Upload, X } from 'lucide-react'
import type { ID, Page, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { caretToEnd } from './TextEditor'
import { PageIcon } from '../../ui/PageIcon'
import { Avatar, FileChip, PersonChip, RelationChip } from './display'
import { uploadFiles, useFileMeta } from '../model/files'
import { fileLabel } from '../model/resolve'
import { useRows } from '../../store/selectors'

/* ---------------- generic searchable list ---------------- */

function usePickerKeys(count: number, onEnter: (i: number) => void, extra?: (e: React.KeyboardEvent) => boolean) {
  const [active, setActive] = useState(0)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.target as HTMLElement).classList.contains('db-picker__input')) return
    if (extra?.(e)) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(count - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (count > 0) onEnter(Math.min(active, count - 1))
    }
  }
  return { active, setActive, onKeyDown }
}

/* ---------------- person ---------------- */

export function PersonPicker({ value, onChange, onClose, initialQuery }: { value: string[]; onChange: (v: string[]) => void; onClose: () => void; initialQuery?: string }) {
  const t = useT()
  const people = useWorkspace((s) => s.people)
  const [query, setQuery] = useState(initialQuery ?? '')
  const q = query.trim().toLowerCase()
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q))
  const canCreate = !!q && !people.some((p) => p.name.toLowerCase() === q)
  const toggle = (id: ID) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  // picking from the list starts the next search fresh: "type, Enter, type, Enter" adds several
  const pick = (id: ID) => {
    toggle(id)
    setQuery('')
    keys.setActive(0)
  }
  const create = () => {
    const name = query.trim()
    if (!name) return
    const id = useWorkspace.getState().addPerson(name)
    onChange([...value, id])
    setQuery('')
    keys.setActive(0)
  }
  const keys = usePickerKeys(
    list.length + (canCreate ? 1 : 0),
    (i) => (i < list.length ? pick(list[i].id) : canCreate && create()),
    (e) => {
      if (e.key === 'Backspace' && !query && value.length) {
        onChange(value.slice(0, -1))
        return true
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        onClose()
        return true
      }
      return false
    },
  )
  return (
    <div className="db-picker" onKeyDown={keys.onKeyDown}>
      <div className="db-picker__field">
        {value.map((id) => {
          const p = people.find((x) => x.id === id)
          return p ? <PersonChip key={id} person={p} onRemove={() => toggle(id)} /> : null
        })}
        <input
          className="db-picker__input"
          data-autofocus=""
          onFocus={caretToEnd}
          value={query}
          placeholder={value.length ? '' : t('database.person.search')}
          onChange={(e) => {
            setQuery(e.target.value)
            keys.setActive(0)
          }}
        />
      </div>
      <div className="db-picker__list" role="listbox" aria-multiselectable>
        {list.length > 0 && <div className="label db-picker__section">{t('database.person.people')}</div>}
        {list.map((p, i) => (
          <div key={p.id} className="db-opt" role="option" aria-selected={value.includes(p.id)} data-active={keys.active === i} onMouseEnter={() => keys.setActive(i)} onClick={() => pick(p.id)}>
            <Avatar person={p} size={20} />
            <span className="db-opt__name">{p.name}</span>
            {value.includes(p.id) && <Check size={14} className="db-opt__check" />}
          </div>
        ))}
        {canCreate && (
          <div className="db-opt" data-active={keys.active === list.length} onMouseEnter={() => keys.setActive(list.length)} onClick={create}>
            <Plus size={14} className="faint" />
            <span className="db-opt__create">{t('database.person.add', { name: query.trim() })}</span>
          </div>
        )}
        {!list.length && !canCreate && <div className="label db-picker__empty">{t('database.person.empty')}</div>}
      </div>
    </div>
  )
}

/* ---------------- relation ---------------- */

export function RelationPicker({ prop, value, onChange, onClose, initialQuery }: { prop: PropertyDef; value: string[]; onChange: (v: string[]) => void; onClose: () => void; initialQuery?: string }) {
  const t = useT()
  const targetId = prop.relationDatabaseId
  const targetPage = useWorkspace((s) => (targetId ? s.pages[targetId] : undefined))
  const rows = useRows(targetId)
  const pages = useWorkspace((s) => s.pages)
  const [query, setQuery] = useState(initialQuery ?? '')
  const q = query.trim().toLowerCase()
  const list = useMemo(() => rows.filter((r) => !q || (r.title || '').toLowerCase().includes(q)).slice(0, 200), [rows, q])
  const toggle = (id: ID) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const pick = (id: ID) => {
    toggle(id)
    setQuery('')
    keys.setActive(0)
  }
  const create = () => {
    const title = query.trim()
    if (!targetId || !title) return
    const id = useWorkspace.getState().createRow(targetId, { title })
    onChange([...value, id])
    setQuery('')
    keys.setActive(0)
  }
  const keys = usePickerKeys(
    list.length + (q ? 1 : 0),
    (i) => (i < list.length ? pick(list[i].id) : create()),
    (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        onClose()
        return true
      }
      return false
    },
  )
  if (!targetId || !targetPage) return <div className="label db-picker__empty">{t('database.relation.noTarget')}</div>
  return (
    <div className="db-picker db-picker--wide" onKeyDown={keys.onKeyDown}>
      <div className="db-picker__field">
        {value.map((id) => {
          const p = pages[id]
          return p && !p.trashed ? <RelationChip key={id} page={p} linkable={false} onRemove={() => toggle(id)} /> : null
        })}
        <input
          className="db-picker__input"
          data-autofocus=""
          onFocus={caretToEnd}
          value={query}
          placeholder={t('database.relation.search', { db: targetPage.title || t('common.untitled') })}
          onChange={(e) => {
            setQuery(e.target.value)
            keys.setActive(0)
          }}
        />
      </div>
      <div className="db-picker__list" role="listbox" aria-multiselectable>
        <div className="label db-picker__section">
          <PageIcon icon={targetPage.icon} kind="database" size={12} /> {targetPage.title || t('common.untitled')}
        </div>
        {list.map((r: Page, i) => (
          <div key={r.id} className="db-opt" role="option" aria-selected={value.includes(r.id)} data-active={keys.active === i} onMouseEnter={() => keys.setActive(i)} onClick={() => pick(r.id)}>
            <PageIcon icon={r.icon} size={16} />
            <span className={`db-opt__name${r.title ? '' : ' faint'}`}>{r.title || t('common.untitled')}</span>
            {value.includes(r.id) && <Check size={14} className="db-opt__check" />}
          </div>
        ))}
        {q && (
          <div className="db-opt" data-active={keys.active === list.length} onMouseEnter={() => keys.setActive(list.length)} onClick={create}>
            <Plus size={14} className="faint" />
            <span className="db-opt__create">{t('database.relation.create', { name: query.trim() })}</span>
          </div>
        )}
        {!list.length && !q && <div className="label db-picker__empty">{t('database.relation.empty')}</div>}
      </div>
    </div>
  )
}

/* ---------------- files ---------------- */

function FileRow({ src, onRemove }: { src: string; onRemove: () => void }) {
  const t = useT()
  const meta = useFileMeta(src)
  return (
    <div className="db-filerow">
      <FileChip src={src} big />
      <span className="db-filerow__name">{meta?.name ?? fileLabel(src)}</span>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.remove')} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  )
}

export function FilesEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const latest = useRef(value)
  latest.current = value
  const add = async (files: FileList | File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const refs = await uploadFiles(files)
      onChange([...latest.current, ...refs])
    } finally {
      setBusy(false)
    }
  }
  const addLink = () => {
    const u = link.trim()
    if (!u) return
    onChange([...value, /^[a-z]+:/i.test(u) ? u : `https://${u}`])
    setLink('')
  }
  return (
    <div
      className="db-files"
      data-drag={drag}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void add(e.dataTransfer.files)
      }}
    >
      {value.length > 0 && (
        <div className="db-files__list">
          {value.map((src, i) => (
            <FileRow key={src + i} src={src} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <button type="button" className="btn btn--sm db-files__upload" onClick={() => inputRef.current?.click()} disabled={busy} data-autofocus="">
        <Upload size={13} /> {busy ? t('common.loading') : t('database.files.upload')}
      </button>
      <span className="label db-files__hint">{t('database.files.drop')}</span>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && void add(e.target.files)} />
      <div className="db-files__link">
        <Link2 size={13} className="faint" />
        <input
          className="db-picker__input"
          value={link}
          placeholder={t('database.files.link')}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addLink()
            }
          }}
        />
      </div>
    </div>
  )
}

