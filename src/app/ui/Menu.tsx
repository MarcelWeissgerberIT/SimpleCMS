import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Popover, type PopoverAnchor } from './Popover'
import type { Placement } from '@floating-ui/react'

export type MenuEntry =
  | {
      kind?: 'item'
      id?: string
      label: string
      icon?: ReactNode
      /** right-aligned hint, e.g. a shortcut "⌘D" */
      hint?: string
      onSelect?: () => void
      danger?: boolean
      disabled?: boolean
      checked?: boolean
      /** nested submenu entries */
      submenu?: MenuEntry[]
      /** extra search keywords */
      keywords?: string
      /** keep menu open after selecting */
      keepOpen?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'section'; label: string }
  | { kind: 'custom'; render: () => ReactNode }

type Item = Extract<MenuEntry, { label: string; kind?: 'item' }>

const isItem = (e: MenuEntry): e is Item => !e.kind || e.kind === 'item'

export interface MenuListProps {
  entries: MenuEntry[]
  onClose: () => void
  /** Show a filter input at the top. */
  searchable?: boolean
  searchPlaceholder?: string
  emptyLabel?: string
}

/** Keyboard navigable list of menu entries (Up/Down/Enter/→ for submenus). */
export function MenuList({ entries, onClose, searchable, searchPlaceholder = 'Search…', emptyLabel = 'No results' }: MenuListProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [sub, setSub] = useState<{ index: number; el: HTMLElement } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    if (!query.trim()) return entries
    const q = query.toLowerCase()
    return entries.filter((e) => isItem(e) && (e.label.toLowerCase().includes(q) || e.keywords?.toLowerCase().includes(q)))
  }, [entries, query])

  const itemIdx = useMemo(() => visible.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0), [visible])

  useEffect(() => {
    setActive(itemIdx[0] ?? 0)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (e: Item, el?: HTMLElement | null) => {
    if (e.disabled) return
    if (e.submenu) {
      const idx = visible.indexOf(e)
      if (el) setSub({ index: idx, el })
      return
    }
    e.onSelect?.()
    if (!e.keepOpen) onClose()
  }

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (sub) return
    const pos = itemIdx.indexOf(active)
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setActive(itemIdx[(pos + 1) % itemIdx.length] ?? 0)
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setActive(itemIdx[(pos - 1 + itemIdx.length) % itemIdx.length] ?? 0)
    } else if (ev.key === 'Enter' || (ev.key === 'ArrowRight' && (visible[active] as Item)?.submenu)) {
      ev.preventDefault()
      const e = visible[active]
      if (e && isItem(e)) select(e, listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`))
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div onKeyDown={onKeyDown} tabIndex={searchable ? undefined : 0} data-autofocus={searchable ? undefined : ''} style={{ outline: 'none' }}>
      {searchable && (
        <div style={{ padding: 4 }}>
          <input
            className="input"
            data-autofocus=""
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div ref={listRef} role="menu">
        {visible.length === 0 && <div className="menu-section faint">{emptyLabel}</div>}
        {visible.map((e, i) => {
          if (e.kind === 'separator') return <div key={i} className="menu-sep" />
          if (e.kind === 'section')
            return (
              <div key={i} className="menu-section label">
                {e.label}
              </div>
            )
          if (e.kind === 'custom') return <div key={i}>{e.render()}</div>
          return (
            <button
              key={e.id ?? i}
              type="button"
              role="menuitem"
              data-index={i}
              data-active={i === active}
              aria-disabled={e.disabled}
              className={`menu-item${e.danger ? ' menu-item--danger' : ''}`}
              onMouseEnter={(ev) => {
                setActive(i)
                if (e.submenu) setSub({ index: i, el: ev.currentTarget })
                else setSub(null)
              }}
              onClick={(ev) => select(e, ev.currentTarget)}
            >
              {e.icon !== undefined && <span className="menu-item__icon">{e.icon}</span>}
              <span className="menu-item__label">{e.label}</span>
              {e.hint && <span className="menu-item__hint">{e.hint}</span>}
              {e.checked && <Check size={14} />}
              {e.submenu && <ChevronRight size={14} className="faint" />}
            </button>
          )
        })}
      </div>
      {sub && isItem(visible[sub.index]) && (visible[sub.index] as Item).submenu && (
        <Popover open anchor={sub.el} onClose={() => setSub(null)} placement="right-start" offset={6}>
          <MenuList
            entries={(visible[sub.index] as Item).submenu!}
            onClose={() => {
              setSub(null)
              onClose()
            }}
          />
        </Popover>
      )}
    </div>
  )
}

export interface MenuProps extends MenuListProps {
  open: boolean
  anchor: PopoverAnchor
  placement?: Placement
  className?: string
  width?: number
}

/** Popover + MenuList. */
export function Menu({ open, anchor, placement = 'bottom-start', className, width, ...list }: MenuProps) {
  return (
    <Popover open={open} anchor={anchor} onClose={list.onClose} placement={placement} className={className} style={width ? { width } : undefined} role="menu">
      <MenuList {...list} />
    </Popover>
  )
}

/** Convenience hook: const menu = useMenu(); <button onClick={menu.toggle}> … <Menu {...menu.props} entries={…}/> */
export function useMenu() {
  const [anchor, setAnchor] = useState<Element | null>(null)
  return {
    open: !!anchor,
    anchor,
    openAt: (el: Element) => setAnchor(el),
    toggle: (e: React.MouseEvent) => setAnchor((a) => (a ? null : e.currentTarget)),
    close: () => setAnchor(null),
    props: { open: !!anchor, anchor, onClose: () => setAnchor(null) },
  }
}
