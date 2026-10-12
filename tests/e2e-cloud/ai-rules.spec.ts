/**
 * The AI rules in a team workspace (multi-provider S2, stage B, against the real server): owners and admins write the
 * workspace's rules (meta map `workspace`, key `ai`), every member's tab reads them; a member's setter refuses, a value
 * put into a member's store is put back by the server; while the server cannot guard Claude's rules ('providers' not in
 * /api/config `supports`), an owner's Claude entry stays as it was (the OpenRouter entry of the same write lands); a
 * member never sees "Take the backup's"; a team-private page is a member class (refused for a route without it). The
 * server guard itself is covered by server/test/workspace-ai.test.ts. Every AI host is mocked or never called.
 */
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, wsEval, createWorkspace, join } from './fixtures'
import { fileURLToPath } from 'node:url'
import { exportBackup } from '../e2e/helpers/backup'
import { capsOfRow, readCatalogRow } from '../../src/shared/ai/catalog'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const WORK = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace']
const MARKED = ['public', 'structure', 'selection']

const CATALOGUE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/openrouter-models.json', import.meta.url)), 'utf8')) as { data: unknown[] }
const LUNA_ROW = (() => {
  const r = readCatalogRow(CATALOGUE.data.find((x) => (x as { id: string }).id === 'openai/gpt-6-luna'), '2026-10-12')!
  return { m: r.id, label: r.label, price: r.price, caps: capsOfRow(r), at: '2026-10-12' }
})()

const rulesOf = (p: Page) => wsEval(p, (s) => JSON.parse(JSON.stringify(s.ai?.policy?.providers ?? null)))
const gateSays = (page: Page, input: AnyState) => page.evaluate((i) => (window as unknown as { __oneAI: { precheck(i: unknown): AnyState } }).__oneAI.precheck(i), input)

test('owners write the rules, members read them; a member cannot write them; Claude’s entry waits for a server that guards it', async ({ page, context }) => {
  await signIn(page, email('ada'))
  const wsId = await createWorkspace(page, 'Rules Team')
  const member = await newPerson(context)
  await signIn(member, email('mo'))
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(member, wsId)
  await waitOnline(member)
  // the server announces what it guards
  expect(await page.evaluate(() => (window as unknown as { __one: { cloud: { useCloud: { getState(): AnyState } } } }).__one.cloud.useCloud.getState().supports ?? [])).toContain('ai')

  // the owner's write: OpenRouter's entry lands; Claude's is kept as it was (none) while the server lacks 'providers'
  const res = await wsEval(page, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a.work }, anthropic: { allow: a.marked } }, restricted: [] } }), { work: WORK, marked: MARKED })
  expect(res).toEqual({ ok: true, claudeKept: true })
  expect(await rulesOf(page)).toEqual({ openrouter: { allow: WORK } })
  expect(await wsEval(page, (s) => s.ai?.gen ?? null)).toBeNull()

  // the member's tab reads them
  await expect.poll(() => rulesOf(member)).toEqual({ openrouter: { allow: WORK } })
  // the member's setter refuses …
  expect(await wsEval(member, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a } }, restricted: [] } }), [...WORK, 'people'])).toEqual({ ok: false })
  // … and a value put into the member's store directly is put back by the server, never reaching the owner
  await member.evaluate((all) => (window as unknown as { __one: { workspace: { setState: (p: object) => void } } }).__one.workspace.setState({ ai: { policy: { providers: { openrouter: { allow: all } }, restricted: [] } } }), [...WORK, 'people', 'transcript'])
  await expect.poll(() => rulesOf(member)).toEqual({ openrouter: { allow: WORK } })
  await page.waitForTimeout(500)
  expect(await rulesOf(page)).toEqual({ openrouter: { allow: WORK } })

  // positive control: the owner's next OpenRouter change reaches the member
  await wsEval(page, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a } }, restricted: [] } }), MARKED)
  await expect.poll(() => rulesOf(member)).toEqual({ openrouter: { allow: MARKED } })
  await member.context().close()
})

test('a team-private page is the member’s own: a route without "private" on this device is refused; with it, it may go', async ({ page }) => {
  await signIn(page, email('ida'))
  const wsId = await createWorkspace(page, 'Private Rules')
  await openApp(page, wsId)
  await waitOnline(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000' } }))
  await wsEval(page, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a } }, restricted: [] } }), WORK)
  const pageId = await page.evaluate(() => (window as unknown as { __one: { cloud: { createPrivatePage(o: object): Promise<string> } } }).__one.cloud.createPrivatePage({ title: 'Secret plan' }))
  const route = { p: 'openrouter', m: 'openai/gpt-6-luna' }
  await wsEval(page, (s, row) => s.updateSettings({ ai: { ...(s.settings.ai ?? {}), models: [row] } }), LUNA_ROW)
  // a selection inside it: the page's member class goes along — refused, the fix names the class
  expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: pageId, as: 'selection' }], route })).toMatchObject({ ok: false, code: 'policy', detail: 'private', fix: { kind: 'step', step: 'data', data: 'private' } })
  // a workspace allow never opens it; this device's opt-in does
  await wsEval(page, (s) => s.updateSettings({ ai: { ...s.settings.ai, allow: { openrouter: ['private'] } } }))
  expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: pageId, as: 'selection' }], route })).toMatchObject({ ok: true, route: 'openrouter:openai/gpt-6-luna' })
  // positive control: Claude without rules sees everything
  expect(await gateSays(page, { purpose: 'menu.action', sources: [{ page: pageId, as: 'selection' }], route: { p: 'anthropic', m: 'claude-opus-5-5' } })).toMatchObject({ ok: true, sees: 'all' })
})

test('a member restoring a backup whose rules would loosen the workspace’s: the panel offers "Keep mine" only', async ({ page, context }, testInfo) => {
  await signIn(page, email('lu'))
  const wsId = await createWorkspace(page, 'Backup Rules')
  const member = await newPerson(context)
  await signIn(member, email('ole'))
  await join(page, member, wsId, 'member')
  await openApp(page, wsId)
  await waitOnline(page)
  await wsEval(page, (s, a) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow: a, forbid: ['mail'] } }, restricted: [] } }), MARKED)
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => rulesOf(member)).toEqual({ openrouter: { allow: MARKED, forbid: ['mail'] } })
  // the owner's full backup (of a workspace with a page in it), its rules loosened
  await wsEval(page, (s) => s.createPage({ title: 'Launch plan', parentId: null }))
  const { file, json } = await exportBackup(page, testInfo, 'team.json')
  json.workspace.ai = { policy: { providers: { openrouter: { allow: [...MARKED, 'page'] } }, restricted: [] } }
  writeFileSync(file, JSON.stringify(json))
  await member.locator('.sb').getByRole('button', { name: /^Import/ }).click()
  const dialog = member.getByRole('dialog')
  const chooser = member.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(readFileSync(file)) }])
  await dialog.getByRole('radio', { name: /Merge into this workspace/ }).click()
  await dialog.getByRole('button', { name: 'Merge backup' }).click()
  const panel = dialog.getByTestId('backup-ai-loosen')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Keep mine' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Take the backup’s' })).toHaveCount(0)
  await expect(panel).toContainText('Only owners and admins change the AI rules')
  await panel.getByRole('button', { name: 'Keep mine' }).click()
  await expect(dialog.getByText(/Backup merged/).first()).toBeVisible()
  await member.waitForTimeout(500)
  expect(await rulesOf(page)).toEqual({ openrouter: { allow: MARKED, forbid: ['mail'] } })
  await member.context().close()
})
