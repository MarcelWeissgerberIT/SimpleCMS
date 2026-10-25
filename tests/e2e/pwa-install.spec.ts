import { mkdir } from 'node:fs/promises'
import { test, expect, openApp } from './fixtures'
import type { Page } from '@playwright/test'

const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'

async function browserIdentity(page: Page, ua: string, language = 'en') {
  await page.addInitScript(({ ua, language }) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => ua })
    localStorage.setItem('one.lang', language)
    localStorage.setItem('one.introSeen', '1')
    localStorage.setItem('one.tour', JSON.stringify({ off: true }))
  }, { ua, language })
}

async function prompt(page: Page, outcome: 'accepted' | 'dismissed' | 'error') {
  return page.evaluate((outcome) => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
    event.prompt = async () => {
      const state = window as unknown as { __installCalls?: number }
      state.__installCalls = (state.__installCalls || 0) + 1
      if (outcome === 'error') throw new Error('Install unavailable')
    }
    event.userChoice = Promise.resolve({ outcome })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, outcome)
}

test.use({ reducedMotion: 'reduce' })

test('website offers Windows installation without a prompt and serves the app manifest under the deploy base', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE)
  await page.goto('?skip')
  const key = page.getByRole('button', { name: 'Install as app', exact: true })
  await expect(key).toBeVisible()
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/SimpleCMS/manifest.webmanifest')
  const response = await page.request.get(href!)
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(new URL(manifest.start_url, response.url()).pathname).toBe('/SimpleCMS/app/')
  await key.click()
  const guide = page.getByRole('dialog', { name: 'Install One as a desktop app' })
  await expect(guide).toContainText('Microsoft Edge')
  await expect(guide).toContainText('Start or the taskbar')
  await expect(guide).toContainText('No coding worker is needed')
  await expect(guide.getByRole('link', { name: 'Open the workspace' })).toHaveAttribute('href', '/SimpleCMS/app/')
  await guide.getByRole('button', { name: 'Got it' }).click()
  await expect(guide).not.toBeVisible()
  await expect(key).toBeFocused()
})

test('Safari on Mac gets Dock instructions in both entry points, without claiming a native website prompt', async ({ page }) => {
  await browserIdentity(page, MAC_SAFARI)
  await page.goto('?skip')
  await page.getByRole('button', { name: 'Install as app' }).click()
  const siteGuide = page.getByRole('dialog', { name: 'Install One as a desktop app' })
  await expect(siteGuide).toContainText('File → Add to Dock')
  await expect(siteGuide).toContainText('macOS Sonoma 14')
  await expect(siteGuide).toContainText('separate storage')
  await openApp(page)
  await page.locator('aside.sb .sb-head__ws').click()
  await page.getByRole('menuitem', { name: 'Install One', exact: true }).click()
  const appGuide = page.getByRole('dialog', { name: 'Install One as a desktop app' })
  await expect(appGuide).toContainText('File → Add to Dock')
  await expect(appGuide).toContainText('separate storage')
})

test('native prompt is consumed once, dismissal leaves the manual desktop path available, and appinstalled hides the key', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE)
  await page.goto('?skip')
  const key = page.getByRole('button', { name: 'Install as app' })
  await expect(key).toBeVisible()
  expect(await prompt(page, 'dismissed')).toBe(true)
  await key.click()
  expect(await page.evaluate(() => (window as unknown as { __installCalls: number }).__installCalls)).toBe(1)
  await key.click()
  await expect(page.getByRole('dialog', { name: 'Install One as a desktop app' })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await prompt(page, 'accepted')).toBe(true)
  await key.click()
  await expect(key).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __installCalls: number }).__installCalls)).toBe(2)
  await page.reload()
  await expect(key).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(key).toBeHidden()
  await expect(page.getByRole('button', { name: 'Install One', exact: true, includeHidden: true })).toBeHidden()
})

test('failed install prompt falls back to instructions; unsupported desktop browsers get supported-browser guidance', async ({ page }) => {
  await browserIdentity(page, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0')
  await page.goto('?skip')
  await expect(page.getByRole('button', { name: 'Install as app' })).toBeVisible()
  await prompt(page, 'error')
  await page.getByRole('button', { name: 'Install as app' }).click()
  const guide = page.getByRole('dialog', { name: 'Install One as a desktop app' })
  await expect(guide).toContainText('Edge or Chrome on Windows')
  await expect(guide).toContainText('ask IT')
  await expect(guide).toContainText('does not check a team workspace out of the cloud')
})

test('installed display-mode suppresses the website key too', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE)
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window)
    window.matchMedia = (query) => query.includes('display-mode: standalone')
      ? { ...match(query), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList
      : match(query)
  })
  await page.goto('?skip')
  await expect(page.locator('.hero')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Install as app', includeHidden: true })).toBeHidden()
})

test('German instructions and website language switching remain usable at desktop/mobile sizes in both themes', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE, 'de')
  await page.goto('?skip')
  await expect(page.getByRole('button', { name: 'Als App installieren', exact: true })).toBeVisible()
  await page.locator('[data-lang="en"]').click()
  await expect(page.getByRole('button', { name: 'Install as app', exact: true })).toBeVisible()
  await page.locator('[data-lang="de"]').click()
  await mkdir('.shots/pwa-install', { recursive: true })
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
      await page.getByRole('button', { name: 'Als App installieren', exact: true }).click()
      const guide = page.getByRole('dialog', { name: 'One als Desktop-App installieren' })
      await expect(guide).toContainText('Start oder die Taskleiste')
      await expect(guide).toContainText('kein Coding-Worker')
      const box = (await guide.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `.shots/pwa-install/guide-${width}-${theme}.png` })
      await guide.getByRole('button', { name: 'Verstanden' }).click()
      await page.screenshot({ path: `.shots/pwa-install/website-${width}-${theme}.png` })
    }
  }
})

test('workspace toolbar offers direct installation in a regular fullscreen tab, even without a native prompt', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE)
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window)
    window.matchMedia = query => query.includes('display-mode: fullscreen')
      ? { ...match(query), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList
      : match(query)
  })
  await openApp(page)
  const key = page.getByTestId('install-one-topbar')
  await expect(key).toBeVisible()
  await expect(key).toHaveAccessibleName('Install as app')
  await key.click()
  const guide = page.getByRole('dialog', {name:'Install One as a desktop app'})
  await expect(guide).toContainText('Microsoft Edge')
  await guide.getByRole('button', {name:'Got it'}).click()
  await page.setViewportSize({width:390,height:844})
  await expect(key).toBeVisible()
  const box = (await key.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await key.click()
  await expect(guide).toBeVisible()
})

test('workspace toolbar consumes a native install prompt and hides after acceptance', async ({ page }) => {
  await browserIdentity(page, WINDOWS_EDGE)
  await openApp(page)
  expect(await prompt(page, 'accepted')).toBe(true)
  await page.getByTestId('install-one-topbar').click()
  expect(await page.evaluate(() => (window as unknown as {__installCalls:number}).__installCalls)).toBe(1)
  await expect(page.getByTestId('install-one-topbar')).toHaveCount(0)
})
