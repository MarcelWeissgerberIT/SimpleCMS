import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, type PopoverAnchor } from './Popover'
import type { Placement } from '@floating-ui/react'
import { useT } from '../i18n'

const NARROW = '(max-width: 640px)'

/** Phones: no room for a submenu beside its menu, so submenus open in place (with a back row). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

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

interface InnerProps extends MenuListProps {
  /** In-place submenu (narrow screens): the label of the parent item + how to get back. */
  back?: { label: string; onBack: () => void }
  /** Index to highlight first (when coming back from a submenu). */
  initialActive?: number
  /** Take focus when mounted (in-place submenus). */
  focusOnMount?: boolean
}

/** Keyboard navigable list of menu entries (Up/Down/Enter/→ for submenus). */
export function MenuList(props: MenuListProps) {
  return <MenuListInner {...props} />
}

function MenuListInner({ entries, onClose, searchable, searchPlaceholder = 'Search…', emptyLabel = 'No results', back, initialActive, focusOnMount }: InnerProps) {
  const t = useT()
  const narrow = useNarrow()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(initialActive ?? 0)
  const [sub, setSub] = useState<{ index: number; el: HTMLElement } | null>(null)
  const [returnTo, setReturnTo] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    if (!query.trim()) return entries
    const q = query.toLowerCase()
    return entries.filter((e) => isItem(e) && (e.label.toLowerCase().includes(q) || e.keywords?.toLowerCase().includes(q)))
  }, [entries, query])

  const itemIdx = useMemo(() => visible.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0), [visible])

  const firstQuery = useRef(true)
  useEffect(() => {
    if (firstQuery.current && initialActive !== undefined) {
      firstQuery.current = false
      return
    }
    firstQuery.current = false
    setActive(itemIdx[0] ?? 0)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusOnMount) rootRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

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
    if (back && ev.key === 'ArrowLeft') {
      ev.preventDefault()
      ev.stopPropagation()
      back.onBack()
      return
    }
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

  const subItem = sub && isItem(visible[sub.index]) ? (visible[sub.index] as Item) : null

  // narrow screens: the submenu replaces this list, with a back row on top
  if (narrow && sub && subItem?.submenu) {
    return (
      <MenuListInner
        entries={subItem.submenu}
        back={{
          label: subItem.label,
          onBack: () => {
            setReturnTo(sub.index)
            setSub(null)
          },
        }}
        focusOnMount
        onClose={() => {
          setSub(null)
          onClose()
        }}
      />
    )
  }

  return (
    <MenuRoot
      rootRef={rootRef}
      onKeyDown={onKeyDown}
      searchable={searchable}
      initialFocus={returnTo !== null}
    >
      {back && (
        <>
          <button type="button" className="menu-item menu-back" onClick={back.onBack} aria-label={`${t('common.back')}: ${back.label}`}>
            <span className="menu-item__icon">
              <ChevronLeft size={14} />
            </span>
            <span className="menu-item__label">{back.label}</span>
          </button>
          <div className="menu-sep" />
        </>
      )}
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
              aria-haspopup={e.submenu ? 'menu' : undefined}
              aria-expanded={e.submenu ? sub?.index === i : undefined}
              className={`menu-item${e.danger ? ' menu-item--danger' : ''}`}
              onMouseEnter={(ev) => {
                setActive(i)
                // phones open submenus by tap (in place), never on the synthetic hover of a tap
                if (narrow) return
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
      {!narrow && subItem?.submenu && sub && (
        <Popover open anchor={sub.el} onClose={() => setSub(null)} placement="right-start" offset={6} shiftCrossAxis>
          <MenuList
            entries={subItem.submenu}
            onClose={() => {
              setSub(null)
              onClose()
            }}
          />
        </Popover>
      )}
    </MenuRoot>
  )
}

/** Focusable wrapper of a menu list (takes focus back after leaving an in-place submenu). */
function MenuRoot({
  rootRef,
  onKeyDown,
  searchable,
  initialFocus,
  children,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  onKeyDown: (ev: React.KeyboardEvent) => void
  searchable?: boolean
  initialFocus: boolean
  children: ReactNode
}) {
  useEffect(() => {
    if (initialFocus) rootRef.current?.focus({ preventScroll: true })
  }, [initialFocus, rootRef])
  return (
    <div ref={rootRef} onKeyDown={onKeyDown} tabIndex={searchable ? undefined : 0} data-autofocus={searchable ? undefined : ''} style={{ outline: 'none' }}>
      {children}
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
    // read currentTarget now: React resets it after the handler, before the updater runs
    toggle: (e: React.MouseEvent) => {
      const el = e.currentTarget
      setAnchor((a) => (a ? null : el))
    },
    close: () => setAnchor(null),
    props: { open: !!anchor, anchor, onClose: () => setAnchor(null) },
  }
}
