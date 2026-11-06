import { test, expect } from './fixtures'

test('slow sign-in keeps the submitted address and sends one request; timeout offers a retry', async ({ page }) => {
  await page.goto('/app/')
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: /Sign in to the team cloud/ }).click()
  const dialog = page.getByRole('dialog')
  await page.clock.install()
  let count = 0
  let release!: () => void
  const pending = new Promise<void>(r => { release = r })
  await page.route('**/api/auth/request', async route => {
    count++
    if (count === 1) {
      await pending
      await route.fulfill({ status: 204 }).catch(() => {})
    } else await route.fulfill({ status: 204 })
  })
  const address = dialog.getByLabel('Email')
  await address.fill('slow@example.test')
  await address.press('Enter')
  await expect.poll(() => count).toBe(1)
  await expect(address).toHaveAttribute('readonly', '')
  await address.press('Enter')
  await page.clock.runFor(5100)
  await expect(dialog.getByRole('status')).toContainText('taking a little longer')
  expect(count).toBe(1)
  await page.clock.runFor(25_000)
  await expect(dialog.getByRole('alert')).toContainText('Check your inbox before trying again')
  await expect(dialog.getByRole('button', { name: /Send sign-in link/ })).toBeEnabled()
  await expect(address).toHaveValue('slow@example.test')
  release()
  await dialog.getByRole('button', { name: /Send sign-in link/ }).click()
  await expect(dialog.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible()
  await expect(dialog.locator('.cl-addr')).toHaveText('slow@example.test')
  expect(count).toBe(2)
})
