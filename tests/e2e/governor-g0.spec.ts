/**
 * Regler G0 in the store (store.ts hydrate / replaceAll / getWorkspaceSnapshot, io/backup.ts): Workspace.governor is
 * kept by every reader and written by nobody yet —
 *  - a store write (pages, settings, the look, the AI rules) leaves the governor's reference as it was;
 *  - another tab's save of something else keeps it (the same value keeps its reference); another tab's save OF the
 *    governor reaches this tab without a reload (replaceAll reads the stored meta — positive control);
 *  - a re-hydrate (what a workspace switch runs) takes the new workspace's value and never keeps the previous one;
 *  - full backups carry it, page backups never (nor the marker for a newer value this build keeps no copy of); a
 *    restore (replace or merge) keeps this workspace's — a backup's own value or none at all changes nothing.
 * The cloud side (a member reads an owner's value from the meta map, never writes it) is tests/e2e-cloud/governor-g0.spec.ts.
 * No AI host is reached. Every value is fictional.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect, openApp, reloadApp, flush, createPage, wsEval, gotoPage, pageIdByTitle, MOD } from './fixtures'
import { exportBackup, importBackup } from './helpers/backup'

type Gov = Record<string, unknown> | undefined
type Hook = { __one: { workspace: { setState: (x: object) => void; getState: () => Record<string, unknown> } }; __g0ref?: unknown }

const VALUE = { v: 1, autonomy: 'propose', day: 6, month: 120, updatedAt: 1760000000000, updatedBy: null }
const OTHER = { v: 1, day: 40, month: 900, updatedAt: 1760000500000, updatedBy: null }

const setGov = (p: Page, v: Gov) => p.evaluate((g) => (window as unknown as Hook).__one.workspace.setState({ governor: g }), v)
const govOf = (p: Page) => wsEval(p, (s) => JSON.parse(JSON.stringify(s.governor ?? null)) as Gov | null)
/** Remember the store's governor object (by reference) — and ask later whether it is still that very object. */
const keepRef = (p: Page) => p.evaluate(() => {
  const w = window as unknown as Hook
  w.__g0ref = w.__one.workspace.getState().governor
  return w.__g0ref !== undefined
})
const sameRef = (p: Page) => p.evaluate(() => {
  const w = window as unknown as Hook
  return w.__one.workspace.getState().governor === w.__g0ref
})

/** ⌘K → Export on a page: this page only, full backup → the parsed file. */
async function exportPageBackup(page: Page, testInfo: TestInfo, title: string) {
  await gotoPage(page, await pageIdByTitle(page, title))
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Full backup/ }).click()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  const file = testInfo.outputPath('page.json')
  await (await download).saveAs(file)
  await page.keyboard.press('Escape')
  return JSON.parse(readFileSync(file, 'utf8'))
}

test.describe('Workspace.governor in the store (G0)', () => {
  test('store writes leave it untouched; another tab’s save keeps it; another tab’s governor arrives without a reload', async ({ page }) => {
    await openApp(page)
    await setGov(page, VALUE)
    await flush(page)
    // positive control: the field is really there (sanitized, the same value)
    expect(await govOf(page)).toEqual(VALUE)
    expect(await keepRef(page)).toBe(true)

    // writes of every other kind: pages, settings, the look, the AI rules
    await createPage(page, { title: 'Quarterly plan' })
    await wsEval(page, (s) => {
      s.updateSettings({ workspaceName: 'Harbour Studio' })
      s.setLook({ preset: 'paper', corners: 'square' })
      s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: ['public', 'structure'] } }, restricted: [] } })
    })
    await flush(page)
    // (the writes landed)
    expect(await wsEval(page, (s) => [s.settings.workspaceName, s.look?.corners ?? null, !!s.ai?.policy?.providers?.openrouter])).toEqual(['Harbour Studio', 'square', true])
    expect(await sameRef(page)).toBe(true)
    expect(await govOf(page)).toEqual(VALUE)

    // another tab: reads it at boot, saves a page — this tab takes the page in and keeps its governor object
    const b = await page.context().newPage()
    await openApp(b)
    expect(await govOf(b)).toEqual(VALUE)
    await createPage(b, { title: 'Harbour notes' })
    await flush(b)
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((p) => p.title === 'Harbour notes'))).toBe(true)
    expect(await sameRef(page)).toBe(true)

    // positive control: the other tab's save OF the governor reaches this tab (replaceAll reads the stored meta)
    await setGov(b, OTHER)
    await flush(b)
    await expect.poll(() => govOf(page)).toEqual(OTHER)
    expect(await sameRef(page)).toBe(false)
    await b.close()

    // and a reload reads what is stored
    await reloadApp(page)
    expect(await govOf(page)).toEqual(OTHER)
  })

  test('a re-hydrate (a workspace switch) takes the new workspace’s governor — none stays none; the same value keeps its object', async ({ page }) => {
    await openApp(page)
    await setGov(page, VALUE)
    expect(await keepRef(page)).toBe(true)
    // the same workspace again (same value, new object): the reference stays
    await page.evaluate(() => {
      const s = (window as unknown as Hook).__one.workspace.getState() as Record<string, unknown> & { hydrate: (ws: object) => void }
      const snap = JSON.parse(JSON.stringify({ version: s.version, epoch: s.epoch, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations, governor: s.governor }))
      s.hydrate(snap)
    })
    expect(await sameRef(page)).toBe(true)
    expect(await govOf(page)).toEqual(VALUE)
    // another workspace without one: the previous workspace's governor never stays (absent key = undefined, not kept)
    await page.evaluate(() => {
      const s = (window as unknown as Hook).__one.workspace.getState() as Record<string, unknown> & { hydrate: (ws: object) => void }
      const snap = JSON.parse(JSON.stringify({ version: s.version, epoch: s.epoch, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations }))
      s.hydrate(snap)
    })
    expect(await govOf(page)).toBeNull()
    // one with a raw value: sanitized on the way in (an amount out of range clamped, an unknown detent dropped)
    await page.evaluate(() => {
      const s = (window as unknown as Hook).__one.workspace.getState() as Record<string, unknown> & { hydrate: (ws: object) => void }
      const snap = JSON.parse(JSON.stringify({ version: s.version, epoch: s.epoch, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations }))
      s.hydrate({ ...snap, governor: { v: 1, day: 20000, autonomy: 'turbo' } })
    })
    expect(await govOf(page)).toEqual({ v: 1, day: 10000 })
  })

  test('backups: full ones carry it, page ones never; a restore (replace or merge) keeps this workspace’s', async ({ page }, testInfo) => {
    await openApp(page)
    await setGov(page, VALUE)
    await flush(page)
    expect(await keepRef(page)).toBe(true)

    // full backup: carries it (positive control); page backup: never
    const { json } = await exportBackup(page, testInfo, 'full.json')
    expect(json.workspace.governor).toEqual(VALUE)
    expect((await exportPageBackup(page, testInfo, 'Welcome to One')).workspace.governor).toBeUndefined()

    // a backup with another governor, restored by replace: the workspace is the file's (a page proves it), the governor ours
    const other = JSON.parse(JSON.stringify(json))
    other.workspace.governor = OTHER
    const proof = Object.values(other.workspace.pages as Record<string, { title: string }>)[0]
    proof.title = 'Restored from the file'
    const otherFile = testInfo.outputPath('other.json')
    writeFileSync(otherFile, JSON.stringify(other))
    await importBackup(page, otherFile, 'replace')
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((p) => p.title === 'Restored from the file'))).toBe(true)
    expect(await govOf(page)).toEqual(VALUE)
    expect(await sameRef(page)).toBe(true)

    // a backup without any governor, replace: ours stays (a missing key never removes it)
    const none = JSON.parse(JSON.stringify(json))
    delete none.workspace.governor
    const noneFile = testInfo.outputPath('none.json')
    writeFileSync(noneFile, JSON.stringify(none))
    await importBackup(page, noneFile, 'replace')
    expect(await govOf(page)).toEqual(VALUE)

    // merge: the file's governor is never taken
    await importBackup(page, otherFile, 'merge')
    expect(await govOf(page)).toEqual(VALUE)
    expect(await sameRef(page)).toBe(true)
    await reloadApp(page)
    expect(await govOf(page)).toEqual(VALUE)

    // a newer value too large to keep a copy of: the store holds the marker — a full backup never carries it
    await setGov(page, { v: 3, blob: 'x'.repeat(70_000) })
    await flush(page)
    await reloadApp(page)
    expect(await govOf(page)).toEqual({ v: Number.MAX_SAFE_INTEGER, unreadable: true })
    const { json: marked } = await exportBackup(page, testInfo, 'marked.json')
    expect(marked.workspace.governor).toBeUndefined()
  })
})
