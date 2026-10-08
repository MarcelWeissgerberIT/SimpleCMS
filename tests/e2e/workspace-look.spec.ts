/**
 * Workspace → Look (#/workspace/look): presets preview the whole tab, Save keeps the look for the workspace
 * (applied again before the app paints after a reload), Undo / Discard / Reset, contrast enforced and reported,
 * type and corners, the per-device "standard look", what stays standard (share links, the HTML export, page
 * backups), and the phone layout in German and Carbon.
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, gotoPage, pageIdByTitle, MOD } from './fixtures'

const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
/** A computed token as [r, g, b] (via a canvas pixel: any CSS colour syntax). */
const rgbOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement('span')
    el.style.color = `var(${n})`
    document.body.append(el)
    const css = getComputedStyle(el).color
    el.remove()
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')!
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, name)
const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const contrastOf = async (page: Page, a: string, b: string) => ratio(await rgbOf(page, a), await rgbOf(page, b))

async function openLook(page: Page) {
  await openApp(page, '#/workspace/look')
  await expect(page.getByTestId('look-section')).toBeVisible()
  // a column undoes scrolls nobody asked for until the reader touches it (useColumnScroll): a key press counts
  await page.keyboard.press('Shift')
}

test.describe('workspace look', () => {
  test('a preset previews the whole tab; Save keeps it for the workspace, before the first paint after a reload; Undo goes back', async ({ page }) => {
    await openLook(page)
    await page.getByTestId('look-preset-blueprint').click()
    await expect(page.locator('html')).toHaveAttribute('data-look', /.+/)
    await expect.poll(() => token(page, '--signal')).toBe('#2759db')
    expect(await wsEval(page, (s) => s.look ?? null)).toBeNull()
    await expect(page.getByTestId('look-bar')).toBeVisible()
    await expect(page.getByTestId('look-preset-blueprint')).toHaveAttribute('aria-checked', 'true')

    await page.getByTestId('look-save').click()
    await expect(page.getByTestId('look-bar')).toBeHidden()
    expect(await wsEval(page, (s) => s.look?.preset)).toBe('blueprint')
    await expect(page.getByTestId('look-state')).toContainText('BLUEPRINT')
    const toast = page.locator('.toast', { hasText: 'Look saved' })
    await expect(toast).toBeVisible()

    // before the first paint: the look is on <html> before React puts anything into #root
    await page.addInitScript(() => {
      const w = window as unknown as { __lookAtFirstChild?: string | null }
      const obs = new MutationObserver(() => {
        const root = document.getElementById('root')
        if (root && root.childElementCount > 0 && w.__lookAtFirstChild === undefined) {
          w.__lookAtFirstChild = document.documentElement.dataset.look ?? null
          obs.disconnect()
        }
      })
      obs.observe(document, { childList: true, subtree: true })
    })
    await reloadApp(page)
    expect(await page.evaluate(() => (window as unknown as { __lookAtFirstChild?: string | null }).__lookAtFirstChild)).toMatch(/.+/)
    expect(await token(page, '--signal')).toBe('#2759db')
    expect(await wsEval(page, (s) => s.look?.preset)).toBe('blueprint')

    // Undo from the save toast: back to the standard look, and the open section follows (no stale draft)
    await page.getByTestId('look-preset-ochre').click()
    await page.getByTestId('look-save').click()
    await page.locator('.toast', { hasText: 'Look saved' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => wsEval(page, (s) => s.look?.preset ?? null)).toBe('blueprint')
    await expect(page.getByTestId('look-bar')).toBeHidden()
    await expect.poll(() => token(page, '--signal')).toBe('#2759db')
    await expect(page.getByTestId('look-preset-blueprint')).toHaveAttribute('aria-checked', 'true')
  })

  test('Discard and Reset to standard; leaving with a draft drops it', async ({ page }) => {
    await openLook(page)
    await page.getByTestId('look-preset-ochre').click()
    await page.getByTestId('look-save').click()
    await expect.poll(() => token(page, '--signal')).toBe('#bb8500')

    await page.getByTestId('look-preset-proof').click()
    await expect.poll(() => token(page, '--signal')).toBe('#d4006e')
    await page.getByTestId('look-discard').click()
    await expect(page.getByTestId('look-bar')).toBeHidden()
    await expect.poll(() => token(page, '--signal')).toBe('#bb8500')

    await page.getByTestId('look-reset').click()
    await expect.poll(() => wsEval(page, (s) => s.look ?? null)).toBeNull()
    await expect(page.locator('html')).not.toHaveAttribute('data-look', /.*/)
    expect(await token(page, '--signal')).toBe('#ff4f00')
    await page.locator('.toast', { hasText: 'standard look' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => wsEval(page, (s) => s.look?.preset ?? null)).toBe('ochre')

    // a draft left behind is dropped: the app shows the saved look again
    await page.getByTestId('look-preset-swiss').click()
    await expect.poll(() => token(page, '--signal')).not.toBe('#bb8500')
    await page.evaluate(() => (window.location.hash = '#/workspace'))
    await expect(page.locator('.toast', { hasText: 'Unsaved look discarded' })).toBeVisible()
    await expect.poll(() => token(page, '--signal')).toBe('#bb8500')
    await expect(page.getByTestId('ws-look-line')).toContainText('OCHRE')
  })

  test('Discard after the saved look changed elsewhere goes back to the saved look as it is now', async ({ page }) => {
    await openLook(page)
    await page.getByTestId('look-preset-ochre').click()
    await page.getByTestId('look-save').click()
    await page.getByTestId('look-preset-proof').click()
    await expect(page.getByTestId('look-bar')).toBeVisible()
    // another admin saves Blueprint meanwhile (the store changes under the open draft)
    await wsEval(page, (s) => s.setLook({ preset: 'blueprint', colors: { paper: '#edf0f2', ink: '#0e1a2b', signal: '#2759db' }, fonts: { ui: 'archivo', text: 'ui', headings: 'condensed' }, corners: 'standard', updatedAt: 0, updatedBy: null }))
    await expect(page.getByTestId('look-remote')).toBeVisible()
    await page.getByTestId('look-discard').click()
    await expect(page.getByTestId('look-bar')).toBeHidden()
    await expect(page.getByTestId('look-remote')).toBeHidden()
    await expect(page.getByTestId('look-preset-blueprint')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('look-head-condensed')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => token(page, '--signal')).toBe('#2759db')
  })

  test('an import or merged backup that carries the same look keeps it as it is (no new value, no re-send)', async ({ page }) => {
    await openApp(page)
    const same = await page.evaluate(() => {
      const ws = (window as unknown as { __one: { workspace: { getState: () => Record<string, any> } } }).__one.workspace // eslint-disable-line @typescript-eslint/no-explicit-any
      ws.getState().setLook({ preset: 'ochre', colors: { paper: '#f3eee2', ink: '#1c1912', signal: '#e0a000' }, fonts: { ui: 'archivo', text: 'ui', headings: 'expanded' }, corners: 'standard', updatedAt: 0, updatedBy: null })
      const snap = () => {
        const s = ws.getState()
        return { version: s.version, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, look: JSON.parse(JSON.stringify(s.look)) }
      }
      const before = ws.getState().look
      ws.getState().replaceAll(snap())
      const kept = ws.getState().look === before
      ws.getState().replaceAll({ ...snap(), look: { ...before, corners: 'square' } })
      return { kept, changed: ws.getState().look !== before && ws.getState().look.corners === 'square' }
    })
    expect(same).toEqual({ kept: true, changed: true })
  })

  test('headings: every choice keeps a word space; page, view and panel titles follow the same choice', async ({ page }) => {
    await openApp(page)
    const id = await pageIdByTitle(page, 'Welcome to One')
    const gap = (sel: string) =>
      page.locator(sel).first().evaluate(async (el) => {
        const cs = getComputedStyle(el)
        // the face may still be on its way (a heading choice loads it on first use)
        await document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, 'Quick tour')
        await document.fonts.ready
        const probe = document.createElement('span')
        for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStretch', 'fontVariationSettings', 'letterSpacing', 'wordSpacing'] as const) probe.style[p] = cs[p]
        probe.style.position = 'absolute'
        probe.style.whiteSpace = 'pre'
        probe.textContent = 'Quick tour'
        document.body.append(probe)
        const r = document.createRange()
        r.setStart(probe.firstChild!, 5)
        r.setEnd(probe.firstChild!, 6)
        const em = (r.getBoundingClientRect().width + (parseFloat(cs.letterSpacing) || 0)) / parseFloat(cs.fontSize)
        probe.remove()
        return em
      })
    const choices = [...['expanded', 'normal', 'condensed', 'ui', 'serif', 'mono'].map((h) => [h, 'archivo']), ['ui', 'swiss'], ['ui', 'system']]
    for (const [headings, ui] of choices) {
      await wsEval(page, (s, [h, ui]) => s.setLook({ preset: 'blueprint', colors: { paper: '#edf0f2', ink: '#0e1a2b', signal: '#2759db' }, fonts: { ui, text: 'ui', headings: h }, corners: 'standard', updatedAt: 0, updatedBy: null }), [headings, ui])
      await gotoPage(page, id)
      for (const sel of ['#main .pv-title', '#main .doc-content [data-level="2"]']) expect(await gap(sel), `${headings} / ${ui} ${sel}`).toBeGreaterThanOrEqual(0.2)
      const face = await page.locator('#main .pv-title').evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el).fontStretch])
      await page.evaluate(() => (window.location.hash = '#/agents'))
      await expect(page.locator('.agx-title')).toBeVisible()
      // the tightest title (-0.03em tracking) keeps its words apart too, in the same face and width as the page title
      expect(await gap('.agx-title'), `${headings} / ${ui} agents`).toBeGreaterThanOrEqual(0.2)
      expect(await page.locator('.agx-title').evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el).fontStretch]), headings).toEqual(face)
    }
  })

  test('the AI terminal and toasts keep signal-coloured text readable under a look (Paper and Carbon)', async ({ page }) => {
    await openApp(page)
    const id = await pageIdByTitle(page, 'Welcome to One')
    await wsEval(page, (s) => s.setLook({ preset: 'blueprint', colors: { paper: '#edf0f2', ink: '#0e1a2b', signal: '#2759db' }, fonts: { ui: 'archivo', text: 'ui', headings: 'condensed' }, corners: 'standard', updatedAt: 0, updatedBy: null }))
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+j`)
    const model = page.locator('.term .term-head__model')
    await expect(model).toBeVisible()
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { toast: (t: unknown) => void } } } }).__one.ui.getState().toast({ message: 'Look saved', action: { label: 'Undo', run: () => {} } }))
    const action = page.locator('.toast__action').first()
    await expect(action).toBeVisible()
    const pairRatio = (el: import('@playwright/test').Locator) =>
      el.evaluate((node) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const rgb = (css: string) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = css
          ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
        }
        let bg = 'rgb(255, 255, 255)'
        for (let e: Element | null = node; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor
          if (c && !/^rgba\(.*, 0\)$/.test(c) && c !== 'transparent') {
            bg = c
            break
          }
        }
        const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
        const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        const [x, y] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(bg))].sort((p, q) => q - p)
        return (x + 0.05) / (y + 0.05)
      })
    for (const theme of ['light', 'dark'] as const) {
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await pairRatio(model), `${theme} terminal model key`).toBeGreaterThanOrEqual(4.5)
      expect(await pairRatio(action), `${theme} toast action`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('contrast is enforced and reported, in Paper and Carbon; a bad hex value is refused', async ({ page }) => {
    await openLook(page)
    const signal = page.getByTestId('look-signal').getByRole('textbox', { name: 'Signal: hex value' })
    await signal.fill('#ffe600')
    await signal.press('Enter')
    const ink = page.getByTestId('look-ink').getByRole('textbox', { name: 'Ink: hex value' })
    await ink.fill('#9a9a9a')
    await ink.press('Enter')
    await expect(page.getByTestId('look-used-signal')).toContainText('ADJUSTED FOR CONTRAST')
    await expect(page.getByTestId('look-used-ink')).toContainText('ADJUSTED FOR CONTRAST')
    await page.getByTestId('look-save').click()
    for (const theme of ['light', 'dark'] as const) {
      await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await contrastOf(page, '--signal', '--surface'), `${theme} signal`).toBeGreaterThanOrEqual(3)
      expect(await contrastOf(page, '--on-signal', '--signal'), `${theme} key label`).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '--ink', '--bg'), `${theme} ink`).toBeGreaterThanOrEqual(7)
      expect(await contrastOf(page, '--ink-3', '--surface-2'), `${theme} quiet`).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '--signal-ink', '--surface-2'), `${theme} signal text`).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '--signal-on-ink', '--ink'), `${theme} signal text on ink (toasts, bubble menu)`).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '--c-red-text', '--surface-2'), `${theme} content colour`).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '--plate-edge', '--surface-3'), `${theme} switch plate edge`).toBeGreaterThanOrEqual(3)
    }
    await wsEval(page, (s) => s.updateSettings({ theme: 'light' }))
    // six hex digits or three, nothing else
    const paper = page.getByTestId('look-paper').getByRole('textbox', { name: 'Paper: hex value' })
    const before = await wsEval(page, (s) => s.look?.colors.paper ?? null)
    await paper.fill('#12')
    await paper.press('Enter')
    await expect(paper).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('look-paper').getByRole('alert')).toContainText('Six hex digits')
    await expect(page.getByTestId('look-bar')).toBeHidden()
    expect(await wsEval(page, (s) => s.look?.colors.paper ?? null)).toBe(before)
    await paper.press('Escape')
    await expect(paper).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('type and corners: interface, page text and headings follow; per-page fonts and LEDs stay', async ({ page }) => {
    await openLook(page)
    await page.getByTestId('look-ui-swiss').click()
    await page.getByTestId('look-text-serif').click()
    await page.getByTestId('look-head-condensed').click()
    await page.getByTestId('look-corners-square').click()
    await page.getByTestId('look-save').click()
    expect(await wsEval(page, (s) => s.look)).toMatchObject({ fonts: { ui: 'swiss', text: 'serif', headings: 'condensed' }, corners: 'square' })
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Helvetica Neue')
    expect(await page.locator('.btn').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px')
    expect(await page.locator('.led').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px')

    const id = await pageIdByTitle(page, 'Welcome to One')
    await gotoPage(page, id)
    const content = page.locator('#main .pv-content .doc-content').first()
    expect(await content.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Newsreader')
    expect(await page.locator('#main .pv-title').evaluate((el) => getComputedStyle(el).fontStretch)).toBe('75%')
    // the page menu's "Default" sample shows the workspace's page text
    await page.locator('header.tb button[aria-haspopup="menu"]').last().click()
    expect(await page.locator('.pm-font[data-font="sans"] .pm-font__ag').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Newsreader')
    await page.keyboard.press('Escape')
    // a page set to Mono keeps it
    await wsEval(page, (s, id) => s.updatePageSettings(id, { font: 'mono' }), id)
    await expect.poll(() => content.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('JetBrains Mono')
  })

  test('share links, the HTML export and page backups keep the standard look', async ({ page }, testInfo) => {
    await openLook(page)
    await page.getByTestId('look-preset-blueprint').click()
    await page.getByTestId('look-save').click()
    await expect.poll(() => token(page, '--signal')).toBe('#2759db')

    // the whole workspace as one web page: One's standard tokens
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
    await dialog.getByRole('radio', { name: /Web page/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('workspace.html')
    await (await download).saveAs(file)
    const html = readFileSync(file, 'utf8')
    expect(html).toMatch(/--signal:\s*#ff4f00/)
    expect(html).not.toContain('#2759db')
    await page.keyboard.press('Escape')

    // a share link opened in the same tab: no look, the stock signal
    const id = await pageIdByTitle(page, 'Welcome to One')
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    await page.keyboard.press('Escape')
    await page.evaluate((hash) => (window.location.hash = hash), link.slice(link.indexOf('#')))
    await expect(page.locator('html')).not.toHaveAttribute('data-look', /.*/)
    await expect.poll(() => token(page, '--signal')).toBe('#ff4f00')
  })

  test('full backups carry the look, page backups never; a broken stored look is dropped', async ({ page }, testInfo) => {
    await openLook(page)
    await page.getByTestId('look-preset-ochre').click()
    await page.getByTestId('look-save').click()
    const exportJson = async (whole: boolean) => {
      if (!whole) await gotoPage(page, await pageIdByTitle(page, 'Welcome to One'))
      await page.keyboard.press(`${MOD}+k`)
      await page.keyboard.type('>export')
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      if (whole) await dialog.getByRole('radio', { name: /Whole workspace/ }).click()
      await dialog.getByRole('radio', { name: /Full backup/ }).click()
      const download = page.waitForEvent('download')
      await dialog.locator('[data-export-run]').click()
      const file = testInfo.outputPath(whole ? 'full.json' : 'page.json')
      await (await download).saveAs(file)
      await page.keyboard.press('Escape')
      return JSON.parse(readFileSync(file, 'utf8'))
    }
    expect((await exportJson(true)).workspace.look).toMatchObject({ preset: 'ochre' })
    expect((await exportJson(false)).workspace.look).toBeUndefined()

    // a damaged look in storage: dropped on load, no error, the standard look
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.open('keyval-store')
          r.onsuccess = () => {
            const tx = r.result.transaction('keyval', 'readwrite')
            const os = tx.objectStore('keyval')
            const g = os.get('one.ws.v2')
            g.onsuccess = () => os.put({ ...g.result, look: { colors: 'x', fonts: 7 } }, 'one.ws.v2')
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    // (and no cached copy of the old look on this device either)
    await page.evaluate(() => localStorage.removeItem('one.look'))
    await page.reload()
    await expect(page.locator('.app')).toBeVisible()
    expect(await wsEval(page, (s) => s.look ?? null)).toBeNull()
    expect(await token(page, '--signal')).toBe('#ff4f00')
  })

  test('"Use the standard look on this device": only here, kept across reloads, in Settings too', async ({ page }) => {
    await openLook(page)
    await page.getByTestId('look-preset-proof').click()
    await page.getByTestId('look-save').click()
    await expect.poll(() => token(page, '--signal')).toBe('#d4006e')
    const sw = page.getByTestId('look-standard-here').getByRole('switch', { name: 'Use the standard look on this device' })
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).not.toHaveAttribute('data-look', /.*/)
    expect(await wsEval(page, (s) => s.look?.preset)).toBe('proof')
    await reloadApp(page)
    await expect(page.locator('html')).not.toHaveAttribute('data-look', /.*/)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.look') ?? '{}').ws?.local?.standard)).toBe(true)
    // the same switch in Settings → Appearance
    await page.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings', tab: 'appearance' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    const inSettings = page.getByRole('dialog').getByRole('switch', { name: 'Use the standard look on this device' })
    await expect(inSettings).toHaveAttribute('aria-checked', 'true')
    await inSettings.click()
    await expect.poll(() => token(page, '--signal')).toBe('#d4006e')
    await expect(page.getByRole('dialog').getByTestId('settings-look-link')).toBeVisible()
  })

  test('⌘K "Workspace look" and the Overview line open the section', async ({ page }) => {
    await openApp(page, '#/workspace')
    await expect(page.getByTestId('ws-look-line')).toContainText('STANDARD')
    await page.getByTestId('ws-look-change').click()
    await expect(page.getByTestId('look-section')).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/workspace'))
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Workspace look')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('look-section')).toBeVisible()
    await expect(page.locator('.wsp-tab[aria-current="page"]')).toContainText('02')
  })
})

test.describe('phone 390 × 844, German, Carbon', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  test('fits, keys reach the save bar, presets move with the arrow keys', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de', theme: 'dark' }))
    await page.evaluate(() => (window.location.hash = '#/workspace/look'))
    const section = page.getByTestId('look-section')
    await expect(section).toBeVisible()
    await expect(section.locator('h2')).toContainText('Aussehen')
    await expect(section).toContainText('Vorlagen')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // keyboard: the checked preset, then → selects the next one (roving radio group)
    const paper = page.getByTestId('look-preset-paper')
    await paper.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('look-preset-blueprint')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('look-preset-blueprint')).toBeFocused()
    const ring = await page.getByTestId('look-preset-blueprint').evaluate((el) => getComputedStyle(el).boxShadow)
    expect(ring).not.toBe('none')

    // the save bar: the Save key is not covered by the capture key
    const save = page.getByTestId('look-save')
    await expect(save).toBeVisible()
    const hit = await save.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-testid="look-save"]') === el
    })
    expect(hit).toBe(true)
    await expect(save).toHaveText('Speichern')
    for (const el of await section.locator('.look-chip').all()) {
      const h = await el.evaluate((n) => n.getBoundingClientRect().height)
      expect(h).toBeGreaterThanOrEqual(24)
    }
    await save.click()
    await expect(page.locator('.toast', { hasText: 'Aussehen gespeichert' })).toBeVisible()
    // Carbon stays dark with a look
    expect(lum(await rgbOf(page, '--bg'))).toBeLessThan(0.05)
  })
})
