/**
 * Folder + GitHub sync (features/sync).
 *
 * Folder: the origin private file system (navigator.storage.getDirectory()) stands in for a picked
 * folder — the app's test hook (window.__oneSync.connect) takes a directory handle without the picker.
 * GitHub: api.github.com is mocked with an in-memory repository (never the real API).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page, Route } from '@playwright/test'
import { test, expect, openApp, wsEval, pageIdByTitle, MOD } from './fixtures'

declare global {
  interface Window {
    // the sync service's test hook (features/sync/service.ts, dev or ?e2e)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneSync: any
  }
}

// headless Chromium stores OPFS names through the process locale: without UTF-8 "€" or "—" fail
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } })

const DIR = 'one-sync-e2e'

/* ------------------------------------------------------------------ */
/* Folder helpers (run in the page, against OPFS)                      */
/* ------------------------------------------------------------------ */

async function connectFolder(page: Page) {
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(name, { create: true })
    await window.__oneSync.connect(dir)
  }, DIR)
}

/** path → { text, mtime } of every file below the synced folder (hidden folders included). */
async function listFolder(page: Page): Promise<Record<string, { text: string; mtime: number }>> {
  // the app may be moving files while we look: read again until a listing completes
  for (let i = 0; ; i++) {
    try {
      return await readFolder(page)
    } catch (e) {
      if (i > 5 || !/NotFoundError/.test(String(e))) throw e
      await page.waitForTimeout(100)
    }
  }
}

async function readFolder(page: Page): Promise<Record<string, { text: string; mtime: number }>> {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(name, { create: true })
    const out: Record<string, { text: string; mtime: number }> = {}
    const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
      for await (const h of (d as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`)
        else {
          const f = await (h as FileSystemFileHandle).getFile()
          out[`${prefix}${h.name}`] = { text: /\.(md|csv)$/.test(h.name) ? await f.text() : `<${f.size} bytes>`, mtime: f.lastModified }
        }
      }
    }
    await walk(dir, '')
    return out
  }, DIR)
}

async function writeExternal(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ name, path, text }) => {
      const root = await navigator.storage.getDirectory()
      let d = await root.getDirectoryHandle(name, { create: true })
      const segs = path.split('/')
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true })
      const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable()
      await w.write(text)
      await w.close()
    },
    { name: DIR, path, text },
  )
}

async function removeExternal(page: Page, path: string) {
  await page.evaluate(
    async ({ name, path }) => {
      const root = await navigator.storage.getDirectory()
      let d = await root.getDirectoryHandle(name)
      const segs = path.split('/')
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s)
      await d.removeEntry(segs[segs.length - 1])
    },
    { name: DIR, path },
  )
}

const files = async (page: Page) => Object.keys(await listFolder(page))
const fileText = async (page: Page, path: string) => (await listFolder(page))[path]?.text ?? null

async function openSyncTab(page: Page) {
  await page.keyboard.press(`${MOD}+,`)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: /Sync$/ }).click()
  return dialog
}

/* ------------------------------------------------------------------ */
/* Folder                                                              */
/* ------------------------------------------------------------------ */

test.describe('sync to a folder', () => {
  test('first sync writes the tree: front matter, rows, CSV, attachments', async ({ page }) => {
    await openApp(page)
    // a page with an attachment (onefile: ref → _files/)
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const ref = await window.__one.files.saveFile(new Blob([bytes], { type: 'image/png' }), 'pixel.png')
      const s = window.__one.workspace.getState()
      const id = s.createPage({ title: 'Moodboard' })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One pixel:' }] }, { type: 'image', attrs: { src: ref, alt: 'pixel' } }] }, 'e2e')
    }, pixel)

    await connectFolder(page)
    const tree = await listFolder(page)
    const paths = Object.keys(tree)
    for (const p of ['Welcome to One.md', 'Team wiki.md', 'Team wiki/Brand voice.md', 'Projects/_database.md', 'Projects/_rows.csv', 'Projects/Website relaunch.md', 'Moodboard.md', '_files/pixel.png']) {
      expect(paths, p).toContain(p)
    }

    // page: front matter + H1 + body with relative links
    const wiki = tree['Team wiki.md'].text
    const wikiId = await pageIdByTitle(page, 'Team wiki')
    expect(wiki).toMatch(new RegExp(`^---\\nid: ${wikiId}\\ntitle: Team wiki\\nicon: asset:binder\\ncreated: \\d{4}-\\d\\d-\\d\\dT[\\d:]+Z\\nupdated: `))
    expect(wiki).toContain('\n# Team wiki\n')
    expect(wiki).toContain('[Brand voice](Team%20wiki/Brand%20voice.md)')

    // row: properties as friendly values
    const row = tree['Projects/Website relaunch.md'].text
    expect(row).toContain('title: Website relaunch')
    expect(row).toContain('Status: In progress')
    expect(row).toContain('Tags: [Web, Marketing]')
    expect(row).toContain('Owner: [Alex]')
    // the seed dates are relative to today: compare with the row's own value
    const due = await page.evaluate(() => {
      type Row = { title: string; databaseId: string | null; properties: Record<string, unknown> }
      const s = window.__one.workspace.getState() as unknown as { pages: Record<string, Row>; databases: Record<string, { properties: { id: string; name: string }[] }> }
      const relaunch = Object.values(s.pages).find((p) => p.title === 'Website relaunch' && p.databaseId)!
      const prop = s.databases[relaunch.databaseId!].properties.find((d) => d.name === 'Timeline')!
      return relaunch.properties[prop.id] as { start: string; end: string | null }
    })
    expect(due.end, 'the seeded timeline is a range').toBeTruthy()
    expect(row).toContain(`Timeline: ${due.start} → ${due.end}`)

    // database: schema + views + rows, and the rows as CSV
    expect(tree['Projects/_database.md'].text).toContain('| Status | status | Backlog · In progress · Review · Done |')
    expect(tree['Projects/_database.md'].text).toContain('- [Website relaunch](Website%20relaunch.md)')
    expect(tree['Projects/_rows.csv'].text).toMatch(/^\uFEFF?Project,Status,Priority/)
    expect(tree['Projects/_rows.csv'].text).toContain('Website relaunch,In progress,High')

    // attachment: written once, linked relatively
    expect(tree['_files/pixel.png'].text).toMatch(/^<\d+ bytes>$/)
    expect(tree['Moodboard.md'].text).toContain('![pixel](_files/pixel.png)')

    // the settings panel reports it
    const dialog = await openSyncTab(page)
    const panel = dialog.locator('.sy-panel').first()
    await expect(panel.locator('.sy-panel__state')).toContainText('Synced')
    await expect(panel.locator('.sy-readout')).toContainText(DIR)
    await expect(dialog.locator('.sy-log__row').first()).toContainText(/Wrote \d+/)
    await page.keyboard.press('Escape')
    // and the status bar shows the sync; it opens Settings → Sync
    await expect(page.locator('.status .sy-status')).toContainText(/Sync · \d\d:\d\d/)
    await page.locator('.status .sy-status').click()
    await expect(page.getByRole('dialog').getByRole('tab', { name: /Sync$/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('an edit rewrites only that file; renames, moves and the trash move files', async ({ page }) => {
    await openApp(page)
    await connectFolder(page)
    // let the open editor settle (its first normalising write touches the page), then start from a synced folder
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.__oneSync.sync())
    const before = await listFolder(page)
    const voice = await pageIdByTitle(page, 'Brand voice')

    await page.waitForTimeout(20) // distinct mtimes
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited in One 4711' }] }] }, 'e2e'), voice)
    await expect.poll(() => fileText(page, 'Team wiki/Brand voice.md'), { timeout: 10_000 }).toContain('Edited in One 4711')
    const after = await listFolder(page)
    const changed = Object.keys(after).filter((p) => !before[p] || before[p].mtime !== after[p].mtime)
    expect(changed).toEqual(['Team wiki/Brand voice.md'])

    // rename: the file moves, links in other files follow
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Voice and tone' }), voice)
    await expect.poll(() => files(page), { timeout: 10_000 }).toContain('Team wiki/Voice and tone.md')
    expect(await files(page)).not.toContain('Team wiki/Brand voice.md')
    expect(await fileText(page, 'Team wiki.md')).toContain('[Voice and tone](Team%20wiki/Voice%20and%20tone.md)')

    // move to the top level
    const glossary = await pageIdByTitle(page, 'Glossary')
    await wsEval(page, (s, id) => s.movePage(id, null), glossary)
    await expect.poll(() => files(page), { timeout: 10_000 }).toContain('Glossary.md')
    expect(await files(page)).not.toContain('Team wiki/Glossary.md')

    // trash → .trash/
    const onboarding = await pageIdByTitle(page, 'Onboarding')
    await wsEval(page, (s, id) => s.trashPage(id), onboarding)
    await expect.poll(() => files(page), { timeout: 10_000 }).toContain('.trash/Onboarding.md')
    expect(await files(page)).not.toContain('Team wiki/Onboarding.md')
  })

  test('edits made in the folder are picked up; both sides changed → conflict copy', async ({ page }) => {
    await openApp(page)
    await connectFolder(page)
    const voice = await pageIdByTitle(page, 'Brand voice')
    const original = (await fileText(page, 'Team wiki/Brand voice.md'))!
    const firstBlock = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content.content[0]), voice)

    // edit the body + a title in the H1, as an editor would
    const edited = original.replace('# Brand voice', '# Brand voice & tone').trimEnd() + '\n\nWritten in VS Code 0815.\n'
    await writeExternal(page, 'Team wiki/Brand voice.md', edited)
    await page.evaluate(() => window.__oneSync.pickup())
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, voice)).toContain('Written in VS Code 0815')
    expect(await wsEval(page, (s, id) => s.pages[id].title, voice)).toBe('Brand voice & tone')
    expect(await wsEval(page, (s, id) => s.pages[id].contentOrigin, voice)).toBe('file')
    // blocks the file left alone are still One's own (attributes Markdown can't carry included)
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content.content[0]), voice)).toBe(firstBlock)

    // a page with blocks Markdown can't carry (a button with actions, columns …): an edit elsewhere keeps them
    const notes = await pageIdByTitle(page, 'Weekly sync — notes')
    const richBefore = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content.content), notes)
    expect(richBefore).toContain('"actions":[{')
    const notesFile = (await fileText(page, 'Weekly sync — notes.md'))!
    await writeExternal(page, 'Weekly sync — notes.md', notesFile.trimEnd() + '\n\nOne more line from the folder.\n')
    await page.evaluate(() => window.__oneSync.pickup())
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, notes)).toContain('One more line from the folder.')
    const richAfter = await wsEval(page, (s, id) => s.pages[id].content.content.map((n: unknown) => JSON.stringify(n)), notes)
    expect(JSON.stringify(richAfter.slice(0, -1).map((x: string) => JSON.parse(x)))).toBe(richBefore)

    // a row property edited in the front matter
    const row = (await fileText(page, 'Projects/Website relaunch.md'))!
    await writeExternal(page, 'Projects/Website relaunch.md', row.replace('Status: In progress', 'Status: Done').replace('Budget: 18000', 'Budget: 20000'))
    await page.evaluate(() => window.__oneSync.pickup())
    const relaunch = await pageIdByTitle(page, 'Website relaunch')
    const props = await wsEval(
      page,
      (s, id) => {
        const db = s.databases[s.pages[id].databaseId]
        const prop = (name: string) => db.properties.find((p: { name: string }) => p.name === name)
        const status = prop('Status')
        return { status: status.options.find((o: { id: string }) => o.id === s.pages[id].properties[status.id])?.name, budget: s.pages[id].properties[prop('Budget').id] }
      },
      relaunch,
    )
    expect(props).toEqual({ status: 'Done', budget: 20000 })

    // conflict: the file and the page change before One writes again
    const now = (await fileText(page, 'Team wiki/Brand voice & tone.md')) ?? (await fileText(page, 'Team wiki/Brand voice.md'))!
    const path = (await files(page)).find((p) => p.startsWith('Team wiki/Brand voice'))!
    await writeExternal(page, path, now.trimEnd() + '\n\nFolder side 1111.\n')
    await page.evaluate((id) => {
      const s = window.__one.workspace.getState()
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One side 2222' }] }] }, 'e2e')
      return window.__oneSync.pickup()
    }, voice)
    await expect.poll(async () => (await files(page)).filter((p) => /\(conflict \d{4}-\d\d-\d\d \d\d-\d\d\)\.md$/.test(p)).length).toBe(1)
    const tree = await listFolder(page)
    const copy = Object.keys(tree).find((p) => p.includes('(conflict'))!
    expect(tree[copy].text).toContain('Folder side 1111')
    expect(await wsEval(page, (s, id) => s.pages[id].plain, voice)).toBe('One side 2222')
    await expect.poll(() => fileText(page, path)).toContain('One side 2222')
    await expect(page.locator('.toast').filter({ hasText: 'Edited on both sides' })).toBeVisible()
    // a conflict copy never becomes a page
    expect(await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((p) => p.title.includes('conflict')))).toBe(false)
  })

  test('a new .md becomes a page (a row in a database folder); a deleted file asks first', async ({ page }) => {
    await openApp(page)
    await connectFolder(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')

    await writeExternal(page, 'Team wiki/Fresh idea.md', '# Fresh idea\n\nHello from the folder 2468.\n\n- one\n- two\n')
    await writeExternal(page, 'Projects/From the folder.md', '---\nStatus: Review\nTags: [AI, Ops]\n---\n# From the folder\n\nA row written by hand.\n')
    await page.evaluate(() => window.__oneSync.pickup())

    const idea = await pageIdByTitle(page, 'Fresh idea')
    expect(await wsEval(page, (s, id) => ({ parent: s.pages[id].parentId, plain: s.pages[id].plain }), idea)).toEqual({ parent: wiki, plain: expect.stringContaining('Hello from the folder 2468') })
    // the file now carries the page's id
    await expect.poll(() => fileText(page, 'Team wiki/Fresh idea.md')).toContain(`id: ${idea}`)

    const row = await pageIdByTitle(page, 'From the folder')
    const r = await wsEval(
      page,
      (s, id) => {
        const p = s.pages[id]
        const db = s.databases[p.databaseId]
        const prop = (name: string) => db.properties.find((x: { name: string }) => x.name === name)
        const name = (propName: string, v: string) => prop(propName).options.find((o: { id: string }) => o.id === v)?.name
        return { db: s.pages[p.databaseId].title, status: name('Status', p.properties[prop('Status').id]), tags: (p.properties[prop('Tags').id] as string[]).map((v) => name('Tags', v)) }
      },
      row,
    )
    expect(r).toEqual({ db: 'Projects', status: 'Review', tags: ['AI', 'Ops'] })

    // a file deleted outside One: the page stays until the person decides
    const glossary = await pageIdByTitle(page, 'Glossary')
    await removeExternal(page, 'Team wiki/Glossary.md')
    await page.evaluate(() => window.__oneSync.pickup())
    expect(await wsEval(page, (s, id) => s.pages[id].trashed, glossary)).toBe(false)
    await expect(page.locator('.toast').filter({ hasText: '1 file deleted outside One' })).toBeVisible()
    const dialog = await openSyncTab(page)
    const notice = dialog.locator('.sy-missing')
    await expect(notice).toContainText('Team wiki/Glossary.md')
    await notice.getByRole('button', { name: 'Move pages to trash' }).click()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].trashed, glossary)).toBe(true)
    await expect.poll(() => files(page), { timeout: 10_000 }).toContain('.trash/Glossary.md')
  })
})

/* ------------------------------------------------------------------ */
/* GitHub (mocked)                                                     */
/* ------------------------------------------------------------------ */

const gitSha = (data: Buffer) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex')
const randomSha = () => createHash('sha1').update(String(Math.random())).digest('hex')

interface MockRepo {
  head: string
  commits: Map<string, { tree: string; parents: string[]; message: string }>
  trees: Map<string, Map<string, string>>
  blobs: Map<string, Buffer>
  calls: Array<{ method: string; path: string; body?: any }> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** answer the next ref update with this status (once) */
  failRefOnce?: number
  /** every request gets this status */
  failAll?: number
}

function newRepo(): MockRepo {
  const readme = Buffer.from('# my notes\n')
  const blob = gitSha(readme)
  const tree = randomSha()
  const commit = randomSha()
  return {
    head: commit,
    commits: new Map([[commit, { tree, parents: [], message: 'init' }]]),
    trees: new Map([[tree, new Map([['README.md', blob]])]]),
    blobs: new Map([[blob, readme]]),
    calls: [],
  }
}

/** Commit files straight into the mock repository (someone pushing from elsewhere). */
function commitRemote(repo: MockRepo, files: Record<string, string>) {
  const tree = new Map(repo.trees.get(repo.commits.get(repo.head)!.tree)!)
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const sha = gitSha(data)
    repo.blobs.set(sha, data)
    tree.set(path, sha)
  }
  const treeSha = randomSha()
  repo.trees.set(treeSha, tree)
  const commit = randomSha()
  repo.commits.set(commit, { tree: treeSha, parents: [repo.head], message: 'remote edit' })
  repo.head = commit
}

async function mockGitHub(page: Page, repo: MockRepo) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE' }
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/repos\/me\/notes/, '')
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined
    repo.calls.push({ method: req.method(), path, body })
    if (repo.failAll) return json(route, repo.failAll, { message: 'Bad credentials' })
    if (!req.headers()['authorization']?.startsWith('Bearer ')) return json(route, 401, { message: 'Requires authentication' })
    const m = (re: RegExp) => path.match(re)
    if (req.method() === 'GET' && path === '') return json(route, 200, { full_name: 'me/notes', default_branch: 'main', private: true, permissions: { push: true } })
    if (req.method() === 'GET' && m(/^\/git\/ref\/heads\/main$/)) return json(route, 200, { object: { sha: repo.head } })
    let hit = m(/^\/git\/commits\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], tree: { sha: repo.commits.get(hit[1])!.tree } })
    hit = m(/^\/git\/trees\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], truncated: false, tree: [...repo.trees.get(hit[1])!].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) })
    hit = m(/^\/git\/blobs\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], encoding: 'base64', content: repo.blobs.get(hit[1])!.toString('base64') })
    if (req.method() === 'POST' && path === '/git/blobs') {
      const data = Buffer.from(body.content, 'base64')
      const sha = gitSha(data)
      repo.blobs.set(sha, data)
      return json(route, 201, { sha })
    }
    if (req.method() === 'POST' && path === '/git/trees') {
      const tree = new Map(repo.trees.get(body.base_tree)!)
      for (const e of body.tree as Array<{ path: string; sha?: string | null; content?: string }>) {
        if (e.content !== undefined) {
          const data = Buffer.from(e.content, 'utf8')
          const sha = gitSha(data)
          repo.blobs.set(sha, data)
          tree.set(e.path, sha)
        } else if (e.sha === null) tree.delete(e.path)
        else tree.set(e.path, e.sha!)
      }
      const sha = randomSha()
      repo.trees.set(sha, tree)
      return json(route, 201, { sha })
    }
    if (req.method() === 'POST' && path === '/git/commits') {
      const sha = randomSha()
      repo.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message })
      return json(route, 201, { sha })
    }
    if (req.method() === 'PATCH' && path === '/git/refs/heads/main') {
      if (repo.failRefOnce) {
        const status = repo.failRefOnce
        repo.failRefOnce = undefined
        // someone else pushed meanwhile
        commitRemote(repo, { 'elsewhere.txt': 'pushed from another machine\n' })
        return json(route, status, { message: 'Reference update failed' })
      }
      const parent = repo.commits.get(body.sha)?.parents[0]
      if (parent !== repo.head) return json(route, 422, { message: 'Update is not a fast forward' })
      repo.head = body.sha
      return json(route, 200, { object: { sha: body.sha } })
    }
    return json(route, 404, { message: 'Not Found' })
  })
}

const remoteFiles = (repo: MockRepo) => repo.trees.get(repo.commits.get(repo.head)!.tree)!
const remoteText = (repo: MockRepo, path: string) => {
  const sha = remoteFiles(repo).get(path)
  return sha ? repo.blobs.get(sha)!.toString('utf8') : null
}

const TOKEN = 'github_pat_E2E_SECRET_TOKEN_0042'

async function setUpGitHub(page: Page) {
  const dialog = await openSyncTab(page)
  const gh = dialog.locator('.sy-panel').nth(1)
  await gh.getByLabel('Repository', { exact: true }).fill('me/notes')
  await gh.getByLabel('Folder in the repository').fill('one')
  await gh.getByLabel('Access token').fill(TOKEN)
  await gh.getByRole('button', { name: 'Test connection' }).click()
  return { dialog, gh }
}

test.describe('sync to GitHub', () => {
  test('push commits only changed files (blobs → tree → commit → ref); pull imports a changed file', async ({ page }) => {
    const repo = newRepo()
    await mockGitHub(page, repo)
    await openApp(page)
    const { gh } = await setUpGitHub(page)
    await expect(gh.getByText('Connected · me/notes')).toBeVisible()

    // first push: everything, in one commit under the folder "one/"
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => repo.commits.get(repo.head)!.message).toMatch(/^One sync/)
    await expect(gh.locator('.sy-panel__state')).toContainText('Up to date')
    const files = remoteFiles(repo)
    expect(files.get('README.md')).toBeTruthy()
    expect([...files.keys()]).toContain('one/Team wiki/Brand voice.md')
    expect([...files.keys()]).toContain('one/Projects/_rows.csv')
    const first = repo.commits.get(repo.head)!
    expect(first.message).toMatch(/^One sync · \d+ pages$/)
    // the blob ids One computed are the ones git computes (CSV with BOM included)
    expect(remoteText(repo, 'one/Projects/_rows.csv')!.charCodeAt(0)).toBe(0xfeff)
    expect(repo.calls.filter((c) => c.method === 'PATCH').length).toBe(1)

    // one page changes (and an attachment is added): only those go up
    await page.evaluate(async () => {
      const s = window.__one.workspace.getState()
      const id = Object.values(s.pages as Record<string, { id: string; title: string }>).find((p) => p.title === 'Brand voice')!.id
      const ref = await window.__one.files.saveFile(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' }), 'data.bin')
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pushed change 5150' }] }, { type: 'fileBlock', attrs: { src: ref, name: 'data.bin', size: 4 } }] }, 'e2e')
    })
    await expect(gh.locator('.sy-readout')).toContainText(/Pending\s*2/, { timeout: 10_000 })
    repo.calls.length = 0
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => repo.calls.filter((c) => c.method === 'PATCH').length).toBe(1)
    await expect(gh.locator('.sy-panel__state')).toContainText('Up to date')
    const blobs = repo.calls.filter((c) => c.method === 'POST' && c.path === '/git/blobs')
    expect(blobs.length).toBe(1) // the attachment; text travels inline in the tree
    const treeCall = repo.calls.find((c) => c.method === 'POST' && c.path === '/git/trees')!
    expect(treeCall.body.tree.map((e: { path: string }) => e.path).sort()).toEqual(['one/Team wiki/Brand voice.md', 'one/_files/data.bin'])
    expect(repo.commits.get(repo.head)!.message).toBe('One sync · 1 page')
    expect(remoteText(repo, 'one/Team wiki/Brand voice.md')).toContain('Pushed change 5150')
    expect(remoteText(repo, 'one/Team wiki/Brand voice.md')).toContain('[📎 data.bin](../_files/data.bin)')

    // pull: a file edited on GitHub comes back into the page
    const text = remoteText(repo, 'one/Team wiki/Brand voice.md')!
    commitRemote(repo, { 'one/Team wiki/Brand voice.md': text.replace('Pushed change 5150', 'Edited on github.com 6060') })
    await gh.getByRole('button', { name: 'Pull' }).click()
    const voice = await pageIdByTitle(page, 'Brand voice')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, voice)).toContain('Edited on github.com 6060')
    // the attachment block survived (the file block's line was unchanged)
    expect(await wsEval(page, (s, id) => s.pages[id].content.content.map((n: { type: string }) => n.type), voice)).toEqual(['paragraph', 'fileBlock'])
    // nothing to push afterwards: the repository already has that version
    repo.calls.length = 0
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect(page.locator('.toast').filter({ hasText: 'GitHub is up to date' })).toBeVisible()
    expect(repo.calls.some((c) => c.method === 'POST' && c.path === '/git/commits')).toBe(false)
  })

  test('the branch moved during a push: fetch and retry once', async ({ page, errors }) => {
    errors.allow(/status of 409/)
    const repo = newRepo()
    await mockGitHub(page, repo)
    await openApp(page)
    const { gh } = await setUpGitHub(page)
    await expect(gh.getByText('Connected · me/notes')).toBeVisible()
    repo.failRefOnce = 409
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => repo.calls.filter((c) => c.method === 'PATCH').length).toBe(2)
    await expect(gh.locator('.sy-panel__state')).toContainText('Up to date')
    expect(repo.calls.filter((c) => c.method === 'POST' && c.path === '/git/commits').length).toBe(2)
    // the retry is based on the moved branch: the other machine's file is still there
    expect(remoteText(repo, 'elsewhere.txt')).toBe('pushed from another machine\n')
    expect(remoteText(repo, 'one/Team wiki.md')).toContain('# Team wiki')
  })

  test('private pages of a team workspace stay out of the repository unless opted in', async ({ page }) => {
    const repo = newRepo()
    await mockGitHub(page, repo)
    await openApp(page)
    const { gh } = await setUpGitHub(page)
    await expect(gh.getByText('Connected · me/notes')).toBeVisible()
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => remoteText(repo, 'one/Team wiki/Brand voice.md')).toContain('Brand voice')

    // the cloud binding marks pages of the member's private documents (Page.private) — stand in for it here
    const voice = await pageIdByTitle(page, 'Brand voice')
    await page.evaluate((id) => window.__one.workspace.setState((st: { pages: Record<string, { private?: true }> }) => void (st.pages[id].private = true)), voice)
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => remoteText(repo, 'one/Team wiki/Brand voice.md')).toBeNull()
    expect(remoteText(repo, 'one/Team wiki.md')).toContain('# Team wiki')

    // opting in brings it back
    await page.evaluate(() => (window as unknown as { __oneSync: { github: (p: { includePrivate: boolean }) => Promise<void> } }).__oneSync.github({ includePrivate: true }))
    await gh.getByRole('button', { name: 'Push now' }).click()
    await expect.poll(() => remoteText(repo, 'one/Team wiki/Brand voice.md')).toContain('Brand voice')
  })

  test('a rejected token shows the error state', async ({ page, errors }) => {
    errors.allow(/status of 401/)
    const repo = newRepo()
    repo.failAll = 401
    await mockGitHub(page, repo)
    await openApp(page)
    const { gh } = await setUpGitHub(page)
    await expect(gh.getByRole('alert')).toContainText('GitHub rejected the token (401)')
    await expect(gh.locator('.sy-panel__state')).toContainText('Error')
    await expect(page.locator('.status .sy-status')).toContainText('Sync error')
  })

  test('the token never leaves this browser: not in the workspace, backups or share links', async ({ page }, testInfo) => {
    const repo = newRepo()
    await mockGitHub(page, repo)
    await openApp(page)
    const { gh } = await setUpGitHub(page)
    await expect(gh.getByText('Connected · me/notes')).toBeVisible()
    await page.keyboard.press('Escape')

    expect(JSON.stringify(await wsEval(page, (s) => ({ pages: s.pages, databases: s.databases, settings: s.settings, people: s.people })))).not.toContain(TOKEN)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(TOKEN)

    // full JSON backup
    await page.keyboard.press(`${MOD}+,`)
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /Data$/ }).click()
    await dialog.getByRole('button', { name: 'Export workspace' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Full backup/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('backup.json')
    await (await download).saveAs(file)
    const backup = readFileSync(file, 'utf8')
    expect(backup).toContain('Brand voice')
    expect(backup).not.toContain(TOKEN)
    expect(backup).not.toContain('E2E_SECRET')
    await page.keyboard.press('Escape')

    // share link of a page
    const id = await pageIdByTitle(page, 'Brand voice')
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    expect(link).toContain('#/s/')
    expect(link).not.toContain(TOKEN)
    // what went to GitHub carries no token either
    for (const data of repo.blobs.values()) expect(data.toString('utf8')).not.toContain(TOKEN)
  })
})

test('the sync tab works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  await connectFolder(page)
  await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: /Sync$/ }).click()
  await expect(dialog.locator('.sy-panel').first()).toBeVisible()
  // no horizontal overflow inside the dialog body
  const overflow = await dialog.locator('.st__body').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
