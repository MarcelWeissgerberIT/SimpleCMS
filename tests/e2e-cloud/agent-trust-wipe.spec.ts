/**
 * Per-field trust S1 in team workspaces: the verdict book is the signed-in member's (scope cloud:<id>:u:<account>);
 * removing a team workspace's copy from this browser takes that workspace's books with it (cloud/device.ts) and keeps
 * the local workspace's and another workspace's. Fictional names (Nordlicht, Tessera).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, waitForApp, waitOnline, cloudEval, cloudStatus, createWorkspace } from './fixtures'

const trust = <R>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(({ fn, args }) => (window as unknown as { __oneAgentTrust: Record<string, (...a: unknown[]) => unknown> }).__oneAgentTrust[fn](...args) as never, { fn, args }) as Promise<R>
const keys = (page: Page) => trust<string[]>(page, 'keys')
const accepts = (n: number) => ({ 'row:nl-db': Array.from({ length: n }, () => ({ v: 'accept' })) })

test.describe('per-field trust — team workspaces', () => {
  test('the book is the member’s; removing a team copy wipes its books, the local and another workspace’s stay', async ({ page: a }) => {
    await signIn(a, email('mara'))
    // the local workspace's book
    await openApp(a)
    await a.waitForFunction(() => !!(window as unknown as { __oneAgentTrust?: unknown }).__oneAgentTrust)
    expect(await trust(a, 'scope')).toBe('local:local')
    await trust(a, 'seed', 'nordlicht-spiegel', { entries: accepts(3) })

    // two team workspaces, a book in each (the member's scope)
    const keep = await createWorkspace(a, 'Tessera Bleibt')
    const gone = await createWorkspace(a, 'Tessera Geht')
    let uid = ''
    for (const ws of [keep, gone]) {
      await openApp(a, ws)
      await waitOnline(a)
      uid = await cloudEval(a, (c) => c.user.id as string)
      await a.waitForFunction(() => !!(window as unknown as { __oneAgentTrust?: unknown }).__oneAgentTrust)
      expect(await trust(a, 'scope')).toBe(`cloud:${ws}:u:${uid}`)
      await trust(a, 'seed', 'nordlicht-spiegel', { entries: accepts(2) })
    }
    const before = await keys(a)
    expect(before.filter((k) => k.startsWith(`trust|cloud:${gone}:u:${uid}|`)).length).toBeGreaterThan(0)
    expect(before.filter((k) => k.startsWith(`trust|cloud:${keep}:u:${uid}|`)).length).toBeGreaterThan(0)

    // Settings → Data → Remove copy (of the open one): back to the local workspace, the copy removed at that boot
    await a.keyboard.press('Control+,')
    const settings = a.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: /Data/ }).click()
    await settings.getByTestId('remove-copy').getByRole('button', { name: 'Remove copy' }).click()
    const confirm = a.getByRole('dialog').filter({ hasText: 'Remove the copy of' })
    await Promise.all([a.waitForEvent('load'), confirm.getByRole('button', { name: 'Remove copy' }).click()])
    await waitForApp(a)
    expect(await cloudStatus(a)).toBe('local')
    await a.waitForFunction(() => !!(window as unknown as { __oneAgentTrust?: unknown }).__oneAgentTrust)
    await expect.poll(async () => (await keys(a)).filter((k) => k.startsWith(`trust|cloud:${gone}:`))).toEqual([])
    const after = await keys(a)
    expect(after.filter((k) => k.startsWith(`trust|cloud:${keep}:u:${uid}|`)).length).toBeGreaterThan(0)
    expect(after.filter((k) => k.startsWith('trust|local:local|nordlicht-spiegel')).length).toBeGreaterThan(0)
  })
})
