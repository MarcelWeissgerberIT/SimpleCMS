/**
 * Team-cloud UI against the real server: sign-in screen, the new-workspace dialog, invitations,
 * the member list, roles and presence — what people click, not the API underneath.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, lastMail, signIn, newPerson } from './fixtures'

/** Sign in from the local workspace through the switcher's sign-in dialog and the magic link. */
async function uiSignIn(page: Page, address: string, mailsBefore = 0): Promise<void> {
  await page.goto('/app/')
  await expect(page.locator('.app')).toBeVisible()
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: /Sign in to the team cloud/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill(address)
  await dialog.getByRole('button', { name: /Send sign-in link/ }).click()
  await expect(dialog.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  await page.goto((await lastMail(page, address, mailsBefore + 1)).link)
  await expect(page.locator('.app')).toBeVisible()
}

/** Signed in (API) with a fresh team workspace of their own. */
async function ownerWithWorkspace(page: Page, who: string, name: string): Promise<{ address: string; wsId: string }> {
  const address = email(who)
  await signIn(page, address)
  const ws = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name })
  expect(ws.status).toBe(201)
  return { address, wsId: ws.json.id }
}

/** Open a cloud workspace in this tab and wait until it is in sync. */
async function openWorkspace(page: Page, wsId: string, name: string): Promise<void> {
  await page.goto(`/app/?w=${wsId}`)
  await expect(page.locator('aside.sb .sb-head__ws')).toContainText(name)
  await expect(page.locator('.status__save')).toContainText(/Synced · Team/i, { timeout: 20_000 })
}

/** Workspace settings → People through the workspace menu (from Home: the members load fresh). */
async function openTeam(page: Page) {
  await page.evaluate(() => (location.hash = '#/'))
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: 'Members & people' }).click()
  const ws = page.getByTestId('workspace-page')
  await expect(ws).toHaveAttribute('data-section', 'people')
  return ws
}

/** Accept an invite link as an already signed-in person (API) — setup, not the subject. */
async function joinByApi(page: Page, link: string): Promise<void> {
  const token = link.split('#/invite/')[1]
  const r = await api(page, 'POST', `/api/invites/${token}/accept`, {})
  expect(r.status).toBeLessThan(300)
}

test.describe('team cloud UI', () => {
  test('sign-in screen → magic link → signed in to the workspace', async ({ page }) => {
    const address = email('ada')
    await uiSignIn(page, address)
    const ws = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name: 'Acme Sign-in' })
    expect(ws.status).toBe(201)
    await page.reload()
    // pick it in the switcher (remembered for this browser)
    const head = page.locator('aside.sb .sb-head__ws')
    await head.click()
    await page.getByRole('menuitem', { name: /Acme Sign-in/ }).click()
    await expect(head).toContainText('Acme Sign-in')
    await expect(page.locator('.status__save')).toContainText(/Synced · Team/i, { timeout: 20_000 })

    // the session ends (signed out elsewhere): the next visit asks to sign in
    expect((await api(page, 'POST', '/api/auth/logout', {})).status).toBe(204)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in.' })).toBeVisible()
    await page.getByLabel('Email').fill(address)
    await page.getByRole('button', { name: /Send sign-in link/ }).click()
    await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
    await expect(page.locator('.cl-addr')).toHaveText(address)

    await page.goto((await lastMail(page, address, 2)).link)
    await expect(head).toContainText('Acme Sign-in')
    await expect(head).toContainText(/Team · Owner/i)
    await expect(page.locator('.status__save')).toContainText(/Synced · Team/i, { timeout: 20_000 })
  })

  test('new team workspace through the dialog (start empty)', async ({ page }) => {
    await uiSignIn(page, email('grace'))
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: /New team workspace/ }).click()
    const dialog = page.getByRole('dialog', { name: 'New team workspace' })
    await dialog.getByLabel('Workspace name').fill('Studio Grace')
    await dialog.getByRole('button', { name: /Create workspace/ }).click()
    await expect(dialog).toContainText('“Studio Grace” is ready on the server.')
    await dialog.getByRole('radio', { name: /Start empty/ }).click()
    await dialog.getByRole('button', { name: /Open workspace/ }).click()

    const head = page.locator('aside.sb .sb-head__ws')
    await expect(head).toContainText('Studio Grace')
    await expect(head).toContainText(/Team · Owner/i)
    await expect(page.locator('.status__save')).toContainText(/Synced · Team/i, { timeout: 20_000 })
  })

  test('new team workspace: copy my local workspace (progress, then open it)', async ({ page }) => {
    await uiSignIn(page, email('hedy'))
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: /New team workspace/ }).click()
    const dialog = page.getByRole('dialog', { name: 'New team workspace' })
    await dialog.getByLabel('Workspace name').fill('Copied Studio')
    await dialog.getByRole('button', { name: /Create workspace/ }).click()
    await dialog.getByRole('radio', { name: /Copy my local workspace/ }).click()
    await dialog.getByRole('button', { name: /Copy and open/ }).click()
    await expect(dialog.getByRole('progressbar')).toBeVisible()

    const head = page.locator('aside.sb .sb-head__ws')
    await expect(head).toContainText('Copied Studio', { timeout: 60_000 })
    await expect(page.locator('aside.sb')).toContainText('Welcome to One', { timeout: 20_000 })
  })

  test('invite link → a colleague joins via #/invite/<token> → both listed → role change', async ({ page, context }) => {
    const { wsId } = await ownerWithWorkspace(page, 'ada', 'Acme Team')
    await openWorkspace(page, wsId, 'Acme Team')

    // Ada creates a link in Workspace settings → People
    let team = await openTeam(page)
    await team.getByLabel('Role', { exact: true }).selectOption('member')
    await team.getByRole('button', { name: /Create invite link/ }).click()
    const link = await team.getByTestId('invite-link').locator('input').inputValue()
    expect(link).toMatch(/\/app\/#\/invite\/[\w-]+$/)
    await expect(team.getByTestId('invite')).toHaveCount(1)
    await page.keyboard.press('Escape')

    // Linus opens it in his own browser, signs in from the invitation and joins
    const linus = await newPerson(context)
    const linusMail = email('linus')
    await linus.goto(link)
    await expect(linus.getByRole('heading', { name: 'You’re invited.' })).toBeVisible()
    await expect(linus.locator('.cl-card')).toContainText('Acme Team')
    await expect(linus.locator('.cl-card')).toContainText('Member')
    await linus.getByLabel('Email').fill(linusMail)
    await linus.getByRole('button', { name: /Send sign-in link/ }).click()
    await expect(linus.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
    await linus.goto((await lastMail(linus, linusMail)).link)
    await linus.getByRole('button', { name: 'Join Acme Team' }).click()
    await expect(linus.locator('aside.sb .sb-head__ws')).toContainText('Acme Team')
    await expect(linus.locator('aside.sb .sb-head__ws')).toContainText(/Team · Member/i)

    // Ada sees both members and makes Linus a viewer
    team = await openTeam(page)
    await expect(team.getByTestId('member')).toHaveCount(2)
    await expect(team.getByTestId('member').filter({ hasText: linusMail })).toBeVisible()
    await expect(team.getByTestId('invite')).toHaveCount(0)
    const linusName = (await team.getByTestId('member').filter({ hasText: linusMail }).locator('.tm-row__name > span').first().textContent())!.trim()
    await team.getByLabel(`Role of ${linusName}`).selectOption('viewer')
    await expect(page.locator('.toasts')).toContainText(`${linusName} is now Viewer`)
    const members = await api<Array<{ user: { email: string }; role: string }>>(page, 'GET', `/api/workspaces/${wsId}/members`)
    expect(members.json.find((m) => m.user.email === linusMail)?.role).toBe('viewer')

    // Linus's tab turns read-only
    await expect(linus.getByTestId('view-only')).toBeVisible({ timeout: 20_000 })
    await linus.context().close()
  })

  test('presence: an avatar appears when both are on the same page', async ({ page, context }) => {
    const { wsId } = await ownerWithWorkspace(page, 'ada', 'Acme Presence')
    const invite = await api<{ link: string }>(page, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'member' })
    expect(invite.status).toBe(201)
    await openWorkspace(page, wsId, 'Acme Presence')
    await page.locator('aside.sb .sb-newpage').click()
    await page.keyboard.type('Standup')
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/p\//)
    const pageHash = await page.evaluate(() => location.hash)

    const linus = await newPerson(context)
    await signIn(linus, email('linus'))
    await joinByApi(linus, invite.json.link)
    await openWorkspace(linus, wsId, 'Acme Presence')
    await expect(linus.locator('aside.sb')).toContainText('Standup', { timeout: 20_000 })
    await linus.evaluate((h) => (location.hash = h), pageHash)

    await expect(page.getByTestId('presence')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('presence').locator('.cl-av')).toHaveCount(1)
    await expect(linus.getByTestId('presence')).toBeVisible({ timeout: 20_000 })
    // and in Ada's sidebar, the page carries a dot while Linus is on it
    await expect(page.locator('aside.sb').getByTestId('tree-peer').first()).toBeVisible()

    // Linus leaves the page → his avatar goes away
    await linus.evaluate(() => (location.hash = '#/'))
    await expect(page.getByTestId('presence')).toHaveCount(0, { timeout: 20_000 })
    await linus.context().close()
  })
})
