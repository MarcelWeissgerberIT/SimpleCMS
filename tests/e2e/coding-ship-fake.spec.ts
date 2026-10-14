/**
 * The ship log against a worker played by the test (helpers/fakeWorker.ts — the protocol of features/coding/protocol.ts,
 * nothing else runs): an older worker's git stage keeps today's summary note; a 1.10.0 worker's ShipRecord becomes one
 * dated, linked note in the person's language (a failed push too — the commit stays recorded, nothing linked); the
 * PR / Commit field never loses a request's address to a commit link; hostile records are dropped (no link, no field
 * write); a Git key whose request failed after the push is an error toast and a note; the pipeline editor warns when
 * the worker has pushing / requests off for a repo; a gate marked "Always stop here" stops even with Approvals "None"
 * (new Review & merge pipelines have it on Approve review & merge; it joins the task version only while set); the
 * Approvals default for new tasks changes only with "Use for new tasks".
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { startFakeWorker, type FakeWorker, type Json } from './helpers/fakeWorker'

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47380

test.describe.configure({ mode: 'serial' })

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const SHA2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890'
const GL = { base: 'https://gitlab.example.test/nordlicht/website', forge: 'gitlab' }
const GH = { base: 'https://github.example.com/nordlicht/website', forge: 'github' }
const MR = `${GL.base}/-/merge_requests/42`
const BRANCH = 'one/fix-the-login-form-ab12cd'

const welcome = (repos: WorkerInfo['repos'] = [{ name: 'website', baseBranch: 'main' }]): WorkerInfo => ({ worker: '1.10.0', name: 'ship-box', repos, parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })

/** A stage's record as a 1.10.0 worker sends it: committed, pushed, merge request opened on GitLab. */
const rec = (over: Json = {}): Json => ({ action: 'pr', from: 'stage', at: Date.now(), branch: BRANCH, commit: { sha: SHA }, head: SHA, pushed: { remote: 'origin' }, request: { url: MR, how: 'opened' }, web: GL, ...over })

/** Every stage ok — a git stage with its record (pr · comment · merge), unless `git` says otherwise. */
function okOutcome(task: Json, git?: (task: Json) => Json): Json {
  switch (task.stage.kind) {
    case 'plan':
      return { status: 'ok', branch: BRANCH, plan: '1. Fix the login form.\n2. Run the checks.' }
    case 'implement':
      return { status: 'ok', branch: BRANCH, summary: 'Fixed the login form.' }
    case 'test':
      return { status: 'ok', branch: BRANCH, test: { ok: true, output: 'PASS all checks', ms: 12, code: 0 } }
    case 'doc':
      return { status: 'ok', branch: BRANCH, plan: 'The change is small and safe.' }
    case 'git': {
      if (git) return git(task)
      const a = task.stage.gitAction ?? 'pr'
      if (a === 'comment') return { status: 'ok', branch: BRANCH, url: MR, summary: 'Review posted.', ship: rec({ action: 'comment', commit: null, pushed: null, request: { url: MR, how: 'commented' } }) }
      if (a === 'merge') return { status: 'ok', branch: BRANCH, url: MR, summary: 'Merged.', ship: rec({ action: 'merge', commit: null, pushed: null, request: { url: MR, how: 'merged' } }) }
      return { status: 'ok', branch: BRANCH, url: MR, summary: 'Committed a1b2c3d4. Pushed to origin. Merge request opened.', ship: rec() }
    }
    default:
      return { status: 'ok' }
  }
}

/** Settings → Coding worker: the test port, switch on, connected. */
async function connect(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('ship-box')
  await page.keyboard.press('Escape')
}

async function newTask(page: Page, title: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill('Fix the login form: the button stays grey.')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

/** The task row's field by its role (the database's own names: English or German). */
const field = (page: Page, id: string, role: 'pr' | 'branch') =>
  wsEval(page, (s, a) => {
    const db = s.databases[s.pages[a.id].databaseId]
    const names = a.role === 'pr' ? ['PR / commit', 'PR / Commit'] : ['Branch']
    const p = db.properties.find((x: { name: string }) => names.includes(x.name))
    return (s.pages[a.id].properties[p.id] as string | undefined) ?? ''
  }, { id, role })

const setField = (page: Page, id: string, value: string) =>
  wsEval(page, (s, a) => {
    const db = s.databases[s.pages[a.id].databaseId]
    const p = db.properties.find((x: { name: string }) => x.name === 'PR / commit' || x.name === 'PR / Commit')
    s.setRowProperty(a.id, p.id, a.value || null)
  }, { id, value })

interface Note {
  label: string
  text: string
  links: string[][]
}

/** The page's notes (callouts): the label line, the rest as text, the linked text with its address. */
const notes = (page: Page, id: string): Promise<Note[]> =>
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

const pageJson = (page: Page, id: string) => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

test('an older worker (no "ship"): the git stage\'s summary goes into the page as before and PR / commit takes its address; #/coding offers the newer worker', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = WORKER_CAN.filter((c) => c !== 'ship')
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  const id = await newTask(page, 'Fix the login form')
  // the plan stage is handed out; the new task took this device's default ("None") as its own
  await expect.poll(() => fake!.handed().length, { timeout: 15_000 }).toBe(1)
  await expect(page.getByTestId('coding-approvals-select')).toHaveValue('none')
  fake.auto = (task) => okOutcome(task, () => ({ status: 'ok', branch: BRANCH, summary: 'Committed abcd1234. Pushed to origin/one/fix-the-login-form-ab12cd. Merge request opened.', url: MR }))
  await fake.finish(fake.handed()[0]!, okOutcome(fake.handed()[0]!))
  await expect(page.getByTestId('coding-state')).toContainText('Done', { timeout: 30_000 })
  const ns = await notes(page, id)
  const ship = ns.filter((n) => n.label.startsWith('Ship · '))
  expect(ship).toHaveLength(1)
  expect(ship[0]!.label).toMatch(/^Ship · \d{2}:\d{2}$/)
  expect(ship[0]!.text).toContain('Committed abcd1234.')
  expect(await field(page, id, 'pr')).toBe(MR)
  // #/coding: the plate offers the newer file (it lacks 'ship') — and says what it adds: this one skips no stage
  await page.evaluate(() => (window.location.hash = '#/coding'))
  const plate = page.getByTestId('coding-worker-outdated')
  await expect(plate).toContainText('A newer worker is on the site — it notes every commit, push and merge request in the task page, with links. This one runs every stage as before.')
  await expect(plate).not.toContainText('skips stages')
  // the Git tab of an older worker's snapshot (no web address): no "Find on the host" (its commits carry no trailer)
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await page.getByTestId('coding-tab-git').click()
  await expect(page.getByTestId('coding-git-trailer')).toHaveCount(0)
})

test('a failed push in German: the note "Ausliefern · <date>" records the commit, nothing linked, the task failed, PR / Commit untouched', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...WORKER_CAN]
  fake.auto = (task) => okOutcome(task, () => ({ status: 'failed', branch: BRANCH, error: 'git: push rejected', ship: rec({ pushed: null, request: null, failed: { step: 'push', code: 'pushRejected' } }) }))
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const id = await newTask(page, 'Login-Formular reparieren')
  await expect(page.getByTestId('coding-state')).toContainText('Fehlgeschlagen', { timeout: 30_000 })
  await expect.poll(async () => (await notes(page, id)).filter((n) => n.label.startsWith('Ausliefern · ')).length).toBe(1)
  const note = (await notes(page, id)).find((n) => n.label.startsWith('Ausliefern · '))!
  expect(note.label).toMatch(/^Ausliefern · \d{2}\.\d{2}\. \d{2}:\d{2}$/)
  expect(note.text).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · Push abgelehnt – der Branch dort hat neuere Commits`)
  // not on the remote: nothing is linked
  expect(note.links).toEqual([])
  expect(await field(page, id, 'pr')).toBe('')
  // the implement summary of an older-style stage stays a note of its own
  expect((await notes(page, id)).some((n) => n.text.includes('Fixed the login form.'))).toBe(true)
})

test('a record that says nothing (nothing new to commit, nothing pushed): no note — never the worker\'s English summary', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...WORKER_CAN]
  fake.auto = (task) => okOutcome(task, () => ({ status: 'ok', branch: BRANCH, summary: 'Nothing to commit.', ship: rec({ action: 'commit', commit: null, head: null, pushed: null, request: null }) }))
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  const id = await newTask(page, 'Nordlicht footer')
  await expect(page.getByTestId('coding-state')).toContainText('Done', { timeout: 30_000 })
  const ns = await notes(page, id)
  // the implement stage's summary is a note as ever; the git stage wrote none
  expect(ns.some((n) => n.text.includes('Fixed the login form.'))).toBe(true)
  expect(ns.some((n) => n.label.startsWith('Ship · '))).toBe(false)
  expect(ns.some((n) => n.text.includes('Nothing to commit.'))).toBe(false)
  expect(await field(page, id, 'pr')).toBe('')
})

test('PR / commit never loses a request to a commit link; hostile records are dropped; a Git key whose request failed after the push is an error and a note', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...WORKER_CAN]
  // every stage runs through; the git stage stays with the test
  fake.auto = (task) => (task.stage.kind === 'git' ? null : okOutcome(task))
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  const id = await newTask(page, 'Tessera export')
  await expect.poll(() => fake!.handed().filter((t) => t.stage.kind === 'git').length, { timeout: 30_000 }).toBe(1)
  const ship = fake.handed().find((t) => t.stage.kind === 'git')!
  /** an outcome of the Ship stage (failed: it stays there for the next one) */
  const send = async (record: Json) => {
    const before = (await notes(page, id)).length
    await fake!.finish(ship, { status: 'failed', branch: BRANCH, error: 'stopped by the test', ship: record })
    await expect.poll(async () => (await notes(page, id)).length).toBeGreaterThan(before)
    return (await notes(page, id)).at(-1)!
  }

  // the field holds a merge request: a pushed commit (the request failed) leaves it
  await setField(page, id, MR)
  let note = await send(rec({ request: null, failed: { step: 'request' } }))
  expect(note.text).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · MR could not be opened · pushed to origin/${BRANCH}`)
  expect(note.links).toEqual([
    [SHA.slice(0, 7), `${GL.base}/-/commit/${SHA}`],
    [BRANCH, `${GL.base}/-/tree/${BRANCH}`],
  ])
  expect(await field(page, id, 'pr')).toBe(MR)
  // an empty field: the pushed commit's link
  await setField(page, id, '')
  await send(rec({ request: null, failed: { step: 'request' } }))
  expect(await field(page, id, 'pr')).toBe(`${GL.base}/-/commit/${SHA}`)
  // an older commit link: the newer commit's
  await send(rec({ commit: { sha: SHA2 }, head: SHA2, request: null, failed: { step: 'request' } }))
  expect(await field(page, id, 'pr')).toBe(`${GL.base}/-/commit/${SHA2}`)
  // a link to create the request while the field holds an open one: kept
  await setField(page, id, MR)
  note = await send(rec({ request: { url: `${GL.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=one%2Fx`, how: 'link' } }))
  expect(note.text).toContain('create the MR')
  expect(await field(page, id, 'pr')).toBe(MR)

  // hostile records: the request is dropped, nothing evil is linked or written
  const hostile: Json[] = [
    rec({ pushed: null, request: { url: 'https://evil.example.com/nordlicht/website/-/merge_requests/1', how: 'opened' } }),
    rec({ pushed: null, request: { url: 'https://user:pw@gitlab.example.test/nordlicht/website/-/merge_requests/1', how: 'opened' } }),
    rec({ pushed: null, request: { url: `${GL.base}/-/merge_requests/1#/p/${id}`, how: 'opened' } }),
    rec({ pushed: null, web: { base: 'javascript:alert(1)//x/y', forge: 'gitlab' }, request: { url: 'javascript:alert(1)//x/y/1', how: 'opened' } }),
    rec({ pushed: null, request: null, commit: { sha: SHA.slice(1) }, head: SHA.slice(1), failed: { step: 'push' } }),
  ]
  for (const r of hostile) {
    note = await send(r)
    for (const [, href] of note.links) expect(href, JSON.stringify(r)).toMatch(/^https:\/\/gitlab\.example\.test\/nordlicht\/website\//)
    expect(await field(page, id, 'pr')).toBe(MR)
  }
  const json = await pageJson(page, id)
  for (const bad of ['evil.example.com', 'user:pw', '#/p/', 'javascript:']) expect(json).not.toContain(bad)
  // the 39-character sha is no commit
  expect(note.text).toBe(`Nothing new to commit · Branch ${BRANCH} · push failed`)

  // the Git tab: Push → the ship text as the toast, a note "Git (by hand)"; PR / commit keeps the request
  // the snapshot after an Update from base that merged commits pushed from elsewhere: by date the merge, a pushed commit
  // (newer), then one only here — the worker marks each; the Git tab links per commit, never by position
  const SHA3 = 'c3d4e5f60718293a4b5c6d7e8f90123456789012'
  const snapshot = {
    branch: BRANCH, base: 'origin/main', ahead: 3, behind: 0, pushed: true, unpushed: 2, dirty: 0, files: [], conflicts: [], created: true, merged: false, at: Date.now(), web: GL,
    commits: [
      { sha: SHA3, subject: 'Merge origin/one/fix-the-login-form-ab12cd', author: 'Nordlicht', at: Date.now(), remote: false },
      { sha: SHA2, subject: 'Apply suggestion', author: 'Tessera', at: Date.now() - 60_000, remote: true },
      { sha: SHA, subject: 'Fix the login form', author: 'Nordlicht', at: Date.now() - 120_000, remote: false },
    ],
  }
  fake.onGit = (req) =>
    req.verb === 'push'
      ? { message: `Pushed ${BRANCH} to origin.`, git: snapshot, ship: rec({ action: 'push', from: 'key', commit: null, head: SHA2, request: null }) }
      : req.verb === 'pr'
        ? { message: `Pushed ${BRANCH}. The pull request could not be opened: git: gh pr create failed: GraphQL: something`, error: 'git: gh pr create failed: GraphQL: something', ship: rec({ action: 'pr', from: 'key', commit: null, head: SHA2, request: null, web: GH, failed: { step: 'request' } }) }
        : new Error('not played')
  await page.getByTestId('coding-tab-git').click()
  await page.getByTestId('coding-git').getByRole('button', { name: 'Push', exact: true }).click()
  await expect(page.locator('.toast').filter({ hasText: `At ${SHA2.slice(0, 7)} · Branch ${BRANCH} · pushed to origin/${BRANCH}` })).toBeVisible()
  await expect.poll(async () => (await notes(page, id)).at(-1)?.label ?? '').toMatch(/^Git \(by hand\) · \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/)
  note = (await notes(page, id)).at(-1)!
  expect(note.text).toBe(`At ${SHA2.slice(0, 7)} · Branch ${BRANCH} · pushed to origin/${BRANCH}`)
  expect(note.links[0]).toEqual([SHA2.slice(0, 7), `${GL.base}/-/commit/${SHA2}`])
  expect(await field(page, id, 'pr')).toBe(MR)
  // the Git tab: only the commit the worker marked pushed is a link (the second of three — by position it would not be)
  const commitLinks = page.getByTestId('coding-git-commit-link')
  await expect(commitLinks).toHaveCount(1)
  await expect(commitLinks).toHaveAttribute('href', `${GL.base}/-/commit/${SHA2}`)
  // "Find on the host": the task's own trailer line, with a copy key
  await expect(page.getByTestId('coding-git-trailer')).toContainText(`One-Task: ${id}`)
  await expect(page.getByTestId('coding-git-trailer-copy')).toHaveAttribute('aria-label', `Copy One-Task: ${id}`)
  // the request group opens the merge request — never a commit the field holds without one
  await expect(page.getByTestId('coding-git-request-link')).toHaveAttribute('href', MR)
  await setField(page, id, `${GL.base}/-/commit/${SHA2}`)
  await expect(page.getByTestId('coding-git-request-link')).toHaveCount(0)
  await setField(page, id, MR)
  await expect(page.getByTestId('coding-git-request-link')).toHaveAttribute('href', MR)
  // Open PR: pushed, the request failed — an error toast, and the push recorded
  const count = (await notes(page, id)).length
  await page.getByTestId('coding-git').getByRole('button', { name: 'Open PR' }).click()
  // what was shipped in the person's words, then gh's own
  await expect(page.locator('.toast').filter({ hasText: `PR could not be opened · pushed to origin/${BRANCH} — git: gh pr create failed: GraphQL: something` })).toBeVisible()
  await expect.poll(async () => (await notes(page, id)).length).toBe(count + 1)
  note = (await notes(page, id)).at(-1)!
  expect(note.label).toMatch(/^Git \(by hand\) · /)
  expect(note.text).toBe(`At ${SHA2.slice(0, 7)} · Branch ${BRANCH} · PR could not be opened · pushed to origin/${BRANCH}`)
  expect(await field(page, id, 'pr')).toBe(MR)
  expect(fake.gitAsked.map((g) => g.verb)).toEqual(['push', 'pr'])
})

test('the pipeline editor warns when the worker has pushing or requests off for a repo of the project — never with an older worker\'s welcome', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome([
    { name: 'website', baseBranch: 'main', push: false, pr: 'gh' },
    { name: 'tessera', baseBranch: 'main', push: true, pr: 'none' },
  ]))
  fake.can = [...WORKER_CAN]
  await openApp(page)
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup').click()
  await page.getByTestId('coding-pipeline-open').click()
  const row = (name: string) => page.locator('.cpe-row').filter({ has: page.locator(`input.cpe-name[value="${name}"]`) })
  await expect(row('Ship').getByTestId('coding-pipeline-warn-chip')).toHaveText('Off in worker')
  await expect(page.getByTestId('coding-pipeline-warn-chip')).toHaveCount(1)
  await row('Ship').getByRole('button', { name: 'Stage details' }).click()
  const warn = row('Ship').getByTestId('coding-pipeline-warn')
  await expect(warn).toContainText('website: pushing is off in the worker — this stage only commits there.')
  await expect(warn).toContainText('tessera: pull / merge requests are off in the worker — this stage pushes there and leaves a link to create the request.')
  await expect(warn.getByTestId('coding-change-repos')).toBeVisible()
  // Review & merge: posting the review and merging fail where requests are off — and where pushing is off (nothing was
  // pushed, so there is no request)
  await page.getByTestId('coding-template-reviewmerge').click()
  for (const name of ['Post review', 'Merge']) {
    await expect(row(name).getByTestId('coding-pipeline-warn-chip')).toBeVisible()
    await row(name).getByRole('button', { name: 'Stage details' }).click()
    await expect(row(name).getByTestId('coding-pipeline-warn')).toContainText('tessera: pull / merge requests are off in the worker — this stage fails there.')
    await expect(row(name).getByTestId('coding-pipeline-warn')).toContainText('website: pushing is off in the worker — nothing is pushed there, so there is no merge request to review or merge: this stage fails there.')
    await row(name).getByRole('button', { name: 'Stage details' }).click()
  }
  // the warning never blocks Save
  await expect(page.getByTestId('coding-pipeline-save')).toBeEnabled()
  // a welcome without the flags (an older worker): no warning at all
  await page.evaluate(() => {
    type Store = { getState: () => { worker: { repos: unknown[] } | null }; setState: (p: unknown) => void }
    const coding = (window as unknown as { __onePreflight: { stores: { coding: Store } } }).__onePreflight.stores.coding
    const w = coding.getState().worker!
    coding.setState({ worker: { ...w, repos: [{ name: 'website', baseBranch: 'main' }, { name: 'tessera', baseBranch: 'main' }] } })
  })
  await expect(page.getByTestId('coding-pipeline-warn-chip')).toHaveCount(0)
  await expect(page.getByTestId('coding-pipeline-warn')).toHaveCount(0)
})

test('"Always stop here": a new Review & merge pipeline holds at Approve review & merge even with Approvals "None"; the switch in the editor; the version changes only while it is set', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...WORKER_CAN]
  fake.auto = (task) => okOutcome(task)
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-setup-reviewmerge').click()
  const holds = () =>
    wsEval(page, (s) => {
      const db = Object.values(s.databases).find((x: any) => x.system === 'coding') as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const stage = db.properties.find((p: { name: string }) => p.name === 'Stage')
      return (db.pipeline as Array<{ id: string; hold?: boolean }>).filter((p) => p.hold).map((p) => stage.options.find((o: { id: string }) => o.id === p.id)?.name)
    })
  expect(await holds()).toEqual(['Approve review & merge'])

  const id = await newTask(page, 'Launch plan checklist')
  await expect(page.locator('.ctk-code')).toContainText(/· Approve review & merge$/i, { timeout: 45_000 })
  await expect(page.getByTestId('coding-approvals-holds')).toHaveText('Always stops at: Approve review & merge.')
  await page.getByTestId('coding-tab-log').click()
  await expect(page.getByTestId('coding-log')).toContainText('No approval needed: on past “Approve plan”.')
  await expect(page.getByTestId('coding-log')).toContainText('“Approve review & merge” always stops — waiting for you.')
  // the timeline marks the gate
  await expect(page.locator('.ctk-stop[data-hold]')).toHaveAttribute('title', 'Always stops')
  // shipped on the way: the note with links, PR / commit = the merge request
  expect((await notes(page, id)).some((n) => n.label.startsWith('Ship · ') && n.text.includes('MR !42'))).toBe(true)
  expect(await field(page, id, 'pr')).toBe(MR)
  // Approve: the review is posted, the request merged → Done (each a note)
  await page.getByTestId('coding-approve').click()
  await expect(page.getByTestId('coding-state')).toContainText('Done', { timeout: 30_000 })
  const labels = (await notes(page, id)).map((n) => n.label.split(' · ')[0])
  expect(labels).toEqual(expect.arrayContaining(['Ship', 'Post review', 'Merge']))
  expect((await notes(page, id)).find((n) => n.label.startsWith('Merge · '))!.text).toBe(`Branch ${BRANCH} · MR !42 merged`)

  // the editor: "Always stop here" on Approve plan → the chip, stored, and the version takes it only while set
  const version = () => page.evaluate((id) => (window as unknown as { __oneTrust: { version: (id: string) => Promise<string> } }).__oneTrust.version(id), id)
  const v0 = await version()
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-pipeline-open').click()
  const row = (name: string) => page.locator('.cpe-row').filter({ has: page.locator(`input.cpe-name[value="${name}"]`) })
  await expect(row('Approve review & merge').getByTestId('coding-pipeline-hold-chip')).toHaveText('Always stops')
  await expect(row('Approve plan').getByTestId('coding-pipeline-hold-chip')).toHaveCount(0)
  await row('Approve plan').getByRole('button', { name: 'Stage details' }).click()
  const hold = row('Approve plan').getByRole('switch', { name: 'Always stop here' })
  await expect(hold).toHaveAttribute('aria-checked', 'false')
  await expect(row('Approve plan').getByTestId('coding-pipeline-hold')).toContainText('The task waits here even with Approvals “None”.')
  await hold.click()
  await expect(row('Approve plan').getByTestId('coding-pipeline-hold-chip')).toBeVisible()
  await page.getByTestId('coding-pipeline-save').click()
  await expect.poll(holds).toEqual(['Approve plan', 'Approve review & merge'])
  const v1 = await version()
  expect(v1).not.toBe(v0)
  // off again: the very same version as before
  await page.getByTestId('coding-pipeline-open').click()
  await row('Approve plan').getByRole('button', { name: 'Stage details' }).click()
  await row('Approve plan').getByRole('switch', { name: 'Always stop here' }).click()
  await page.getByTestId('coding-pipeline-save').click()
  await expect.poll(holds).toEqual(['Approve review & merge'])
  expect(await version()).toBe(v0)
  // a gate turned into a queue loses it
  await page.getByTestId('coding-pipeline-open').click()
  await row('Approve review & merge').getByLabel('Kind').selectOption('queue')
  await expect(row('Approve review & merge').getByTestId('coding-pipeline-hold-chip')).toHaveCount(0)
  await page.getByTestId('coding-pipeline-save').click()
  await expect.poll(holds).toEqual([])
  // nothing is added on read: after a reload the stored pipeline is the same
  await reloadApp(page)
  expect(await holds()).toEqual([])
})

test('Approvals: a task\'s pick never changes the default for new tasks — only "Use for new tasks" does, and it changes no existing task', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'review'))
  await reloadApp(page)
  const select = page.getByTestId('coding-approvals-select')
  const stored = () => page.evaluate(() => localStorage.getItem('one.coding.approvals'))
  const a = await newTask(page, 'Nordlicht header')
  // a row added outside New task (the board's "+ New", an agent, another device): no pick of its own
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const addRow = (title: string) =>
    wsEval(
      page,
      (s, title) => {
        const db = Object.values(s.databases).find((x: any) => x.system === 'coding') as any
        const prop = (n: string) => db.properties.find((p: any) => p.name === n)
        const ready = prop('Stage').options.find((o: any) => o.name === 'Ready').id
        return s.createRow(db.id, { title, properties: { [prop('Stage').id]: ready } }) as string
      },
      title,
    )
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const row = await addRow('Tessera board row')
  await expect(select).toHaveValue('review')
  await expect(page.getByTestId('coding-approvals-default')).toHaveCount(0)
  await select.selectOption('none')
  expect(await stored()).toBe('review')
  await expect(page.getByTestId('coding-approvals-default')).toHaveText('Use for new tasks')
  // another task keeps its own (the default it was made with)
  const b = await newTask(page, 'Tessera footer')
  await expect(select).toHaveValue('review')
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), a)
  await expect(select).toHaveValue('none')
  // by keyboard: the key goes away, focus stays on the select (never the page's main region)
  await page.getByTestId('coding-approvals-default').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast').filter({ hasText: 'Now the default for new tasks on this device.' })).toBeVisible()
  expect(await stored()).toBe('none')
  await expect(page.getByTestId('coding-approvals-default')).toHaveCount(0)
  await expect(select).toBeFocused()
  // the row without a pick keeps the default it was made under ("review") — the new default changes no existing task
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  await expect(select).toHaveValue('review')
  // a row added now takes the new default
  const later = await addRow('Launch plan board row')
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), later)
  await expect(select).toHaveValue('none')
  // after a reload too (the history of defaults is this device's, in localStorage)
  await reloadApp(page)
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  await expect(select).toHaveValue('review')
  // a task made now takes it; the earlier one keeps its own
  await newTask(page, 'Launch plan')
  await expect(select).toHaveValue('none')
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), b)
  await expect(select).toHaveValue('review')
  await expect(page.getByTestId('coding-approvals-default')).toBeVisible()
})
