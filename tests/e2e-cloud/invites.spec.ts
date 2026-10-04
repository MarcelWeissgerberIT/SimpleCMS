/**
 * Invite people by link and registration links (docs/CLOUD.md § Invites & registration links):
 * a reusable link brings two people in (the list counts them, only admins see the places left), several
 * addresses are invited at once from the Share dialog (German, on a phone), and a server admin hands out
 * a registration link on an invite-only server — started here as a second server next to the suite's.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test, expect, api, cloudEval, email, lastMail, newPerson, openApp, signIn, waitForApp, waitOnline } from './fixtures'

const PORT = Number(process.env.CLOUD_E2E_PORT) || 4500
/** The invite-only server: the suite's app build, its own data, SIGNUP=invite, one server admin. */
const REG_PORT = PORT + 1
const REG = `http://127.0.0.1:${REG_PORT}`
const REG_DATA = `node_modules/.cache/cloud-data-${REG_PORT}-invite-only`
const ROOT = 'root@reg.example.test'
/** FAKE master key for this throwaway server only (the same as the suite's, see playwright.cloud.config.ts). */
const DATA_KEY = Buffer.from('test-only-data-key-not-a-secret!', 'utf8').toString('base64')

let regServer: ChildProcess | null = null

async function startInviteOnlyServer(): Promise<void> {
  rmSync(REG_DATA, { recursive: true, force: true })
  regServer = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/dist/index.js'], {
    env: {
      PATH: process.env.PATH ?? '',
      PORT: String(REG_PORT),
      HOST: '127.0.0.1',
      DATA_DIR: REG_DATA,
      APP_DIR: `node_modules/.cache/cloud-dist-${PORT}`,
      PUBLIC_URL: REG,
      DEV_MODE: '1',
      AUTH_IP_LIMIT: '1000',
      SIGNUP: 'invite',
      ADMIN_EMAILS: ROOT,
      LOG_LEVEL: 'warn',
      DATA_KEY,
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${REG}/api/health`)).ok) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the invite-only server did not start')
}

/** A browser of its own on the invite-only server. */
async function regPerson(browser: Browser, opts: { locale?: string } = {}): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: `${REG}/`, locale: opts.locale ?? 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
  return ctx.newPage()
}

/**
 * Sign in through the magic link and come back like the app does (`?signed-in=1`, and `?e2e` for the
 * test hook): a browser that never chose a workspace opens the person's own space.
 */
async function signInToOwnSpace(page: Page, address: string): Promise<void> {
  await page.goto('/app/?e2e')
  const r = await api(page, 'POST', '/api/auth/request', { email: address, redirect: '/app/?e2e&signed-in=1' })
  expect(r.status).toBe(204)
  await page.goto((await lastMail(page, address)).link)
  await waitForApp(page)
  await expect.poll(() => cloudEval(page, (c) => c.status as string), { timeout: 20_000 }).toBe('online')
}

/** Signed in with a fresh team workspace, open in this tab and in sync. */
async function ownerInWorkspace(page: Page, name: string): Promise<{ address: string; wsId: string }> {
  const address = email('owner')
  await signIn(page, address)
  const ws = await api<{ id: string }>(page, 'POST', '/api/workspaces', { name })
  expect(ws.status).toBe(201)
  await openApp(page, ws.json.id)
  await waitOnline(page)
  return { address, wsId: ws.json.id }
}

/** A new person opens the invite link, signs in from it and joins. */
async function joinThroughLink(context: BrowserContext, link: string, who: string, workspace: string): Promise<string> {
  const person = await newPerson(context)
  const address = email(who)
  await person.goto(link)
  await expect(person.getByRole('heading', { name: 'You’re invited.' })).toBeVisible()
  // invitees never see how many places a link has
  await expect(person.locator('.cl-card')).toContainText('@example.test')
  await expect(person.getByTestId('invite-places')).toHaveCount(0)
  // an address the link would not admit is caught before a mail that would never come
  await person.getByLabel('Email').fill(`${who}@elsewhere.test`)
  await person.getByRole('button', { name: /Send sign-in link/ }).click()
  await expect(person.getByRole('alert')).toHaveText('This link is only for addresses at @example.test.')
  await person.getByLabel('Email').fill(address)
  await person.getByRole('button', { name: /Send sign-in link/ }).click()
  await expect(person.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  await person.goto((await lastMail(person, address)).link)
  await person.getByRole('button', { name: `Join ${workspace}` }).click()
  await expect(person.locator('aside.sb .sb-head__ws')).toContainText(workspace)
  await expect(person.locator('aside.sb .sb-head__ws')).toContainText(/Team · Member/i)
  await person.context().close()
  return address
}

test.describe('invite people by link', () => {
  test('one reusable link: two people join through it, the admins see the uses', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { wsId } = await ownerInWorkspace(page, 'Reuse Studio')

    // the workspace menu's "Invite people…" lands on the invite form
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'Invite people…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true')
    const form = dialog.getByTestId('invite-form')
    await expect(form.getByRole('radio', { name: 'Link' })).toBeFocused()
    // reusable links never make admins
    await expect(form.getByLabel('Role', { exact: true }).locator('option')).toHaveText(['Member', 'Viewer'])
    await form.getByLabel('Uses').selectOption('10')
    await form.getByLabel('Valid').selectOption('30')
    await form.getByLabel('Only addresses at').fill('@Example.test')
    await form.getByRole('button', { name: 'Create invite link' }).click()

    const panel = dialog.getByTestId('invite-link')
    await expect(panel.locator('.tm-spec')).toHaveText(/30 days · 0\/10 used · @example\.test/i)
    const link = await panel.locator('input').inputValue()
    expect(link).toMatch(/\/app\/#\/invite\/[\w-]{43}$/)
    await panel.getByRole('button', { name: 'Copy' }).click()
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
    await page.keyboard.press('Escape')

    const first = await joinThroughLink(context, link, 'linus', 'Reuse Studio')
    await joinThroughLink(context, link, 'grace', 'Reuse Studio')

    // the list counts them; the admin's own look at the link shows the places left
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'Invite people…' }).click()
    const row = dialog.getByTestId('invite').filter({ hasText: 'Anyone with the link' })
    await expect(row).toContainText('2/10 used')
    await expect(row).toContainText('last joined')
    await expect(row.getByRole('meter')).toHaveAttribute('aria-valuenow', '2')
    await expect(dialog.getByTestId('member')).toHaveCount(3)
    await expect(dialog.getByTestId('member').filter({ hasText: first })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto(link)
    await expect(page.getByTestId('invite-places')).toContainText('8 of 10')
    await expect(page.getByTestId('invite-places')).toContainText('shown to admins only')

    // revoked: the next person is told the link is dead
    const invites = await api<Array<{ id: string; max_uses: number }>>(page, 'GET', `/api/workspaces/${wsId}/invites`)
    const reusable = invites.json.find((i) => i.max_uses === 10)!
    expect((await api(page, 'DELETE', `/api/workspaces/${wsId}/invites/${reusable.id}`, {})).status).toBe(204)
    const late = await newPerson(context)
    await late.goto(link)
    await expect(late.getByRole('heading', { name: 'This invite can’t be used.' })).toBeVisible()
    await late.context().close()
  })

  test('German, on a phone: from the Share dialog to invites for several addresses', async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    const page = await ctx.newPage()
    const { wsId } = await ownerInWorkspace(page, 'Atelier Nord')
    // someone who is already in, to see "already a member"
    const member = await newPerson(ctx)
    const memberAddress = email('mitglied')
    await signIn(member, memberAddress)
    const inv = await api<{ link: string }>(page, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'member' })
    expect((await api(member, 'POST', `/api/invites/${inv.json.link.split('#/invite/')[1]}/accept`, {})).status).toBe(200)
    await member.close()

    const pageId = await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { createPage: (i: object) => string } } } }).__one.workspace.getState().createPage({ title: 'Plan' }))
    await page.evaluate((id) => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: object) => void } } } }).__one.ui.getState().openModal({ type: 'share', pageId: id }), pageId)
    const share = page.getByRole('dialog')
    await expect(share.getByTestId('share-invite')).toContainText('Personen in Atelier Nord einladen')
    await share.getByTestId('share-invite').click()

    const dialog = page.getByRole('dialog', { name: 'Einstellungen' })
    await expect(dialog.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true')
    const form = dialog.getByTestId('invite-form')
    await expect(form).toBeInViewport()
    await form.getByRole('radio', { name: 'E-Mail' }).click()
    await expect(form.getByLabel('Rolle', { exact: true }).locator('option')).toHaveText(['Mitglied', 'Leser', 'Admin'])
    const ada = email('ada')
    const bob = email('bob')
    await form.getByLabel('E-Mail-Adressen').fill(`Ada Lovelace <${ada}>, ${bob}\n${memberAddress}`)
    await expect(form.locator('.tm-count')).toHaveText(/3 Adressen · max\. 20/i)
    await form.getByRole('button', { name: 'Einladungen senden' }).click()
    const results = dialog.getByTestId('invite-results')
    await expect(results).toContainText('Ergebnis · 2 von 3 gesendet')
    await expect(results.locator('.tm-result').filter({ hasText: ada })).toContainText('Gesendet')
    await expect(results.locator('.tm-result').filter({ hasText: memberAddress })).toContainText('Schon Mitglied')
    const mail = await lastMail(page, ada)
    expect(mail.subject).toMatch(/hat dich zu „Atelier Nord“ eingeladen/)
    expect(mail.link).toMatch(/#\/invite\/[\w-]{43}$/)
    // nothing runs off the side of the phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  })
})

test.describe('registration links (SIGNUP=invite)', () => {
  test.beforeAll(startInviteOnlyServer)
  test.afterAll(async () => {
    const proc = regServer
    regServer = null
    if (proc && proc.exitCode === null) await new Promise((resolve) => (proc.once('exit', resolve), proc.kill('SIGTERM')))
    rmSync(REG_DATA, { recursive: true, force: true })
  })

  test('a server admin hands out a link; a newcomer lands in a space of their own; revoked = dead', async ({ browser }) => {
    // the admin needs no invitation (ADMIN_EMAILS) and gets Settings → Server
    const root = await regPerson(browser)
    await signInToOwnSpace(root, ROOT)
    expect(await cloudEval(root, (c) => c.serverAdmin)).toBe(true)
    await root.locator('aside.sb .sb-head__ws').click()
    await root.getByRole('menuitem', { name: /^Settings/ }).click()
    const dialog = root.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: /Server/ }).click()
    await expect(dialog.getByTestId('signup-mode')).toContainText('Invite only')
    const form = dialog.getByTestId('signup-form')
    await form.getByLabel('Uses').selectOption('5')
    await form.getByLabel('Label').fill('Spring cohort')
    await form.getByRole('button', { name: 'Create registration link' }).click()
    const panel = dialog.getByTestId('signup-link')
    await expect(panel.locator('.tm-spec')).toHaveText(/7 days · 0\/5 used/i)
    const link = await panel.locator('input').inputValue()
    expect(link).toMatch(new RegExp(`^${REG}/app/#/signup/[\\w-]{43}$`))
    await expect(dialog.getByTestId('signup-row').filter({ hasText: 'Spring cohort' })).toContainText('0/5 used')

    // without the link, an unknown address gets no mail
    const stranger = await regPerson(browser)
    await stranger.goto('/app/')
    expect((await api(stranger, 'POST', '/api/auth/request', { email: 'stranger@else.test' })).status).toBe(204)
    await stranger.waitForTimeout(300)
    expect(await (await stranger.request.get('/api/dev/mailbox?to=stranger%40else.test')).json()).toEqual([])
    await stranger.context().close()

    // with it: create the account, land in the own space
    const nina = await regPerson(browser)
    const address = email('nina')
    const local = address.split('@')[0]!
    // (?e2e: the test hook survives the magic link's way back)
    await nina.goto(link.replace('/app/#', '/app/?e2e#'))
    await expect(nina.getByRole('heading', { name: `Create your account on 127.0.0.1:${REG_PORT}.` })).toBeVisible()
    await expect(nina.getByTestId('signup-places')).toHaveCount(0)
    await nina.getByLabel('Email').fill(address)
    await nina.getByRole('button', { name: /Send sign-in link/ }).click()
    await expect(nina.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
    await nina.goto((await lastMail(nina, address)).link)
    await expect(nina.locator('aside.sb .sb-head__ws')).toContainText(`${local}’s space`, { timeout: 20_000 })
    await expect(nina.locator('aside.sb .sb-head__ws')).toContainText(/Team · Owner/i)
    expect(await cloudEval(nina, (c) => c.workspaces.map((w: { personal?: boolean }) => !!w.personal))).toEqual([true])
    expect(await cloudEval(nina, (c) => c.serverAdmin)).toBe(false)

    // the admin sees the use, then revokes the link
    await root.keyboard.press('Escape')
    await root.locator('aside.sb .sb-head__ws').click()
    await root.getByRole('menuitem', { name: /^Settings/ }).click()
    await dialog.getByRole('tab', { name: /Server/ }).click()
    const row = dialog.getByTestId('signup-row').filter({ hasText: 'Spring cohort' })
    await expect(row).toContainText('1/5 used')
    await row.getByRole('button', { name: 'Revoke' }).click()
    await row.getByRole('group').getByRole('button', { name: 'Revoke' }).click()
    await expect(root.locator('.toasts')).toContainText('Registration link revoked')
    await expect(dialog.getByTestId('signup-row')).toHaveCount(0)

    const late = await regPerson(browser)
    await late.goto(link)
    await expect(late.getByRole('heading', { name: 'This registration link can’t be used.' })).toBeVisible()
    await expect(late.locator('.cl-foot')).toContainText(/Link not usable/i)
    await Promise.all([root, nina, late].map((p) => p.context().close()))
  })
})
