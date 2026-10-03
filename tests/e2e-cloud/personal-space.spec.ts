/**
 * Everyone has a workspace of their own (docs/CLOUD.md § Tenancy & encryption at rest): a new person
 * who signs in lands in it — no "create a workspace" step — and the switcher lists it first. A browser
 * that already chose a workspace keeps that choice; an invitation still opens the invitation.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, cloudEval, email, lastMail, signIn } from './fixtures'

type Ws = { id: string; name: string; role: string; personal?: boolean }

/** Sign in from the app through the switcher's sign-in dialog and the magic link (as people do). */
async function uiSignIn(page: Page, address: string): Promise<void> {
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: /Sign in to the team cloud/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill(address)
  await dialog.getByRole('button', { name: /Send sign-in link/ }).click()
  await expect(dialog.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  await page.goto((await lastMail(page, address)).link)
}

const ownSpace = async (page: Page) => {
  const me = await api<{ workspaces: Ws[] }>(page, 'GET', '/api/me')
  const own = me.json.workspaces.find((w) => w.personal)
  expect(own).toBeTruthy()
  return own!
}

/** The workspace entries of the switcher, top to bottom. */
async function switcherEntries(page: Page): Promise<string[]> {
  await page.locator('aside.sb .sb-head__ws').click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const labels = await menu.getByRole('menuitem').allTextContents()
  await page.keyboard.press('Escape')
  return labels.map((l) => l.replace(/\s+/g, ' ').trim())
}

test.describe('a workspace of one’s own', () => {
  test('a new person signs in and lands in their own space', async ({ page }) => {
    const address = email('nora')
    const local = address.split('@')[0]!
    await page.goto('/app/')
    await expect(page.locator('.app')).toBeVisible()
    await uiSignIn(page, address)

    const head = page.locator('aside.sb .sb-head__ws')
    await expect(head).toContainText(`${local}’s space`)
    await expect(head).toContainText(/Team · Owner/i)
    await expect(page.locator('.status__save')).toContainText(/Synced · Team/i, { timeout: 20_000 })
    const own = await ownSpace(page)
    expect(own.name).toBe(`${local}’s space`)
    expect(await cloudEval(page, (c) => c.active)).toEqual({ kind: 'cloud', id: own.id })
    expect(page.url()).not.toContain('signed-in')

    // nobody else is in it
    const members = await api<Array<{ user: { email: string } }>>(page, 'GET', `/api/workspaces/${own.id}/members`)
    expect(members.json.map((m) => m.user.email)).toEqual([address])

    // remembered for this browser; a team workspace created later is listed after it
    const team = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name: 'Nora Studio' })
    expect(team.status).toBe(201)
    await page.reload()
    await expect(head).toContainText(`${local}’s space`)
    const entries = await switcherEntries(page)
    const at = (name: string) => entries.findIndex((e) => e.includes(name))
    expect(at('This browser (local)')).toBe(0)
    expect(at(`${local}’s space`)).toBe(1)
    expect(at('Nora Studio')).toBe(2)
  })

  test('a browser that chose its local workspace keeps it; the own space waits in the switcher', async ({ page }) => {
    const address = email('otto')
    const local = address.split('@')[0]!
    await page.goto('/app/')
    await expect(page.locator('.app')).toBeVisible()
    await page.evaluate(() => localStorage.setItem('one.cloud.active', 'local'))
    await uiSignIn(page, address)
    await expect(page.locator('.app')).toBeVisible()
    await expect.poll(() => cloudEval(page, (c) => (c.user ? c.workspaces.length : -1))).toBe(1)
    expect(await cloudEval(page, (c) => c.active.kind)).toBe('local')
    const entries = await switcherEntries(page)
    expect(entries.findIndex((e) => e.includes(`${local}’s space`))).toBe(1)
  })

  test('an invitation still opens the invitation — and the invited person has a space of their own too', async ({ page, browser }) => {
    await signIn(page, email('pia'))
    const team = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name: 'Pia Partners' })
    const invite = await api<{ link: string }>(page, 'POST', `/api/workspaces/${team.json.id}/invites`, { role: 'member' })
    expect(invite.status).toBe(201)

    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'en-US', serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
    const quinn = await ctx.newPage()
    const address = email('quinn')
    const local = address.split('@')[0]!
    await quinn.goto(invite.json.link)
    await expect(quinn.getByRole('heading', { name: 'You’re invited.' })).toBeVisible()
    await quinn.getByLabel('Email').fill(address)
    await quinn.getByRole('button', { name: /Send sign-in link/ }).click()
    await expect(quinn.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
    await quinn.goto((await lastMail(quinn, address)).link)
    await quinn.getByRole('button', { name: 'Join Pia Partners' }).click()
    const head = quinn.locator('aside.sb .sb-head__ws')
    await expect(head).toContainText('Pia Partners')
    await expect(head).toContainText(/Team · Member/i)

    const own = await ownSpace(quinn)
    expect(own.name).toBe(`${local}’s space`)
    const entries = await switcherEntries(quinn)
    const at = (name: string) => entries.findIndex((e) => e.includes(name))
    expect(at(`${local}’s space`)).toBe(1)
    expect(at('Pia Partners')).toBe(2)
    await ctx.close()
  })
})
