/**
 * Sheet tabs under the grid ("01 · Budget"): click to open, double-click to rename, drag (or
 * Alt+←/→) to reorder, menu for duplicate / move / delete, + to add.
 */
import { useRef, useState } from 'react'
import { Ellipsis, Plus } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import type { SheetData } from '../model'
import { sheetLabel } from '../static'

export interface SheetTabsProps {
  sheets: SheetData[]
  active: string
  editable: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
  onSelect: (id: string) => void
  onAdd: () => void
  /** returns an error message key, or null when renamed */
  onRename: (id: string, name: string) => string | null
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, to: number) => void
}

export function SheetTabs({ sheets, active, editable, t, onSelect, onAdd, onRename, onDuplicate, onDelete, onMove }: SheetTabsProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null)
  const menu = useMenu()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  const startRename = (s: SheetData) => {
    if (!editable) return
    setRenaming(s.id)
    setDraft(s.name)
    setProblem(null)
  }
  const commitRename = () => {
    if (!renaming) return
    const err = onRename(renaming, draft)
    if (err) {
      setProblem(err)
      return
    }
    setRenaming(null)
  }

  /** Pointer drag: the tab under the pointer is the drop slot. */
  const pointerDown = (e: React.PointerEvent, s: SheetData) => {
    if (!editable || e.button !== 0 || renaming) return
    const x0 = e.clientX
    let started = false
    let to = sheets.indexOf(s)
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - x0) < 6) return
      started = true
      const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
      to = tabs.findIndex((el) => {
        const r = el.getBoundingClientRect()
        return ev.clientX < r.right
      })
      if (to < 0) to = tabs.length - 1
      setDrag({ id: s.id, to })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (started) onMove(s.id, to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const entries = (id: string): MenuEntry[] => {
    const i = sheets.findIndex((s) => s.id === id)
    return [
      { label: t('features.sheets.rename'), onSelect: () => startRename(sheets[i]) },
      { label: t('features.sheets.duplicate'), onSelect: () => onDuplicate(id) },
      { label: t('features.sheets.moveLeft'), disabled: i <= 0, onSelect: () => onMove(id, i - 1) },
      { label: t('features.sheets.moveRight'), disabled: i >= sheets.length - 1, onSelect: () => onMove(id, i + 1) },
      { kind: 'separator' },
      { label: t('features.sheets.deleteSheet'), danger: true, disabled: sheets.length < 2, onSelect: () => onDelete(id) },
    ]
  }

  return (
    <div className="sheet-tabs">
      <div className="sheet-tabs__strip" ref={strip} role="tablist" aria-label={t('features.sheets.tabs')}>
        {sheets.map((s, i) =>
          renaming === s.id ? (
            <span key={s.id} className="sheet-tab is-renaming" data-tab="">
              <span className="sheet-tab__no">{String(i + 1).padStart(2, '0')} ·</span>
              <input
                className="sheet-tab__input"
                value={draft}
                autoFocus
                aria-label={t('features.sheets.sheetName')}
                aria-invalid={!!problem}
                title={problem ? t(problem) : undefined}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setProblem(null)
                }}
                onFocus={(e) => e.target.select()}
                onBlur={() => {
                  // leaving the field keeps a valid name, drops an invalid one
                  onRename(s.id, draft)
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                size={Math.max(4, draft.length + 1)}
              />
            </span>
          ) : (
            <button
              key={s.id}
              type="button"
              role="tab"
              data-tab=""
              aria-selected={s.id === active}
              tabIndex={s.id === active ? 0 : -1}
              className={`sheet-tab${s.id === active ? ' is-active' : ''}${drag?.id === s.id ? ' is-dragging' : ''}${drag && drag.id !== s.id && drag.to === i ? ' is-drop' : ''}`}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => startRename(s)}
              onPointerDown={(e) => pointerDown(e, s)}
              onContextMenu={(e) => {
                if (!editable) return
                e.preventDefault()
                setMenuFor(s.id)
                menu.openAt(e.currentTarget)
              }}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && editable) {
                  e.preventDefault()
                  onMove(s.id, i + (e.key === 'ArrowLeft' ? -1 : 1))
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  const next = sheets[(i + (e.key === 'ArrowLeft' ? sheets.length - 1 : 1)) % sheets.length]
                  onSelect(next.id)
                  requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
                } else if (e.key === 'F2') startRename(s)
              }}
            >
              {sheetLabel(i, s.name)}
            </button>
          ),
        )}
      </div>
      {editable && problem && renaming && <span className="sheet-tabs__problem">{t(problem)}</span>}
      {editable && (
        <>
          <button
            type="button"
            className="sheet-tabs__btn"
            aria-label={t('features.sheets.sheetMenu')}
            title={t('features.sheets.sheetMenu')}
            onClick={(e) => {
              setMenuFor(active)
              menu.openAt(e.currentTarget)
            }}
          >
            <Ellipsis size={14} strokeWidth={1.75} />
          </button>
          <button type="button" className="sheet-tabs__btn" aria-label={t('features.sheets.addSheet')} title={t('features.sheets.addSheet')} onClick={onAdd}>
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </>
      )}
      {menuFor && <Menu {...menu.props} entries={entries(menuFor)} />}
    </div>
  )
}
