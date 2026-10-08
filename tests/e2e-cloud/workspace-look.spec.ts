/**
 * The workspace look in a team workspace (against the real server): owners and admins change it, everyone sees it
 * at once (meta map `workspace`, key `look`); a member reads the section only — the store refuses, a look written
 * into the member's store is put back, and the owner's look stays as it was; a role change reaches an open tab at
 * once (demoted: read-only, promoted: editable — no reload). The server guard itself (a raw Yjs write from a
 * member, roles changed under an open socket) is covered by server/test/workspace-look.test.ts.
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, wsEval, cloudEval, createWorkspace, join, api } from './fixtures'

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

async function openLook(page: Page) {
  await page.evaluate(() => (location.hash = '#/workspace/look'))
  await expect(page.getByTestId('look-section')).toBeVisible()
  await page.keyboard.press('Shift') // the column keeps its scroll until the reader touches it
}

test('owners and admins set the look for everyone; a member reads it only', async ({ page, context }) => {
  await signIn(page, email('ada'))
  const wsId = await createWorkspace(page, 'Look Team')
  const admin = await newPerson(context)
  await signIn(admin, email('ben'))
  await join(page, admin, wsId, 'admin')
  const member = await newPerson(context)
  await signIn(member, email('mo'))
  await join(page, member, wsId, 'member')

  // the owner saves Blueprint for everyone
  await openApp(page, wsId)
  await waitOnline(page)
  await openLook(page)
  await page.getByTestId('look-preset-blueprint').click()
  await expect(page.getByTestId('look-save')).toHaveText('Save for everyone')
  await page.getByTestId('look-save').click()
  await expect.poll(() => wsEval(page, (s) => s.look?.preset ?? null)).toBe('blueprint')

  // the member sees it, before and after a reload, and cannot change it
  await openApp(member, wsId)
  await waitOnline(member)
  await expect.poll(() => wsEval(member, (s) => s.look?.preset ?? null)).toBe('blueprint')
  await expect.poll(() => token(member, '--signal')).toBe('#2759db')
  await openLook(member)
  await expect(member.getByTestId('look-readonly')).toBeVisible()
  await expect(member.getByTestId('look-reset')).toBeDisabled()
  await expect(member.getByTestId('look-preset-ochre')).toBeDisabled()
  await expect(member.getByTestId('look-state')).toContainText('BLUEPRINT')
  expect(await wsEval(member, (s) => s.setLook(null))).toBe(false)
  // a look put into the member's store directly is put back, and never reaches the others
  await member.evaluate(() => (window as unknown as { __one: { workspace: { setState: (p: object) => void } } }).__one.workspace.setState({ look: undefined }))
  await expect.poll(() => wsEval(member, (s) => s.look?.preset ?? null)).toBe('blueprint')
  await page.waitForTimeout(500)
  expect(await wsEval(page, (s) => s.look?.preset ?? null)).toBe('blueprint')

  // the admin changes it: owner and member follow, the state names who set it
  await openApp(admin, wsId)
  await waitOnline(admin)
  await openLook(admin)
  await admin.getByTestId('look-preset-proof').click()
  await admin.getByTestId('look-save').click()
  await expect.poll(() => wsEval(page, (s) => s.look?.preset ?? null)).toBe('proof')
  await expect.poll(() => wsEval(member, (s) => s.look?.preset ?? null)).toBe('proof')
  await expect.poll(() => token(member, '--signal')).toBe('#d4006e')
  await expect(member.getByTestId('look-state')).toContainText('PROOF')
  await expect(member.getByTestId('look-state')).toContainText('BEN')

  // a reload of the member's tab: the look comes back before the server answers (the per-device copy)
  await member.reload()
  await expect(member.locator('html')).toHaveAttribute('data-look', /.+/)
  await waitOnline(member)
  expect(await token(member, '--signal')).toBe('#d4006e')
  await admin.context().close()
})

test('a role change reaches the open tab: a demoted admin can no longer style, a promoted member can', async ({ page, context }) => {
  await signIn(page, email('ida'))
  const wsId = await createWorkspace(page, 'Look Roles')
  const other = await newPerson(context)
  await signIn(other, email('kai'))
  await join(page, other, wsId, 'admin')
  const kaiId = (await api<{ user: { id: string } }>(other, 'GET', '/api/me')).json.user.id
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(other, wsId)
  await waitOnline(other)
  await openLook(other)
  await expect(other.getByTestId('look-preset-ochre')).toBeEnabled()

  // demoted while the section is open: read-only without a reload, the store refuses
  expect((await api(page, 'PATCH', `/api/workspaces/${wsId}/members/${kaiId}`, { role: 'member' })).status).toBe(200)
  await expect.poll(() => cloudEval(other, (c) => ({ role: c.role, status: c.status }))).toEqual({ role: 'member', status: 'online' })
  await expect(other.getByTestId('look-readonly')).toBeVisible()
  await expect(other.getByTestId('look-preset-ochre')).toBeDisabled()
  expect(await wsEval(other, (s) => s.setLook({ preset: 'ochre', colors: { paper: '#f3eee2', ink: '#1c1912', signal: '#e0a000' }, fonts: { ui: 'archivo', text: 'ui', headings: 'expanded' }, corners: 'standard', updatedAt: 0, updatedBy: null }))).toBe(false)

  // promoted again: editable at once, the save reaches the owner
  expect((await api(page, 'PATCH', `/api/workspaces/${wsId}/members/${kaiId}`, { role: 'admin' })).status).toBe(200)
  await expect.poll(() => cloudEval(other, (c) => ({ role: c.role, status: c.status }))).toEqual({ role: 'admin', status: 'online' })
  await expect(other.getByTestId('look-readonly')).toBeHidden()
  await other.getByTestId('look-preset-ochre').click()
  await other.getByTestId('look-save').click()
  await expect.poll(() => wsEval(page, (s) => s.look?.preset ?? null)).toBe('ochre')
  await other.context().close()
})
