import { test, expect, openApp, wsEval, uiEval } from './fixtures'

// Regression: opening Settings directly used to leave this matrix unstyled until
// the separate setup wizard had loaded its CSS. No model request is needed here.
for (const width of [1440, 390]) {
  test(`worker data permissions load independently and remain editable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await openApp(page)
    await wsEval(page, s => {
      s.updateSettings({ language: 'de' })
      s.setWorkspaceAI({ policy: { restricted: [], providers: { local: { allow: ['public', 'structure', 'selection', 'page', 'rows', 'workspace'] } } } })
    })
    await uiEval(page, s => s.openModal({ type: 'settings', tab: 'ai' }))
    const matrix = page.getByTestId('worker-model-settings').getByTestId('data-rules')
    const rows = matrix.getByRole('row')
    await expect(rows).toHaveCount(10)
    await expect(rows.first()).toHaveCSS('display', 'grid')
    await expect(matrix.getByRole('rowheader').first()).toHaveCSS('flex-direction', 'column')
    const selection = matrix.locator('[data-cell="local:selection"]')
    const files = matrix.locator('[data-cell="local:files"]')
    await expect(selection).toHaveAttribute('aria-checked', 'true')
    await expect(files).toHaveAttribute('aria-checked', 'false')
    await files.click()
    await expect(files).toHaveAttribute('aria-checked', 'true')
    expect(await wsEval(page, s => s.ai?.policy?.providers?.local?.allow)).toEqual(['public', 'structure', 'selection', 'page', 'rows', 'workspace', 'files'])
    await files.click()
    await expect(files).toHaveAttribute('aria-checked', 'false')
    await expect(selection).toHaveAttribute('aria-checked', 'true')
    await matrix.scrollIntoViewIfNeeded()
    const geometry = await matrix.evaluate(el => {
      const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
      return { overflow: el.scrollWidth > el.clientWidth, lefts: buttons.map(b => Math.round(b.getBoundingClientRect().left)), visibleHints: [...el.querySelectorAll('.drules__cls small')].every(e => getComputedStyle(e).display !== 'none') }
    })
    expect(geometry.overflow).toBe(false)
    expect(new Set(geometry.lefts).size).toBe(1)
    expect(geometry.visibleHints).toBe(true)
    await rows.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`data-rules-${width}.png`), animations: 'disabled' })
  })
}
