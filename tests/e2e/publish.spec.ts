import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { test, expect, openApp, gotoPage, createPage, doc, para, heading, pageIdByTitle, MOD } from './fixtures'

type Files = Record<string, Uint8Array>

const BASE = 'https://example.github.io/handbook/'

/** Open the export dialog for the current page (command palette, like a user). */
async function openExport(page: Page): Promise<Locator> {
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.type('>export')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio', { name: /Website/ })).toBeVisible()
  return dialog
}

/** Choose "Website", run the export, capture the download and unzip it. */
async function exportSite(page: Page, dialog: Locator, opts: { baseUrl?: string } = {}): Promise<{ files: Files; name: string }> {
  await dialog.getByRole('radio', { name: /Website/ }).click()
  if (opts.baseUrl !== undefined) await dialog.getByLabel(/Base URL/).fill(opts.baseUrl)
  const download = page.waitForEvent('download')
  await dialog.locator('[data-export-run]').click()
  const d = await download
  const path = await d.path()
  await expect(dialog.getByRole('status')).toContainText(/files/)
  return { files: unzipSync(new Uint8Array(readFileSync(path))), name: d.suggestedFilename() }
}

const text = (files: Files, path: string) => {
  expect(files[path], `${path} in the zip`).toBeDefined()
  return strFromU8(files[path])
}

/** Every relative href/src of every HTML page must point at a file inside the zip. */
function brokenLinks(files: Files): string[] {
  const out: string[] = []
  for (const [path, data] of Object.entries(files)) {
    if (!path.endsWith('.html') || path === '404.html') continue
    const html = strFromU8(data)
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const raw = m[1].replace(/&amp;/g, '&')
      if (/^(https?:|mailto:|tel:|data:|#)/.test(raw)) continue
      const target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(raw.split('#')[0])))
      if (!(target in files)) out.push(`${path} → ${raw}`)
    }
  }
  return out
}

function unpack(files: Files, dir: string) {
  for (const [p, data] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), data)
  }
}

test.describe('publish as website', () => {
  test('the seeded workspace becomes a static site: pages, databases, media, sitemap, feeds, llms.txt', async ({ page, browser }, testInfo) => {
    await openApp(page)
    const dialog = await openExport(page)
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Website/ }).click()
    // an invalid base URL blocks the export, a valid one is accepted
    await dialog.getByLabel(/Base URL/).fill('not a url')
    await expect(dialog.getByText(/Enter a web address/)).toBeVisible()
    await expect(dialog.locator('[data-export-run]')).toBeDisabled()
    await expect(dialog.getByText('How to put it online')).toBeVisible()
    const { files, name } = await exportSite(page, dialog, { baseUrl: 'example.github.io/handbook' })
    expect(name).toMatch(/-site\.zip$/)

    // structure
    for (const f of ['index.html', 'index.md', '404.html', 'assets/site.css', 'assets/favicon.svg', 'robots.txt', 'rss.xml', 'llms.txt', 'llms-full.txt', 'content.json', 'sitemap.xml'])
      expect(files[f], f).toBeDefined()
    expect(Object.keys(files).filter((f) => /^assets\/fonts\/.+\.woff2$/.test(f)).length).toBeGreaterThanOrEqual(2)
    expect(text(files, 'assets/site.css')).toContain('--signal')
    expect(text(files, 'assets/site.css')).toContain('prefers-color-scheme: dark')

    // a known page with its heading, breadcrumbs and Markdown twin
    const brand = text(files, 'team-wiki/brand-voice/index.html')
    expect(brand).toMatch(/<h1 class="title">Brand voice<\/h1>/)
    expect(brand).toMatch(/<h[2-4][^>]*>Principles<\/h[2-4]>/)
    expect(brand).toContain('<link rel="canonical" href="https://example.github.io/handbook/team-wiki/brand-voice/">')
    expect(brand).toContain('href="../index.html">Team wiki</a>')
    expect(text(files, 'team-wiki/brand-voice/index.md')).toMatch(/^# Brand voice\n/)
    // mentions point inside the site, nothing points into the app
    expect(text(files, 'team-wiki/onboarding/index.html')).toContain('href="../../projects/index.html"')
    for (const [p, data] of Object.entries(files)) {
      if (!p.endsWith('.html')) continue
      const html = strFromU8(data)
      expect(html, p).not.toContain('#/p/')
      expect(html, p).not.toContain('onefile:')
      expect(html, p).not.toMatch(/<script/i)
    }
    expect(brokenLinks(files)).toEqual([])

    // databases: a read-only table with every row, each linking to its page
    const projects = text(files, 'projects/index.html')
    expect(projects).toContain('<table class="dbt">')
    for (const row of ['Website relaunch', 'Brand refresh', 'AI support assistant']) expect(projects).toContain(row)
    expect(projects).toContain('href="website-relaunch/index.html"')
    expect(text(files, 'projects/website-relaunch/index.html')).toContain('<dl class="props">')

    // media: the welcome cover is copied and referenced relatively
    expect(files['media/covers/paper-folds.webp']).toBeDefined()
    expect(text(files, 'welcome-to-one/index.html')).toContain('src="../media/covers/paper-folds.webp"')

    // sitemap: absolute URLs under the base URL, one per page
    const sitemap = text(files, 'sitemap.xml')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toContain(BASE)
    expect(locs).toContain(`${BASE}team-wiki/brand-voice/`)
    expect(locs.every((l) => l.startsWith(BASE))).toBe(true)
    expect(locs.length).toBe(Object.keys(files).filter((f) => f.endsWith('index.html')).length)
    expect(text(files, 'robots.txt')).toContain(`Sitemap: ${BASE}sitemap.xml`)

    // llms.txt lists the pages (their Markdown), and every listed file exists
    const llms = text(files, 'llms.txt')
    expect(llms).toMatch(/^# .+\n\n> .+/)
    expect(llms).toContain(`[Brand voice](${BASE}team-wiki/brand-voice/index.md)`)
    const listed = [...llms.matchAll(/\]\((https:[^)]+)\)/g)].map((m) => m[1].slice(BASE.length))
    expect(listed.length).toBeGreaterThan(20)
    for (const f of listed.filter((l) => l.endsWith('.md'))) expect(files[f], f).toBeDefined()
    expect(text(files, 'llms-full.txt')).toContain('# Brand voice')

    // feed + data
    const rss = text(files, 'rss.xml')
    expect(rss).toContain('<rss version="2.0"')
    expect(rss).toMatch(/<item>[\s\S]*<link>https:\/\/example\.github\.io\/handbook\/[^<]*<\/link>/)
    const content = JSON.parse(text(files, 'content.json'))
    const entry = content.pages.find((p: { title: string }) => p.title === 'Brand voice')
    expect(entry).toMatchObject({ slug: 'brand-voice', path: 'team-wiki/brand-voice/index.html', url: `${BASE}team-wiki/brand-voice/` })
    const row = content.pages.find((p: { title: string }) => p.title === 'Website relaunch')
    expect(row.properties.Status).toBe('In progress')

    // the site works straight from the folder: navigate from the index to a sub page, no errors
    const dir = testInfo.outputPath('site')
    unpack(files, dir)
    const ctx = await browser.newContext({ offline: true })
    const p = await ctx.newPage()
    const errs: string[] = []
    p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(pathToFileURL(join(dir, 'index.html')).href)
    await expect(p.locator('.hero__title')).toBeVisible()
    await p.locator('.card', { hasText: 'Team wiki' }).click()
    await expect(p.locator('h1.title')).toHaveText('Team wiki')
    await p.locator('.nav').getByRole('link', { name: /Brand voice/ }).click()
    await expect(p.locator('h1.title')).toHaveText('Brand voice')
    await expect(p.locator('.nav [aria-current="page"]')).toContainText('Brand voice')
    expect(errs).toEqual([])
    await ctx.close()
  })

  test('scope "this page and its sub-pages" exports only that subtree', async ({ page }) => {
    await openApp(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    // a sub page with an image and a file from IndexedDB, and a title full of markup
    await page.evaluate(async () => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
      const files: Array<[string, Blob, string]> = [
        ['e2eimg000001', new Blob([png], { type: 'image/png' }), 'Diagram Final.png'],
        ['e2epdf000001', new Blob(['%PDF-1.4 e2e'], { type: 'application/pdf' }), 'Spec sheet.pdf'],
      ]
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('one-files')
        req.onupgradeneeded = () => req.result.createObjectStore('files')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          for (const [id, blob, name] of files) tx.objectStore('files').put({ blob, name, type: blob.type, size: blob.size, createdAt: 1 }, id)
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    })
    await createPage(page, {
      title: 'Media <b>&</b> "Files"',
      parentId: wiki,
      content: doc(para('Figures below.'), { type: 'image', attrs: { src: 'onefile:e2eimg000001', alt: 'Diagram' } }, { type: 'fileBlock', attrs: { src: 'onefile:e2epdf000001', name: 'Spec sheet.pdf', size: 12 } }),
    })
    await gotoPage(page, wiki)
    const dialog = await openExport(page)
    await dialog.getByRole('radio', { name: /Team wiki/ }).click()
    await dialog.getByRole('radio', { name: /Website/ }).click()
    await expect(dialog.getByText(/No base URL/)).toBeVisible()
    await expect(dialog.locator('[data-site-pages]')).toContainText('6')
    const { files } = await exportSite(page, dialog)

    const pages = Object.keys(files).filter((f) => f.endsWith('.html') && f !== '404.html').sort()
    expect(pages).toEqual(['brand-voice/index.html', 'glossary/index.html', 'index.html', 'media-b-b-files/index.html', 'onboarding/index.html', 'tooling-automations/index.html'])
    // the scope root is the home page
    expect(text(files, 'index.html')).toMatch(/<h1 class="title">Team wiki<\/h1>/)
    // no sitemap without a base URL
    expect(files['sitemap.xml']).toBeUndefined()
    // links to pages outside the scope become plain text
    const onboarding = text(files, 'onboarding/index.html')
    expect(onboarding).toContain('Projects')
    expect(onboarding).not.toMatch(/href="[^"]*projects/)
    expect(onboarding).toContain('href="../brand-voice/index.html"')
    for (const html of pages.map((p) => text(files, p))) {
      expect(html).not.toContain('Welcome to One')
      expect(html).not.toContain('#/p/')
    }
    expect(brokenLinks(files)).toEqual([])
    const content = JSON.parse(text(files, 'content.json'))
    expect(content.pages.map((p: { title: string }) => p.title).sort()).toEqual(['Brand voice', 'Glossary', 'Media <b>&</b> "Files"', 'Onboarding', 'Team wiki', 'Tooling & automations'])

    // files from IndexedDB are copied into media/ and referenced relatively; titles are escaped
    expect(files['media/diagram-final.png']).toBeDefined()
    expect(strFromU8(files['media/spec-sheet.pdf'])).toBe('%PDF-1.4 e2e')
    const media = text(files, 'media-b-b-files/index.html')
    expect(media).toContain('<h1 class="title">Media &lt;b&gt;&amp;&lt;/b&gt; &quot;Files&quot;</h1>')
    expect(media).not.toContain('<b>&amp;</b>')
    expect(media).toContain('src="../media/diagram-final.png"')
    expect(media).toContain('href="../media/spec-sheet.pdf"')
    expect(text(files, 'media-b-b-files/index.md')).toContain('](../media/diagram-final.png)')
  })
})

test.describe('password-protected share link', () => {
  test('encrypted link: a wrong password shows an error, the right one opens the page', async ({ page, browser, errors }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Secret plan', content: doc(heading(2, 'Phase one'), para('the vault code is 4711')) })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const url = dialog.getByRole('textbox', { name: 'Share link' })
    await expect(url).toHaveValue(/#\/s\/(?!e1\.)[\w-]+$/)
    const plain = await url.inputValue()

    await dialog.getByRole('switch', { name: 'Protect with password' }).click()
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeDisabled()
    await expect(dialog.getByText(/never leaves this device/)).toBeVisible()
    await dialog.getByLabel('Password', { exact: true }).fill('correct horse battery')
    await expect(url).toHaveValue(/#\/s\/e1\.[\w-]+$/, { timeout: 15_000 })
    const link = await url.inputValue()
    // the page itself is not readable from the link
    expect(link).not.toBe(plain)
    expect(Buffer.from(link.split('e1.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')).not.toContain('vault code')

    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    await expect(p2.getByRole('heading', { name: 'This page is password-protected' })).toBeVisible()
    await expect(p2.locator('.shv__doc')).toHaveCount(0)
    const input = p2.getByRole('textbox', { name: 'Password' })
    await expect(input).toBeFocused()

    // wrong password: clear error, no crash, can retry
    await input.fill('wrong guess')
    await input.press('Enter')
    await expect(p2.getByRole('alert')).toHaveText('Wrong password. Check it and try again.', { timeout: 15_000 })
    await expect(p2.locator('.shv__title')).toHaveCount(0)

    // right password: the page, exactly like an unprotected link
    await input.fill('correct horse battery')
    await p2.getByRole('button', { name: 'Unlock' }).click()
    await expect(p2.locator('.shv__title')).toHaveText('Secret plan', { timeout: 15_000 })
    await expect(p2.locator('.shv__doc')).toContainText('the vault code is 4711')
    await expect(p2.locator('.shv__doc h3')).toHaveText('Phase one')
    await p2.getByRole('button', { name: /Save to my workspace/ }).click()
    await expect(p2.locator('#main .pv-title')).toHaveValue('Secret plan')
    await expect(p2.locator('#main .ProseMirror')).toContainText('the vault code is 4711')
    await other.close()
  })
})
