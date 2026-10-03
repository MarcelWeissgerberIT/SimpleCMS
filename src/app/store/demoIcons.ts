/**
 * The demo workspace used emoji page icons until October 2026; it now ships icons from the generated
 * set (public/assets/icons). Workspaces seeded before keep their data, so on boot the local workspace
 * swaps the demo pages' icons — but only where the page still has its seeded title AND its seeded emoji
 * (anything the person changed stays as it is). Idempotent: nothing matches after the first run.
 */
import type { ID, PageIcon } from './types'
import { useWorkspace } from './store'

/** seeded emoji → [titles (EN, DE), new asset icon] */
const DEMO: Array<[string, string[], string]> = [
  ['👋', ['Welcome to One', 'Willkommen bei One'], 'app-icon'],
  ['📖', ['Team wiki', 'Team-Wiki'], 'binder'],
  ['🗓️', ['Weekly sync — notes', 'Weekly Sync — Notizen'], 'notepad'],
  ['🗂️', ['Projects', 'Projekte'], 'kanban'],
  ['📚', ['Reading list', 'Leseliste'], 'book'],
  ['📣', ['Content calendar', 'Content-Kalender'], 'megaphone'],
  ['🎙️', ['Brand voice', 'Markenstimme'], 'microphone'],
  ['🧭', ['Onboarding'], 'compass'],
  ['🛠️', ['Tooling & automations', 'Tools & Automationen'], 'automation'],
  ['🔤', ['Glossary', 'Glossar'], 'cardbox'],
  ['🗒️', ['Meetings'], 'clock'],
]

const asset = (value: string): PageIcon => ({ type: 'asset', value })

export function refreshDemoIcons(): number {
  const s = useWorkspace.getState()
  let changed = 0
  for (const page of Object.values(s.pages)) {
    if (page.icon?.type !== 'emoji' || page.databaseId) continue
    const hit = DEMO.find(([emoji, titles]) => page.icon?.value === emoji && titles.includes(page.title))
    if (!hit) continue
    s.updatePage(page.id, { icon: asset(hit[2]) })
    changed++
  }
  // the Meetings database's repeating "Weekly sync" template
  for (const [id, db] of Object.entries(s.databases) as Array<[ID, (typeof s.databases)[ID]]>) {
    const tpls = db.templates
    if (!tpls?.some((t) => t.icon?.type === 'emoji' && t.icon.value === '🗓️' && t.name === 'Weekly sync')) continue
    s.updateDatabase(id, { templates: tpls.map((t) => (t.icon?.type === 'emoji' && t.icon.value === '🗓️' && t.name === 'Weekly sync' ? { ...t, icon: asset('clock') } : t)) })
    changed++
  }
  return changed
}
