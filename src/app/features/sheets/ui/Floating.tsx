/**
 * A passive floating panel (autocomplete list, signature hint) anchored to an element: a portal
 * positioned with floating-ui, without the key / outside-click handling of Popover — the input it
 * belongs to keeps the keyboard.
 */
import { useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react'

export function Floating({ anchor, children, placement = 'bottom-start', className, id, role }: { anchor: Element | null; children: ReactNode; placement?: Placement; className?: string; id?: string; role?: string }) {
  const { refs, floatingStyles } = useFloating({ placement, strategy: 'fixed', whileElementsMounted: autoUpdate, middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })] })
  useLayoutEffect(() => {
    refs.setReference(anchor)
  }, [anchor, refs])
  if (!anchor) return null
  return createPortal(
    <div ref={refs.setFloating} id={id} role={role} data-popover="" className={className} style={floatingStyles} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  )
}
