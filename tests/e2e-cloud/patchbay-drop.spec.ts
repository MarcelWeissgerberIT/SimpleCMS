/**
 * The Patchbay's profile drop in a team workspace (B12, plan §1.12 / §6 U25) against the real server:
 *  - an owner's drop holds for everyone: the toast's Undo says it "Removes the profile for all members", the member's
 *    store gets the profile, and the Undo takes it from the member's store too;
 *  - a member cannot drop: the head's chip explains who can (the owners and admins, named) and lists the profiles that
 *    are there to set up (that only reads); a file dropped anyway goes to the plate ("Only owners and admins add
 *    profiles: Mara Lind") and nothing is saved.
 * Every name is fictional (Nordlicht, Tessera, Mara Lind; tracker-cnsx.integration.json from tests/fixtures/patchbay.ts).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, wsEval, createWorkspace, join, api } from './fixtures'
import { profileFile, trackerCnsx } from '../fixtures/patchbay'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const FILE = 'tracker-cnsx.integration.json'

/** A file dropped on the Patchbay's bench (the same events a drag from the desktop fires). */
async function dropFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([text], name, { type: 'application/json' }))
      const target = document.querySelector('[data-testid="pb-bench"]') ?? document.querySelector('[data-testid="patchbay-page"]')!
      for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { name, text },
  )
}
const profiles = (p: Page) => wsEval(p, (s) => ((s.integrations ?? []) as AnyState[]).map((x) => `${x.id}:${x.name}`))
const toPatchbay = async (p: Page) => {
  await p.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(p.getByTestId('patchbay-page')).toBeVisible()
}

test('team: an owner’s drop holds for all members (its Undo says so and takes it from everyone); a member cannot drop — the chip names the owners and admins, a dropped file goes to the plate', async ({ page, context }) => {
  test.setTimeout(120_000)
  await signIn(page, email('mara'))
  expect((await api(page, 'PATCH', '/api/me', { name: 'Mara Lind' })).status).toBe(200)
  const wsId = await createWorkspace(page, 'Nordlicht Profile')
  const member = await newPerson(context)
  await signIn(member, email('tessera'))
  expect((await api(member, 'PATCH', '/api/me', { name: 'Tessera Nord' })).status).toBe(200)
  await join(page, member, wsId, 'member')
  for (const p of [page, member]) await p.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page, wsId)
  await waitOnline(page)
  await openApp(member, wsId)
  await waitOnline(member)

  // the owner drops: the band, and the toast's Undo is for everyone
  await toPatchbay(page)
  await dropFile(page, FILE, profileFile(trackerCnsx()))
  await expect(page.getByTestId('pb-band')).toBeVisible()
  const toast = page.locator('.toast').filter({ hasText: 'Profile “Tessera” dropped' }).last()
  await expect(toast).toContainText('Removes the profile for all members')
  await expect.poll(() => profiles(member)).toEqual(['in-01:Tessera'])
  // Undo: gone from the member's store too
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => profiles(page)).toEqual([])
  await expect.poll(() => profiles(member)).toEqual([])
  // dropped again (the member gets a profile to set up)
  await dropFile(page, FILE, profileFile(trackerCnsx()))
  await expect(page.getByTestId('pb-band')).toBeVisible()
  await expect.poll(() => profiles(member)).toEqual(['in-01:Tessera'])

  // the member: the chip explains who can drop, and offers the profile that is there
  await toPatchbay(member)
  await member.getByTestId('pb-drop').click()
  const who = member.getByTestId('pb-drop-members')
  await expect(who).toContainText('Only owners and admins add profiles')
  await expect(who).toContainText('Mara Lind can drop a profile here.')
  await expect(who.getByTestId('pb-members-setup')).toHaveAccessibleName('Set up in the Patchbay: Tessera')
  await member.keyboard.press('Escape')
  await expect(who).toHaveCount(0)
  // a file dropped anyway: the plate, the owners and admins named — nothing saved
  await dropFile(member, 'tessera-2.integration.json', profileFile(trackerCnsx({ id: 'in-02', name: 'Tessera Zwei' })))
  const plate = member.getByTestId('pb-dropplate')
  await expect(plate).toHaveAttribute('data-why', 'rights')
  await expect(plate).toContainText('Only owners and admins add profiles: Mara Lind')
  await expect(plate.getByTestId('pb-drop-choose')).toHaveCount(0)
  expect(await profiles(member)).toEqual(['in-01:Tessera'])
  await expect.poll(() => profiles(page)).toEqual(['in-01:Tessera'])
  // "Set up" from the chip opens the band for the member (it only reads); no Undo key there
  await plate.getByRole('button', { name: 'Close the message' }).click()
  await member.getByTestId('pb-drop').click()
  await member.getByTestId('pb-members-setup').click()
  await expect(member.getByTestId('pb-band')).toBeVisible()
  await expect(member.getByTestId('pb-band-undo')).toHaveCount(0)
  await member.context().close()
})
