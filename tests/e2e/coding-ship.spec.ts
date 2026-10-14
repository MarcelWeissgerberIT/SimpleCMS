/**
 * The ship log with the BUILT worker (public/mcp/one-worker.mjs, 1.10.0) and the fake Claude Code CLI: a repo whose
 * remote is a GitLab project (its fetch URL is never contacted — git's ssh is `false`; pushes go to the local bare
 * repo) and a fake glab. A task with Approvals "None" ships by itself: the page gets the note "Ship · <date>" with
 * Commit · Branch · MR !42 · pushed, each linked to the GitLab project; PR / commit = the merge request; the commit on
 * the remote ends with "One-Task: <task id>"; the Git tab links the commits and the branch. The Push key writes its
 * own note ("Git (by hand)") and never replaces the request's address. A task a custom agent wrote, confirmed once,
 * runs to Done: every note is written inside keepTrust — the version stays trusted.
 */
import { delimiter } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { FAKE_MR, asGitLab, fakeGlab, makeCodingRepo, startCodingWorker, type CodingRepo, type RunningWorker } from './helpers/coding'

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47390
const GL = 'https://gitlab.example.test/nordlicht/website'

test.describe.configure({ mode: 'serial' })

let repo: CodingRepo
let worker: RunningWorker | null = null
let glab: ReturnType<typeof fakeGlab>

test.beforeAll(() => {
  repo = makeCodingRepo()
  asGitLab(repo)
  glab = fakeGlab(repo)
})
test.afterEach(async () => {
  await worker?.stop()
  worker = null
})
test.afterAll(() => repo?.cleanup())

/** Settings → Coding worker: start the worker (requests through glab), the test port, switch on, connected. */
async function connect(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
  const id = /--workspace (\S+)/.exec(init ?? '')![1]!
  worker = await startCodingWorker(
    repo,
    id,
    PORT,
    { repos: [{ name: 'website', path: repo.path, baseBranch: 'main', testCommand: [process.execPath, 'check.mjs'], pr: 'gh', maxUsdPerTask: 5 }] },
    { PATH: `${glab.bin}${delimiter}${process.env.PATH ?? ''}`, GIT_SSH_COMMAND: 'false', ONE_WORKER_FETCH_MS: '5000' },
  )
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('Connected · e2e-box · 1 repo')
  await page.keyboard.press('Escape')
}

const field = (page: Page, id: string, name: string) =>
  wsEval(page, (s, a) => {
    const db = s.databases[s.pages[a.id].databaseId]
    const p = db.properties.find((x: { name: string }) => x.name === a.name)
    return (s.pages[a.id].properties[p.id] as string | undefined) ?? ''
  }, { id, name })

/** The page's notes (callouts): the label line, the rest as text, the linked text with its address. */
const notes = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    type N = { type?: string; text?: string; content?: N[]; marks?: Array<{ type: string; attrs?: { href?: string } }> }
    const flat = (n: N): N[] => (n.type === 'text' ? [n] : (n.content ?? []).flatMap(flat))
    return ((s.pages[id].content?.content ?? []) as N[])
      .filter((b) => b.type === 'callout')
      .map((b) => {
        const [head, ...rest] = b.content ?? []
        const nodes = rest.flatMap(flat)
        return {
          label: flat(head ?? {}).map((n) => n.text).join(''),
          text: nodes.map((n) => n.text).join(''),
          links: nodes.filter((n) => n.marks?.some((m) => m.type === 'link')).map((n) => [n.text ?? '', n.marks!.find((m) => m.type === 'link')!.attrs?.href ?? '']),
        }
      })
  }, id)

test('a task ships by itself: the note with links to GitLab, PR / commit = the merge request, "One-Task" on the remote commit; the Push key writes its own note and keeps the request', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Fix the login form')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Write feature.txt with the title.')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  const id = await page.evaluate(() => window.location.hash.replace('#/p/', ''))
  // the new task took this device's default as its own
  await expect(page.getByTestId('coding-approvals-select')).toHaveValue('none')
  await expect(page.getByTestId('coding-state')).toContainText('Done', { timeout: 90_000 })

  const branch = await field(page, id, 'Branch')
  expect(branch).toMatch(/^one\/fix-the-login-form-[a-z0-9]{6}$/)
  const sha = repo.git(repo.remote, 'rev-parse', branch).trim()
  // the commit on the remote: its message ends with the task's trailer
  expect(repo.git(repo.remote, 'log', '-1', '--format=%B', branch).trim()).toMatch(new RegExp(`\\n\\nOne-Task: ${id}$`))
  expect(repo.git(repo.remote, 'log', '-1', '--format=%s', branch).trim()).toBe('Fix the login form')
  // glab opened one merge request, its description with the trailer
  const create = glab.calls().filter((c) => c[0] === 'mr' && c[1] === 'create')
  expect(create).toHaveLength(1)
  expect(create[0]!.join(' ')).toContain(`One-Task: ${id}`)

  // the page: one ship note, dated, in the owner's order, each part linked
  await expect.poll(async () => (await notes(page, id)).filter((n) => n.label.startsWith('Ship · ')).length).toBe(1)
  const ship = (await notes(page, id)).find((n) => n.label.startsWith('Ship · '))!
  expect(ship.label).toMatch(/^Ship · \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/)
  expect(ship.text).toBe(`Commit ${sha.slice(0, 7)} · Branch ${branch} · MR !42 · pushed to origin/${branch}`)
  expect(ship.links).toEqual([
    [sha.slice(0, 7), `${GL}/-/commit/${sha}`],
    [branch, `${GL}/-/tree/${branch}`],
    ['MR !42', FAKE_MR],
  ])
  expect(await field(page, id, 'PR / commit')).toBe(FAKE_MR)
  // never a local path in the page
  expect(JSON.stringify(await wsEval(page, (s, id) => s.pages[id].content, id))).not.toContain(repo.root)

  // the Git tab: the commit and the branch link to the project
  await page.getByTestId('coding-tab-git').click()
  await expect(page.getByTestId('coding-git-branch-link')).toHaveAttribute('href', `${GL}/-/tree/${branch}`)
  await expect(page.getByTestId('coding-git-commit-link').first()).toHaveAttribute('href', `${GL}/-/commit/${sha}`)
  // every commit is pushed: each one is a link; the task's trailer line to search for
  await expect(page.getByTestId('coding-git').locator('.cg-commits li')).toHaveCount(await page.getByTestId('coding-git-commit-link').count())
  await expect(page.getByTestId('coding-git-trailer')).toContainText(`One-Task: ${id}`)

  // Push (nothing new): the toast says it in words, a note "Git (by hand)", the request's address stays
  await page.getByTestId('coding-git').getByRole('button', { name: 'Push', exact: true }).click()
  const line = `At ${sha.slice(0, 7)} · Branch ${branch} · pushed to origin/${branch}`
  await expect(page.locator('.toast').filter({ hasText: line })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await notes(page, id)).at(-1)?.label ?? '').toMatch(/^Git \(by hand\) · /)
  const key = (await notes(page, id)).at(-1)!
  expect(key.text).toBe(line)
  expect(key.links[0]).toEqual([sha.slice(0, 7), `${GL}/-/commit/${sha}`])
  expect(await field(page, id, 'PR / commit')).toBe(FAKE_MR)
  // the log said it in codes: the request opened (an MR)
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText(`Merge request opened: ${FAKE_MR}`)
})

test('a task a custom agent wrote, confirmed once, runs to Done: the ship note and PR / commit keep it trusted', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const id = await wsEval(page, (s) => {
    const db = Object.values(s.databases).find((x: any) => x.system === 'coding') as any
    const prop = (n: string) => db.properties.find((p: any) => p.name === n)
    const repoOpt = (prop('Repo').options ?? []).find((o: any) => o.name === 'website')?.id ?? 'opt-website'
    if (!(prop('Repo').options ?? []).some((o: any) => o.id === repoOpt)) s.updateProperty(db.id, prop('Repo').id, { options: [...(prop('Repo').options ?? []), { id: repoOpt, name: 'website', color: 'blue' }] })
    const ready = prop('Stage').options.find((o: any) => o.name === 'Ready').id
    const id = s.createRow(db.id, { title: 'Tessera checkout fix', properties: { [prop('Repo').id]: repoOpt, [prop('Stage').id]: ready } })
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write feature.txt with the title.' }] }] }, 'ai')
    s.updatePage(id, { createdBy: 'agent:a1', updatedBy: 'agent:a1' })
    return id as string
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  const box = page.locator('.ctk-box--trust')
  await box.getByRole('button', { name: 'Confirm on this device' }).click()
  await expect(box).toBeHidden()
  await expect(page.getByTestId('coding-state')).toContainText('Done', { timeout: 90_000 })
  await expect(page.getByTestId('coding-panel')).toHaveAttribute('data-trust', 'yes')
  // every stage ran — nothing waited for Confirm again after a note was written
  await expect(page.locator('.ctk-box--trust')).toHaveCount(0)
  await expect.poll(async () => (await notes(page, id)).some((n) => n.label.startsWith('Ship · ') && n.text.includes('MR !42'))).toBe(true)
  expect(worker!.log()).toContain(`task ${id} `)
})
