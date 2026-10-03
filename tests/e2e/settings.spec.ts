import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'

test.describe('settings', () => {
  test('switch the language to German: UI strings change and stick', async ({ page }) => {
    await openApp(page)
    const sidebar = page.locator('.sb')
    await expect(sidebar.getByRole('button', { name: /^Search/ })).toBeVisible()

    await page.keyboard.press(`${MOD}+,`)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('tab', { name: /General/ })).toBeVisible()
    await dialog.getByRole('radio', { name: /Deutsch/ }).click()
    // the open dialog itself switches language
    await expect(dialog.getByRole('tab', { name: /Allgemein/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await expect(sidebar.getByRole('button', { name: /^Suchen/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^Heute/ })).toBeVisible()
    await expect(sidebar.locator('section[aria-label="Seiten"]')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    expect(await wsEval(page, (s) => s.settings.language)).toBe('de')
    // content is not translated — only the interface
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')

    await reloadApp(page)
    await expect(sidebar.getByRole('button', { name: /^Suchen/ })).toBeVisible()
    // the landing page follows the chosen language
    await page.goto('./?skip')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test('appearance: dark theme ("Carbon")', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.keyboard.press(`${MOD}+,`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: /Appearance/ }).click()
    await dialog.getByRole('radio', { name: /Dark/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(dialog.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true')
    // the body actually turns dark
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const [r, g, b] = bg.match(/\d+/g)!.map(Number)
    expect(r + g + b).toBeLessThan(150)
    await page.keyboard.press('Escape')
    await reloadApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
