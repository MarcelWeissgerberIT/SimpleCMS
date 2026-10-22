import { readFileSync, readdirSync } from 'node:fs'
import { parseArticle, type Inline } from '../../src/app/help/markdown'
import { test, expect, openApp, wsEval } from './fixtures'
import { createKeyboardLabels } from '../../src/shared/keyboard.js'
import type { Page } from '@playwright/test'

const systems = [
  { name: 'Windows', platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', mod: 'Control', search: 'Ctrl+K', newPage: 'Ctrl+Alt+N' },
  { name: 'macOS', platform: 'MacIntel', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', mod: 'Meta', search: '⌘K', newPage: '⌘⌥N' },
  { name: 'Linux', platform: 'Linux x86_64', ua: 'Mozilla/5.0 (X11; Linux x86_64)', mod: 'Control', search: 'Ctrl+K', newPage: 'Ctrl+Alt+N' },
]
async function platform(page: Page, system: typeof systems[number], lang: string) {
  await page.addInitScript(({ system, lang }) => {
    Object.defineProperty(navigator, 'platform', { get: () => system.platform })
    Object.defineProperty(navigator, 'userAgent', { get: () => system.ua })
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: system.name }) })
    localStorage.setItem('one.lang', lang)
  }, { system, lang })
}

test('OS hints take precedence; legacy browsers and non-browser rendering have safe fallbacks', () => {
  expect(createKeyboardLabels({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }).isMac).toBe(false)
  expect(createKeyboardLabels({ platform: 'MacIntel' }).isMac).toBe(true)
  expect(createKeyboardLabels({ userAgent: 'Mozilla iPad' }).isMac).toBe(true)
  expect(createKeyboardLabels().label('Mod+K')).toBe('Ctrl+K')
  for (const s of systems) {
    const keys = createKeyboardLabels({ userAgentData: { platform: s.name } })
    expect(keys.label('Mod+Alt+N')).toBe(s.newPage)
    expect(keys.text('Suche ⌘K')).toBe(`Suche ${s.search}`)
    expect(keys.label('+')).toBe('+')
    expect(keys.label('constructor')).toBe('constructor')
    expect(keys.label('Mod++')).toBe(s.name === 'macOS' ? '⌘+' : 'Ctrl++')
    expect(keys.text('Mod+K')).toBe(s.search)
    expect(keys.text('⌘Z / Strg+Z')).toBe(s.name === 'macOS' ? '⌘Z' : 'Ctrl+Z')
    expect(keys.text('⌘/Strg-Klick')).toBe(s.name === 'macOS' ? '⌘-Klick' : 'Ctrl-Klick')
  }
})

for (const system of systems) for (const lang of ['de', 'en']) {
  test(`${system.name} / ${lang}: sidebar, working shortcuts, translated help and public help agree`, async ({ page }) => {
    await platform(page, system, lang)
    await openApp(page)
    await wsEval(page, (s, lang) => s.updateSettings({ language: lang }), lang)
    const search = page.locator('.sb-nav').getByRole('button', { name: lang === 'de' ? /Suchen/ : /Search/ }).first()
    await expect(search).toContainText(system.search)
    if (system.name === 'Windows' && lang === 'de') {
      const count = await wsEval(page, (s) => Object.keys(s.pages).length)
      // AltGr on European layouts must not accidentally become a global Ctrl+Alt shortcut.
      await page.evaluate(() => {
        const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, altKey: true, bubbles: true })
        Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'AltGraph' })
        window.dispatchEvent(event)
      })
      expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(count)
      await page.keyboard.press('Control+Alt+n')
      await expect.poll(() => wsEval(page, (s) => Object.keys(s.pages).length)).toBe(count + 1)
    }
    // Exercise the actual matching modifier, not only the label formatter.
    await page.keyboard.press(`${system.mod}+k`)
    await expect(page.locator('.pal-input')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${system.mod}+/`)
    const help = page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })
    await expect(help.locator('.keysheet')).toContainText(system.newPage)
    const legend = await help.locator('.keysheet').innerText()
    expect(legend).not.toContain('Mod+')
    if (system.name !== 'macOS') expect(legend).not.toMatch(/[⌘⌥⇧⌃]/)
    await help.getByRole('tab', { name: lang === 'de' ? /Handbuch/ : /Manual/ }).click()
    await help.getByRole('searchbox').fill(lang === 'de' ? 'Suche Filter' : 'Search filters')
    await help.locator('.help-hit').first().click()
    await expect(help.locator('.help-art__title')).toContainText(system.search)
    if (system.name !== 'macOS') expect(await help.locator('.help-doc').innerText()).not.toMatch(/[⌘⌥⇧⌃]/)
    if (lang === 'de' && system.name !== 'Linux') await page.screenshot({ path: `test-results/shortcuts-${system.name}.png` })

    // The public manual is prerendered once; the visitor's OS decides at runtime.
    const prefix = lang === 'de' ? 'help/de/' : 'help/'
    for (const article of ['keyboard-shortcuts', 'command-palette', 'mcp-servers', 'preflight', 'outbox']) {
      await page.goto(prefix + article + '/')
      await expect(page.locator('main')).toBeVisible()
      if (system.name !== 'macOS') expect(await page.locator('main').innerText(), article).not.toMatch(/[⌘⌥⇧⌃]|Mod\+/)
      if (article === 'keyboard-shortcuts') await expect(page.locator('kbd[data-keys="Mod+Alt+N"]')).toHaveText(system.newPage)
      if (article === 'command-palette') await expect(page.locator('h1')).toContainText(system.search)
    }
    await page.goto(prefix)
    await page.getByRole('searchbox').fill(lang === 'de' ? 'Suche Filter' : 'Search filters')
    await expect(page.locator('#results')).toBeVisible()
    if (system.name !== 'macOS') expect(await page.locator('#results').innerText()).not.toMatch(/[⌘⌥⇧⌃]/)
  })
}

// Audit the complete current manual, including prose that never passes through a <kbd>.
test('every current article and metadata renders without Mac modifier glyphs on Windows', () => {
  const keys = createKeyboardLabels({ platform: 'Win32' })
  const inline = (nodes: Inline[]): string => nodes.map((n) => n.t === 'text' ? keys.text(n.v) : n.t === 'kbd' ? keys.label(n.v) : 'c' in n ? inline(n.c) : n.v).join('')
  for (const lang of ['de', 'en']) {
    const dir = new URL(`../../src/app/help/articles/${lang}/`, import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const a = parseArticle(readFileSync(new URL(file, dir), 'utf8'))
      const body = a.blocks.map((b) => b.t === 'pre' ? b.v : 'items' in b ? b.items.map(inline).join(' ') : inline(b.c)).join(' ')
      expect(keys.text(a.title + ' ' + a.summary) + body, `${lang}/${file}`).not.toMatch(/[⌘⌥⇧⌃]/)
    }
  }
})
