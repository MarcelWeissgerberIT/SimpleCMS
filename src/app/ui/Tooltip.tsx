import { cloneElement, useRef, useState, type ReactElement } from 'react'
import { Popover } from './Popover'
import type { Placement } from '@floating-ui/react'

/** Hover/focus tooltip with optional shortcut keycap. Wrap a single element. */
export function Tooltip({
  label,
  shortcut,
  placement = 'bottom',
  children,
}: {
  label: string
  shortcut?: string
  placement?: Placement
  children: ReactElement<Record<string, unknown>>
}) {
  const [anchor, setAnchor] = useState<Element | null>(null)
  const timer = useRef<number>(undefined)
  const show = (el: Element) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAnchor(el), 450)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setAnchor(null)
  }
  const props = children.props as Record<string, unknown>
  return (
    <>
      {cloneElement(children, {
        'aria-label': props['aria-label'] ?? label,
        onMouseEnter: (e: React.MouseEvent) => {
          show(e.currentTarget)
          ;(props.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e)
        },
        onMouseLeave: (e: React.MouseEvent) => {
          hide()
          ;(props.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e)
        },
        onMouseDown: (e: React.MouseEvent) => {
          hide()
          ;(props.onMouseDown as ((e: React.MouseEvent) => void) | undefined)?.(e)
        },
        onFocus: (e: React.FocusEvent) => {
          if ((e.currentTarget as HTMLElement).matches(':focus-visible')) show(e.currentTarget)
          ;(props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e)
        },
        onBlur: (e: React.FocusEvent) => {
          hide()
          ;(props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e)
        },
      })}
      <Popover open={!!anchor} anchor={anchor} onClose={hide} placement={placement} offset={6} bare className="tooltip" autoFocus={false} closeOnOutside={false}>
        {label}
        {shortcut && <span className="kbd">{shortcut}</span>}
      </Popover>
    </>
  )
}
