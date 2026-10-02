/**
 * First-run demo workspace. (A richer bilingual seed is generated later.)
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import { useWorkspace } from './store'

const p = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

export function seedWorkspace(lang: Lang): void {
  const s = useWorkspace.getState()
  const de = lang === 'de'
  const welcome = s.createPage({
    title: de ? 'Willkommen bei One' : 'Welcome to One',
    icon: { type: 'emoji', value: '👋' },
    content: { type: 'doc', content: [h(2, de ? 'Schön, dass du da bist.' : 'Glad you are here.'), p(de ? 'Tippe / für Befehle.' : 'Type / for commands.')] },
  })
  s.updateSettings({ startPageId: welcome })
}
