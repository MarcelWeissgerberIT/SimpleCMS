import { test, expect, openApp, wsEval, MOD, sse } from './fixtures'

for (const width of [1440, 390]) {
  test(`a pending question shows elapsed time and clears it on ${width === 1440 ? 'completion' : 'stop'} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.install()
    await openApp(page)
    await wsEval(page, s => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    let release!: () => void, finish!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const finished = new Promise<void>(resolve => { finish = resolve })
    let pending = false
    await page.route('https://api.anthropic.com/**', async route => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      pending = true
      await held
      try { await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('A branch keeps a separate line of development.') }) }
      catch { /* Stop aborts the pending request. */ }
      finally { finish() }
    })
    await page.keyboard.press(`${MOD}+k`)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    const input = palette.getByRole('combobox', { name: 'Command palette', exact: true })
    await input.fill('? Explain a Git branch.')
    await input.press('Enter')
    const activity = page.getByTestId('ask-activity')
    try {
      await expect.poll(() => pending).toBe(true)
      await expect(activity).toContainText('The model is preparing your answer')
      await expect(palette.locator('.ask__answer')).toHaveCount(0)
      await page.clock.fastForward(2200)
      await expect(page.getByTestId('ask-elapsed')).toHaveText('2 s')
      await page.screenshot({ path: info.outputPath(`ask-working-${width}.png`), animations: 'disabled' })
      expect(await palette.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      if (width === 390) {
        await palette.getByRole('button', { name: 'Stop', exact: true }).click()
        await expect(palette).toContainText('Request stopped.')
        await expect(activity).toHaveCount(0)
        release(); await finished
        await expect(palette.locator('.ask__answer')).toHaveCount(0)
      } else {
        release(); await finished
        await expect(palette.locator('.ask__answer')).toContainText('A branch keeps a separate line')
        await expect(activity).toHaveCount(0)
        await expect(palette.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      }
    } finally { release() }
  })
}
