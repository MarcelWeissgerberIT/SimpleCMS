import { chromium } from 'playwright'
const base = 'http://127.0.0.1:5203/SimpleCMS/app/?e2e'
const out = '/home/user/SimpleCMS/.shots'
const browser = await chromium.launch()
for (const dark of [false, true]) {
  for (const mobile of [true, false]) {
    const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', isMobile: mobile, hasTouch: mobile })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(base)
    await page.waitForFunction(() => !!window.__one, null, { timeout: 30000 })
    await page.waitForTimeout(1200)
    const tag = `${mobile ? 390 : 1440}-${dark ? 'dark' : 'light'}`
    // locked database
    const dbId = await page.evaluate(() => { const s = window.__one.workspace.getState(); const p = Object.values(s.pages).find((p) => p.title === 'Projects'); s.updateDatabase(p.id, { locked: true }); return p.id })
    await page.evaluate((id) => (location.hash = `#/p/${id}`), dbId)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${out}/rv-locked-${tag}.png` })
    // automations modal with the locked recipe hint
    await page.locator('#main section.db').first().getByRole('button', { name: 'Automations' }).click().catch(() => {})
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}/rv-autos-${tag}.png` })
    await page.keyboard.press('Escape')
    // synced block page with a date mention + reminder
    const pid = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const id = s.createPage({ title: 'Synced review' })
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] }, { type: 'syncedBlock', attrs: { syncId: 'shot-sync', sourcePageId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship on ' }, { type: 'mention', attrs: { id: '2026-10-20T10:30', label: 'Oct 20', kind: 'date', reminder: '-15m' } }] }] }] }, 'shot')
      return id
    })
    await page.evaluate((id) => (location.hash = `#/p/${id}`), pid)
    await page.waitForTimeout(1200)
    await page.locator('.mention__date').first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/rv-synced-date-${tag}.png` })
    if (errors.length) console.log(tag, 'ERRORS', errors)
    await ctx.close()
  }
}
await browser.close()
console.log('done')
