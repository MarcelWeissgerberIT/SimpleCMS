/**
 * "Turn into page" in a team workspace (docs/CLOUD.md § Private pages): blocks of a PRIVATE page become a
 * private sub-page (stored under the member's private document name, never the workspace's), its inline
 * database goes along and stays private; blocks of a shared page become a shared sub-page that a
 * colleague sees. Y undo (⌘Z) puts the blocks back and trashes the untouched page.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Locator, Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, cloudEval, waitOnline, gotoPage, editorOf, createWorkspace, join as joinWorkspace } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const PORT = Number(process.env.CLOUD_E2E_PORT) || 4500
const DB_FILE = join(process.cwd(), `node_modules/.cache/cloud-data-${PORT}`, 'one.sqlite')

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

function stored(prefix: string): string[] {
  const db = new DatabaseSync(DB_FILE, { readOnly: true })
  try {
    return (db.prepare('SELECT name FROM documents WHERE substr(name, 1, ?) = ?').all(prefix.length, prefix) as Array<{ name: string }>).map((r) => r.name)
  } finally {
    db.close()
  }
}

/** Top-level node types (without the empty line the editor keeps after a last non-text block). */
const topTypes = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    const list = (s.pages[id]?.content?.content ?? []) as AnyState[]
    const last = list[list.length - 1]
    return (last?.type === 'paragraph' && !last.content?.length ? list.slice(0, -1) : list).map((n) => n.type)
  }, id)
const linkIn = (page: Page, id: string) => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).find((n) => n.type === 'pageLink')?.attrs?.pageId ?? null, id)

async function selectBlocks(ed: Locator, a: string, b: string): Promise<void> {
  await ed.evaluate(
    (el, [a, b]) => {
      const editor = (el as HTMLElement & { editor: AnyState }).editor
      let from = -1
      let to = -1
      editor.state.doc.descendants((n: AnyState, pos: number) => {
        if (!n.isTextblock) return true
        if (from < 0 && n.textContent.includes(a)) from = pos + 1
        if (n.textContent.includes(b)) to = pos + 1 + n.content.size
        return false
      })
      editor.chain().focus().setTextSelection({ from, to }).run()
    },
    [a, b] as const,
  )
  await expect(ed).toBeFocused()
}

const body = (title: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Stays here.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
    { type: 'paragraph', content: [{ type: 'text', text: `${title} detail one.` }] },
    { type: 'paragraph', content: [{ type: 'text', text: `${title} detail two.` }] },
  ],
})

test.describe('team cloud — turn into page', () => {
  test('a private page: the new page is private (private document name), its inline database goes along; ⌘Z (Y undo) puts it back and trashes the page', async ({ page: a }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Split private')
    await openApp(a, wsId)
    await waitOnline(a)
    const ada = await cloudEval(a, (c) => c.user.id as string)

    const pageId = await a.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'My plans' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    const dbId = await wsEval(a, (s, parentId) => s.createDatabase({ parentId, inline: true, title: 'Private list' }), pageId)
    await wsEval(
      a,
      (s, arg) => {
        const doc = arg.doc
        doc.content.splice(3, 0, { type: 'databaseBlock', attrs: { databaseId: arg.dbId, viewId: null } })
        s.setContent(arg.pageId, doc, 'import')
      },
      { pageId, dbId, doc: body('Secret trip') },
    )
    await gotoPage(a, pageId)
    const ed = editorOf(a, pageId)
    await expect(ed).toContainText('Secret trip detail two.')
    await expect(ed.locator('section.db')).toBeVisible()

    await selectBlocks(ed, 'Secret trip', 'Secret trip detail two.')
    await a.keyboard.press(`${mod}+Alt+9`)
    await expect.poll(() => topTypes(a, pageId)).toEqual(['paragraph', 'pageLink'])
    const newId = (await linkIn(a, pageId)) as string
    expect(newId).toBeTruthy()
    await expect
      .poll(() => wsEval(a, (s, ids) => ({ newPrivate: !!s.pages[ids.newId]?.private, parent: s.pages[ids.newId]?.parentId, title: s.pages[ids.newId]?.title, db: s.pages[ids.dbId]?.parentId, dbPrivate: !!s.pages[ids.dbId]?.private }), { newId, dbId }))
      .toEqual({ newPrivate: true, parent: pageId, title: 'Secret trip', db: newId, dbPrivate: true })
    await expect.poll(() => topTypes(a, newId), { timeout: 15_000 }).toEqual(['paragraph', 'databaseBlock', 'paragraph'])

    // the server keeps the new page's content under Ada's private name only
    await expect.poll(() => stored(`ws:${wsId}:u:${ada}:p:${newId}`).length, { timeout: 15_000 }).toBe(1)
    expect(stored(`ws:${wsId}:p:${newId}`)).toEqual([])
    await expect(a.getByTestId('private-section').locator('.sb-row__title', { hasText: 'My plans' })).toBeVisible()

    // Y undo: the blocks back, the database home again, the untouched page in the trash
    await a.keyboard.press(`${mod}+z`)
    await expect.poll(() => topTypes(a, pageId), { timeout: 15_000 }).toEqual(['paragraph', 'heading', 'paragraph', 'databaseBlock', 'paragraph'])
    await expect.poll(() => wsEval(a, (s, ids) => ({ db: s.pages[ids.dbId]?.parentId, trashed: !!s.pages[ids.newId]?.trashed }), { newId, dbId })).toEqual({ db: pageId, trashed: true })
  })

  test('a shared page: the new page is shared — a colleague sees it with its content', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Split shared')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    await openApp(a, wsId)
    await waitOnline(a)
    await openApp(b, wsId)
    await waitOnline(b)

    const pageId = await wsEval(a, (s) => s.createPage({ title: 'Team plans' }))
    await wsEval(a, (s, arg) => s.setContent(arg.pageId, arg.doc, 'import'), { pageId, doc: body('Offsite') })
    await gotoPage(a, pageId)
    const ed = editorOf(a, pageId)
    await expect(ed).toContainText('Offsite detail two.')
    await selectBlocks(ed, 'Offsite', 'Offsite detail two.')
    await a.keyboard.press(`${mod}+Alt+9`)
    await expect.poll(() => topTypes(a, pageId)).toEqual(['paragraph', 'pageLink'])
    const newId = (await linkIn(a, pageId)) as string
    expect(await wsEval(a, (s, id) => !!s.pages[id]?.private, newId)).toBe(false)

    // Bob: the page below "Team plans", with the two lines
    await expect.poll(() => wsEval(b, (s, id) => (s.pages[id] ? { title: s.pages[id].title, parent: s.pages[id].parentId } : null), newId), { timeout: 15_000 }).toEqual({ title: 'Offsite', parent: pageId })
    await gotoPage(b, newId)
    await expect(editorOf(b, newId)).toContainText('Offsite detail one.')
    await expect(editorOf(b, newId)).toContainText('Offsite detail two.')
    await b.context().close()
  })
})
