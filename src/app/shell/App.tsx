// STUB — replaced by the shell area. Minimal layout so the app boots.
import { useRoute } from '../lib/router'
import { useWorkspace } from '../store/store'
import { selectChildren } from '../store/selectors'
import { PageEditor } from '../editor'
import { DatabaseView } from '../database'
import { useThemeAndLanguage } from '../lib/theme'

export function App() {
  useThemeAndLanguage()
  const route = useRoute()
  const pages = useWorkspace((s) => s.pages)
  const roots = selectChildren(pages, null)
  const id = route.name === 'page' ? route.id : roots[0]?.id
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav style={{ width: 240, background: 'var(--surface-2)', padding: 12 }}>
        {roots.map((p) => (
          <a key={p.id} href={`#/p/${p.id}`} style={{ display: 'block' }}>
            {p.title}
          </a>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 40, overflow: 'auto' }}>{id && (pages[id]?.kind === 'database' ? <DatabaseView databaseId={id} /> : <PageEditor pageId={id} />)}</main>
    </div>
  )
}
