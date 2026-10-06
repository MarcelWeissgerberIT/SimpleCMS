/**
 * Workspace settings in a team workspace (#/workspace, against the real server): the plate counts the members,
 * People lists the members with their roles and the open invites (owner), plus the people without an account;
 * the owner renames the workspace there; a viewer reads everything and changes nothing.
 */
import type { Page } from '@playwright/test'
import { test, expect, api, email, signIn, newPerson, openApp, waitOnline, wsEval, createWorkspace, join } from './fixtures'

const wsPage = (page: Page) => page.getByTestId('workspace-page')

async function openPeople(page: Page) {
  await page.evaluate(() => (location.hash = '#/'))
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: 'Members & people' }).click()
  await expect(wsPage(page)).toHaveAttribute('data-section', 'people')
}

test.describe('workspace settings (team)', () => {
  test('members with roles, invites, people without an account; a viewer reads only', async ({ page, context }) => {
    await signIn(page, email('ada'))
    const wsId = await createWorkspace(page, 'Orbit Team')
    const viewer = await newPerson(context)
    await signIn(viewer, email('vera'))
    await join(page, viewer, wsId, 'viewer')
    // an open invite
    expect((await api(page, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'member' })).status).toBe(201)

    await openApp(page, wsId)
    await waitOnline(page)
    // a person without an account (as a person property would add one)
    await wsEval(page, (s) => s.addPerson('Grace Contractor'))
    await openPeople(page)
    await expect(page.getByTestId('ws-spec')).toContainText('TEAM · 2 MEMBERS · OWNER')
    const members = wsPage(page).getByTestId('member')
    await expect(members).toHaveCount(2)
    await expect(members.filter({ hasText: 'Owner' })).toHaveCount(1)
    // the owner changes roles here
    await expect(wsPage(page).getByLabel(/^Role of /)).toHaveCount(1)
    await expect(wsPage(page).getByTestId('invite')).toHaveCount(1)
    await expect(wsPage(page).getByTestId('invite-form')).toBeVisible()
    const others = wsPage(page).getByTestId('ws-person')
    await expect(others).toHaveCount(1)
    await expect(others).toContainText('Grace Contractor')
    await expect(others.getByRole('button', { name: 'Actions for Grace Contractor' })).toBeVisible()

    // the owner renames the workspace in the overview — on the server
    await wsPage(page).getByRole('link', { name: /Overview/ }).click()
    const name = wsPage(page).getByLabel('Workspace name')
    await name.fill('Orbit Crew')
    await name.press('Enter')
    await expect(page.locator('aside.sb .sb-head__name')).toHaveText('Orbit Crew')

    // the viewer: the same lists, no tools
    await openApp(viewer, wsId)
    await waitOnline(viewer)
    await openPeople(viewer)
    await expect(viewer.getByTestId('ws-spec')).toContainText('VIEWER')
    await expect(wsPage(viewer).getByTestId('member')).toHaveCount(2)
    await expect(wsPage(viewer).getByLabel(/^Role of /)).toHaveCount(0)
    await expect(wsPage(viewer).getByTestId('invite-form')).toHaveCount(0)
    await expect(wsPage(viewer).getByText('Only admins and the owner can invite people.')).toBeVisible()
    await expect(wsPage(viewer).getByTestId('ws-add-person')).toHaveCount(0)
    await expect(wsPage(viewer).getByTestId('ws-person')).toContainText('Grace Contractor')
    await expect(wsPage(viewer).getByRole('button', { name: /Actions for/ })).toHaveCount(0)
    await wsPage(viewer).getByRole('link', { name: /Overview/ }).click()
    await expect(wsPage(viewer).getByLabel('Workspace name')).toBeDisabled()
    await viewer.context().close()
  })
})
