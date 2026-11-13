import { test, expect, openApp, wsEval, MOD } from './fixtures'
import { setKey, terminal } from './helpers/terminal'

for (const theme of ['light', 'dark']) {
  test(`script actions remain reachable beside a wide terminal (${theme})`, async ({ page }, info) => {
    await openApp(page)
    await setKey(page)
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
    await wsEval(page, s => s.upsertScript({
      id: 'layout-script', name: 'Security Register: consolidate source sections',
      kind: 'script', code: 'return 42', createdAt: Date.now(), updatedAt: Date.now(),
    }))
    await page.evaluate(() => { location.hash = '#/scripts' })
    const row = page.getByTestId('sc-row').filter({ hasText: 'Security Register' })
    await expect(row).toBeVisible()
    await page.keyboard.press(`${MOD}+j`)
    await terminal(page).getByRole('button', { name: 'Beside page', exact: true }).click()
    const divider = terminal(page).getByRole('separator', { name: 'Resize terminal width', exact: true })
    await divider.focus()
    await divider.press('End')
    for (const width of [1440, 2048, 390]) {
      await page.setViewportSize({ width, height: 900 })
      if (width === 390) await page.keyboard.press(`${MOD}+j`)
      if (width > 1000) { await divider.focus(); await divider.press('End') }
      for (const button of await row.getByRole('button').all()) {
        await expect(button).toBeVisible()
        const bounds = await button.boundingBox()
        const stage = await page.locator('.stage-col').first().boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(stage!.x)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1)
        await button.click({ trial: true })
      }
      await expect(row.getByText('Dry run', { exact: true })).toBeVisible()
      await expect(row.getByText('Run', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath(`scripts-${width}.png`) })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.keyboard.press(`${MOD}+j`)
    await row.getByRole('link').click()
    await expect(page.locator('.sc-code__input')).toBeVisible()
    for (const button of await page.locator('.sc-workflow').getByRole('button').all()) {
      await button.click({ trial: true })
      const bounds = await button.boundingBox()
      const stage = await page.locator('.stage-col').first().boundingBox()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1)
    }
  })
}
