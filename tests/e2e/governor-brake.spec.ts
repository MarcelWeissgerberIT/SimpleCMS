/**
 * The Regler's brake in the browser (design § 15, governor-brake): built up slice by slice.
 *  - case 14 (B1) — ONE generation stamp: a budget stamps Workspace.ai.gen = GEN.budget in the same update as the
 *    setter; a rule edit, a backup restore bringing gen-2 rules, a replaceAll and another tab's save keep it; this
 *    browser's own line stamps the device layer; removing the budget lowers the stamp. The DEV / ?e2e invariant never
 *    fires on these paths — and does fire on a raw write that skips the stamp (positive control).
 * No AI host is reached (the aiNet guard); values are fictional (Nordlicht, Tessera, Launch plan).
 */
import type { Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test, expect, openApp, reloadApp, wsEval, flush, createPage } from './fixtures'
import { exportBackup, importBackup } from './helpers/backup'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = { __one: { workspace: { setState: (x: object) => void } } }

const BUDGET = { v: 1, day: 6, month: 120 }
const CLAUDE_NARROW = { policy: { providers: { anthropic: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace'] } }, restricted: [] } }

const genOf = (p: Page) => wsEval(p, (s) => (s.ai?.gen ?? null) as number | null)
const devGenOf = (p: Page) => wsEval(p, (s) => (s.settings.ai?.gen ?? null) as number | null)
const setGovernor = (p: Page, v: object | null) => wsEval(p, (s, g) => s.setGovernor(g) as { ok: boolean; why?: string }, v)
/** The AI rules' setters (store/aiRules.ts through the ?e2e seam — each as the spec's own write). */
const rules = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    async ([fn, args]) => {
      const m = (await (window as unknown as { __oneAI: { rules(): Promise<Record<string, (...a: unknown[]) => unknown>> } }).__oneAI.rules()) as Record<string, (...a: unknown[]) => unknown>
      return m[fn as string](...(args as unknown[]))
    },
    [fn, args] as const,
  )

test.describe('case 14 — one generation stamp (B1)', () => {
  test('a budget stamps GEN.budget; rule edits, a restore with gen-2 rules, replaceAll and another tab keep it; removing it lowers it', async ({ page }, testInfo) => {
    await openApp(page)
    await createPage(page, { title: 'Launch plan' })
    expect(await genOf(page)).toBeNull()

    // the setter: the budget and the stamp in one update
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(3)
    expect(await wsEval(page, (s) => ({ day: s.governor.day, month: s.governor.month, by: s.governor.updatedBy ?? null, at: typeof s.governor.updatedAt }))).toEqual({ day: 6, month: 120, by: null, at: 'number' })
    // the same value again is no change (the stamps stay as they were)
    const at = await wsEval(page, (s) => s.governor.updatedAt as number)
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await wsEval(page, (s) => s.governor.updatedAt as number)).toBe(at)

    // a Claude rule edit needs 2 by itself — the budget's 3 stays
    expect(await rules(page, 'setWorkspaceAI', CLAUDE_NARROW)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(3)

    // replaceAll handing in gen-2 rules (what a restore / another tab's save does): restamped to 3 in the same update
    await wsEval(page, (s) => {
      const snap = JSON.parse(JSON.stringify({ version: s.version, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, integrations: s.integrations, governor: s.governor }))
      s.replaceAll({ ...snap, ai: { ...JSON.parse(JSON.stringify(s.ai)), gen: 2 } })
    })
    expect(await genOf(page)).toBe(3)

    // a full backup whose rules carry gen 2 and loosen ours (taken on the person's answer): the stamp stays 3
    await flush(page)
    const { json } = await exportBackup(page, testInfo, 'full.json')
    const file = JSON.parse(JSON.stringify(json))
    file.workspace.ai = { policy: { providers: { anthropic: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people'] } }, restricted: [] }, gen: 2 }
    const path = testInfo.outputPath('gen2.json')
    writeFileSync(path, JSON.stringify(file))
    await importBackup(page, path, 'merge', 'take')
    await expect.poll(() => wsEval(page, (s) => (s.ai?.policy?.providers?.anthropic?.allow ?? []).includes('people'))).toBe(true)
    expect(await genOf(page)).toBe(3)

    // another tab: loads it stamped; its own save keeps it here
    await flush(page)
    const b = await page.context().newPage()
    await openApp(b)
    expect(await genOf(b)).toBe(3)
    await createPage(b, { title: 'Tessera notes' })
    await flush(b)
    await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).some((p) => p.title === 'Tessera notes'))).toBe(true)
    expect(await genOf(page)).toBe(3)
    await b.close()

    // removed: the stamp follows what is stored now — the rules' own 2 (Claude still may not receive transcripts)
    expect(await setGovernor(page, null)).toEqual({ ok: true })
    expect(await genOf(page)).toBe(2)
    // and with Claude's rule gone, none at all
    expect(await rules(page, 'setWorkspaceAI', null)).toEqual({ ok: true })
    expect(await genOf(page)).toBeNull()
    await flush(page)
    await reloadApp(page)
    expect(await genOf(page)).toBeNull()
    expect(await wsEval(page, (s) => s.governor ?? null)).toBeNull()
  })

  test('this browser’s own line stamps the device layer; removing it lowers the stamp; a load stamps a line set elsewhere', async ({ page }) => {
    await openApp(page)
    expect(await devGenOf(page)).toBeNull()
    // the line (localStorage — Settings › KI writes it through writeDeviceLimit) + the store's device stamp
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 8, at: 1760000000000 })))
    await wsEval(page, (s) => s.stampDeviceGen())
    expect(await devGenOf(page)).toBe(3)
    // a device rule edit keeps it
    expect(await rules(page, 'setDeviceAI', { narrow: { anthropic: ['people'] } })).toBe(true)
    expect(await devGenOf(page)).toBe(3)
    expect(await rules(page, 'setDeviceAI', { narrow: undefined })).toBe(true)
    expect(await devGenOf(page)).toBe(3)
    // removed: none left (no device rule either) — and the key itself goes from the stored settings
    await page.evaluate(() => localStorage.removeItem('one.governor.device'))
    await wsEval(page, (s) => s.stampDeviceGen())
    expect(await devGenOf(page)).toBeNull()
    expect(await wsEval(page, (s) => 'ai' in s.settings)).toBe(false)
    await flush(page)
    await reloadApp(page)
    expect(await devGenOf(page)).toBeNull()
    // a line set while this workspace was closed (another workspace's tab): the next load stamps it
    await page.evaluate(() => localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, month: 40, at: 1760000000000 })))
    await reloadApp(page)
    expect(await devGenOf(page)).toBe(3)
    await page.evaluate(() => localStorage.removeItem('one.governor.device'))
  })

  test('the invariant: a raw write that skips the stamp is a console error (positive control); the setter never trips it', async ({ page, errors }) => {
    await openApp(page)
    const seen: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('[governor]')) seen.push(m.text())
    })
    expect(await setGovernor(page, BUDGET)).toEqual({ ok: true })
    expect(await setGovernor(page, { v: 1, day: 3 })).toEqual({ ok: true })
    expect(await setGovernor(page, null)).toEqual({ ok: true })
    await page.waitForTimeout(100)
    expect(seen).toEqual([])
    // positive control: the governor written around the setter, the stamp left as it was
    errors.allow(/\[governor\] ai\.gen below the governor's generation/)
    await page.evaluate((g) => (window as unknown as Hook).__one.workspace.setState({ governor: g }), BUDGET)
    await expect.poll(() => seen.length).toBe(1)
    expect(seen[0]).toContain("ai.gen below the governor's generation")
  })
})
