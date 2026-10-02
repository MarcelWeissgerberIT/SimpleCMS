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
  const db = s.createDatabase({ title: de ? 'Projekte' : 'Projects', icon: { type: 'emoji', value: '🗂️' } })
  const d = useWorkspace.getState().databases[db]
  const status = d.properties.find((x) => x.type === 'status')!
  const date = d.properties.find((x) => x.type === 'date')!
  const names = de ? ['Website relaunch', 'Notion-Import testen', 'Newsletter Oktober', 'Onboarding-Video'] : ['Website relaunch', 'Test Notion import', 'October newsletter', 'Onboarding video']
  names.forEach((title, i) =>
    s.createRow(db, { title, properties: { [status.id]: status.options![i % 3].id, [date.id]: { start: `2026-10-${String(3 + i * 4).padStart(2, '0')}` } } }),
  )
  s.updateSettings({ startPageId: welcome })
}
