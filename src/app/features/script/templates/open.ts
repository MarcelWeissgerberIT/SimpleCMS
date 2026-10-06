/**
 * One Script templates — whether the gallery is open (light on purpose: ⌘K and the list open it; the
 * gallery itself loads with the scripts area).
 */
import { create } from 'zustand'
import { navigate } from '../../../lib/router'
import type { TemplateCat } from './catalog'

export const useTemplateGallery = create<{ open: boolean; cat: TemplateCat | 'all' }>()(() => ({ open: false, cat: 'all' }))

/** #/scripts with the template gallery open (optionally on one category). */
export function openTemplateGallery(cat: TemplateCat | 'all' = 'all'): void {
  if (!/^#\/scripts\/?$/.test(window.location.hash)) navigate('#/scripts')
  useTemplateGallery.setState({ open: true, cat })
}

export const closeTemplateGallery = () => useTemplateGallery.setState({ open: false })
