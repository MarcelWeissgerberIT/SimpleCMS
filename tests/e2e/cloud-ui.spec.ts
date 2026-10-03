/**
 * Team-cloud UI in the GitHub Pages build (no server): the local workspace stays exactly as it was,
 * the workspace switcher shows an honest "coming soon · self-host" teaser, invitation links explain
 * themselves. Cloud states (signed out, viewer, team settings, invitations) are rendered through the
 * app's ?e2e hook (window.__oneCloud), which swaps the cloud calls for mocks.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, MOD } from './fixtures'

const USER = { id: 'u1', email: 'ada@acme.studio', name: 'Ada Lovelace' }
const WS = [
  { id: 'ws_acme123', name: 'Acme Studio', icon: null, role: 'owner' },
  { id: 'ws_field456', name: 'Field Notes', icon: null, role: 'viewer' },
]

/** Replace cloud calls with recorders; returns nothing — read window.__calls in the page. */
async function mockCloud(page: Page, state: Record<string, unknown>) {
  await page.evaluate((state) => {
    const w = window as unknown as { __oneCloud: { mock: (o: object) => void; set: (s: object) => void }; __calls: unknown[][] }
    w.__calls = []
    const rec = (name: string, result?: unknown) => async (...args: unknown[]) => {
      w.__calls.push([name, ...args])
      return result
    }
    w.__oneCloud.mock({
      requestSignIn: rec('requestSignIn'),
      signOut: rec('signOut'),
      switchWorkspace: (...args: unknown[]) => void w.__calls.push(['switchWorkspace', ...args]),
      previewInvite: rec('previewInvite', { workspace: { name: 'Acme Studio' }, role: 'member', inviter: { name: 'Ada Lovelace', email: 'ada@acme.studio' }, email: null, expires_at: '2030-01-01T00:00:00Z' }),
      acceptInvite: rec('acceptInvite', { workspaceId: 'ws_acme123' }),
      listMembers: rec('listMembers', [
        { user: { id: 'u1', email: 'ada@acme.studio', name: 'Ada Lovelace' }, role: 'owner', created_at: '2026-09-02T10:00:00Z' },
        { user: { id: 'u3', email: 'linus@acme.studio', name: 'Linus Ek' }, role: 'member', created_at: '2026-09-21T10:00:00Z' },
      ]),
      listInvites: rec('listInvites', []),
      setMemberRole: rec('setMemberRole'),
      createInvite: rec('createInvite', { id: 'i1', role: 'viewer', email: null, created_at: Date.now(), expires_at: Date.now() + 6048e5, link: 'https://cloud.example.com/app/#/invite/tok' }),
    })
    w.__oneCloud.set(state)
  }, state)
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls)

test.describe('team cloud in the local-only build', () => {
  test('switcher: local workspace, honest teaser, no dead cloud actions', async ({ page }) => {
    await openApp(page)
    const head = page.locator('aside.sb .sb-head__ws')
    await expect(head).toContainText('Local workspace')
    await head.click()
    const menu = page.locator('[data-popover][role="menu"]')
    await expect(menu.getByRole('menuitem', { name: /This browser \(local\)/ })).toBeVisible()
    await expect(menu).toContainText('Team cloud — coming soon')
    await expect(menu.getByRole('menuitem', { name: /New team workspace/ })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: /Sign out/ })).toHaveCount(0)
    // the teaser opens the self-hosting guide in a new tab
    await page.evaluate(() => {
      const w = window as unknown as { __opened: string[] }
      w.__opened = []
      window.open = ((url: string) => (w.__opened.push(url), null)) as typeof window.open
    })
    await menu.getByRole('menuitem', { name: /Self-host today/ }).click()
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toEqual([expect.stringMatching(/github\.com\/.+\/docs\/SELF_HOSTING\.md$/)])
    // the rest of the menu is still there
    await head.click()
    await expect(page.getByRole('menuitem', { name: /^Settings/ })).toBeVisible()
  })

  test('no regressions: local status read-out, no team tab, no cloud command, no presence', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.status__save')).toContainText(/Saved locally/i)
    await expect(page.locator('[data-testid="view-only"], [data-testid="presence"], .cl-banner')).toHaveCount(0)
    await page.keyboard.press(`${MOD}+,`)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('tab', { name: /General/ })).toBeVisible()
    await expect(settings.getByRole('tab', { name: /Team/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('team workspace')
    await expect(page.getByRole('option', { name: /New team workspace/ })).toHaveCount(0)
  })

  test('an invitation link explains that this copy has no server', async ({ page }) => {
    // a fresh visit straight to the invite (the workspace is seeded behind it)
    await page.goto('app/?e2e#/invite/some-token')
    await expect(page.getByRole('heading', { name: 'Invites need a team server.' })).toBeVisible()
    await expect(page.locator('.cl-foot')).toContainText(/No server/i)
    await page.getByRole('button', { name: /Open my workspace/ }).click()
    await expect(page.locator('.app')).toBeVisible()
    await expect(page.locator('aside.sb .sb-head__ws')).toContainText('Local workspace')
  })
})

test.describe('team cloud UI states (mocked cloud)', () => {
  test('signed out: sign-in screen, check-your-inbox, escape to the local workspace', async ({ page }) => {
    await openApp(page)
    await mockCloud(page, { available: true, status: 'signed-out', active: { kind: 'cloud', id: 'ws_acme123' } })
    await expect(page.getByRole('heading', { name: 'Sign in.' })).toBeVisible()
    await page.getByRole('button', { name: /Send sign-in link/ }).click()
    await expect(page.getByRole('alert')).toContainText('does not look like an email')
    await page.getByLabel('Email').fill('ada@acme.studio')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
    await expect(page.locator('.cl-addr')).toHaveText('ada@acme.studio')
    await expect(page.getByRole('button', { name: /Send again in/ })).toBeDisabled()
    await page.getByRole('button', { name: /local workspace instead/ }).click()
    expect(await calls(page)).toEqual([
      ['requestSignIn', 'ada@acme.studio', { invite: undefined, lang: 'en' }],
      ['switchWorkspace', { kind: 'local', id: 'local' }],
    ])
  })

  test('invitation: preview, then join and switch into the workspace', async ({ page }) => {
    await openApp(page)
    await mockCloud(page, { available: true, user: USER, workspaces: WS })
    await page.evaluate(() => (location.hash = '#/invite/tok123'))
    await expect(page.getByRole('heading', { name: 'You’re invited.' })).toBeVisible()
    await expect(page.locator('.cl-card')).toContainText('Acme Studio')
    await expect(page.locator('.cl-card')).toContainText('Member')
    await page.getByRole('button', { name: 'Join Acme Studio' }).click()
    await expect.poll(() => calls(page)).toEqual([
      ['previewInvite', 'tok123'],
      ['acceptInvite', 'tok123'],
      ['switchWorkspace', { kind: 'cloud', id: 'ws_acme123' }],
    ])
    expect(await page.evaluate(() => location.hash)).toBe('#/')
  })

  test('viewer: VIEW ONLY tag, no creation actions', async ({ page }) => {
    await openApp(page)
    await mockCloud(page, { available: true, user: USER, workspaces: WS, active: { kind: 'cloud', id: 'ws_field456' }, role: 'viewer', readOnly: true, status: 'online' })
    await expect(page.getByTestId('view-only')).toBeVisible()
    await expect(page.locator('.status')).toContainText(/Synced · Team/i)
    await expect(page.locator('.status')).toContainText(/View only/i)
    const sb = page.locator('aside.sb')
    await expect(sb.locator('.sb-head__ws')).toContainText('Field Notes')
    await expect(sb.getByRole('button', { name: 'New page' })).toHaveCount(0)
    await expect(sb.getByRole('button', { name: 'Import' })).toHaveCount(0)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('new page')
    await expect(page.getByRole('option', { name: /^New page/ })).toHaveCount(0)
  })

  test('team settings: members, role change, invite link', async ({ page }) => {
    await openApp(page)
    await mockCloud(page, { available: true, user: USER, workspaces: WS, active: { kind: 'cloud', id: 'ws_acme123' }, role: 'owner', status: 'online' })
    await page.locator('aside.sb .sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'Team settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByTestId('member')).toHaveCount(2)
    await dialog.getByLabel('Role of Linus Ek').selectOption('viewer')
    await expect(page.locator('.toasts')).toContainText('Linus Ek is now Viewer')
    await dialog.getByLabel('Role', { exact: true }).selectOption('viewer')
    await dialog.getByRole('button', { name: /Create invite link/ }).click()
    await expect(dialog.getByTestId('invite-link').locator('input')).toHaveValue('https://cloud.example.com/app/#/invite/tok')
    const log = await calls(page)
    expect(log).toContainEqual(['setMemberRole', 'ws_acme123', 'u3', 'viewer'])
    expect(log).toContainEqual(['createInvite', 'ws_acme123', 'viewer', undefined])
  })

  test('presence: others on this page show in the topbar', async ({ page }) => {
    await openApp(page)
    const start = await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { settings: { startPageId: string } } } } }).__one.workspace.getState().settings.startPageId)
    await page.evaluate((id) => (location.hash = `#/p/${id}`), start)
    const peers = ['Grace Hopper', 'Linus Ek', 'Joan Clarke', 'Alan Kay', 'Edsger Dijkstra'].map((name, i) => ({ clientId: i + 2, userId: `p${i}`, name, color: '#2f9e44', pageId: start }))
    await mockCloud(page, { available: true, user: USER, workspaces: WS, active: { kind: 'cloud', id: 'ws_acme123' }, role: 'owner', status: 'online', peers })
    const stack = page.getByTestId('presence')
    await expect(stack).toBeVisible()
    await expect(stack.locator('.cl-av')).toHaveCount(4)
    await expect(stack).toContainText('+1')
    await expect(stack).toHaveAttribute('aria-label', /Grace Hopper/)
  })
})
