/**
 * Hardening round: the small bugs found in the newest features, each with the test that shows it.
 */
import type { Locator } from '@playwright/test'
import { test, expect, openApp, gotoPage, pageIdByTitle, createPage, doc, para, plainOf, wsEval, editorOf, mockClaude, MOD } from './fixtures'

/** A popover placed by floating-ui and done with its entrance animation. */
async function settled(pop: Locator): Promise<void> {
  await expect.poll(async () => (await pop.boundingBox())?.x ?? 0).toBeGreaterThan(100)
  await pop.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
}

test.describe('menus and popovers', () => {
  test('a menu opening under a resting pointer highlights nothing below it; a popover never shows at the corner first', async ({ page }) => {
    await openApp(page)
    await gotoPage(page, await pageIdByTitle(page, 'Meetings'))
    const row = page.locator('#main section.db .dbt-row[role="row"]', { hasText: 'Weekly sync' }).first()
    await expect(row).toBeVisible()
    // every popover as it is added: can it be seen, and where does it stand?
    await page.evaluate(() => {
      const seen: Array<{ opacity: string; pe: string; x: number; y: number }> = []
      ;(window as unknown as { __pops: typeof seen }).__pops = seen
      new MutationObserver((recs) => {
        for (const r of recs)
          for (const n of r.addedNodes) {
            if (!(n instanceof HTMLElement) || !n.matches('[data-popover]')) continue
            const b = n.getBoundingClientRect()
            const cs = getComputedStyle(n)
            seen.push({ opacity: cs.opacity, pe: cs.pointerEvents, x: b.x, y: b.y })
          }
      }).observe(document.body, { childList: true })
    })

    const box = (await row.boundingBox())!
    const at = { x: box.x + 240, y: box.y + box.height / 2 }
    await page.mouse.click(at.x, at.y, { button: 'right' })
    const menu = page.locator('[data-popover][role="menu"]')
    await expect(menu).toBeVisible()
    const pops = await page.evaluate(() => (window as unknown as { __pops: Array<{ opacity: string; pe: string; x: number; y: number }> }).__pops)
    expect(pops.length).toBeGreaterThan(0)
    // the panel as it is added: either placed by the click already, or unseen and not under the pointer
    for (const p of pops) expect((p.opacity === '0' && p.pe === 'none') || p.x > 100, JSON.stringify(p)).toBe(true)

    // where the last item ("Delete") stands once the menu is placed at that point
    await settled(menu)
    const items = menu.locator('.menu-item[role="menuitem"]')
    const last = items.last()
    const lastBox = (await last.boundingBox())!
    const rest = { x: lastBox.x + lastBox.width / 2, y: lastBox.y + lastBox.height / 2 }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // the pointer rests where "Delete" will appear; the same menu opens again at the same point
    await page.mouse.move(rest.x, rest.y)
    await row.evaluate((el, at) => el.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true })), at)
    await expect(menu).toBeVisible()
    await expect(last).toBeVisible()
    await settled(menu)
    // the browser tells the item below the resting pointer that the pointer is over it …
    await page.mouse.move(rest.x, rest.y)
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-popover] .menu-item--danger'), rest)).toBe(true)
    // … which is not a person pointing at it: the first item stays the active one
    await expect(items.first()).toHaveAttribute('data-active', 'true')
    await expect(last).not.toHaveAttribute('data-active', 'true')
    expect(await last.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await expect(menu.locator('[data-pointer="still"]')).toHaveCount(1)

    // keyboard still moves through the items
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toHaveAttribute('data-active', 'true')

    // a real move onto the item highlights it
    await page.mouse.move(rest.x + 4, rest.y + 1)
    await expect(last).toHaveAttribute('data-active', 'true')
    await expect(menu.locator('[data-pointer="still"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

test.describe('focus', () => {
  test('quick hands: Esc then ⌘K before the next frame — the palette that opens again keeps the focus', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Quick hands', content: doc(para('Some text here.')) })
    await gotoPage(page, id)
    await editorOf(page, id).locator('p').first().click()
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    const input = pal.locator('input').first()
    await expect(input).toBeFocused()
    // both keys in one task: the closing palette's focus restore runs only after the palette is back
    await page.evaluate((mod) => {
      const key = (init: KeyboardEventInit) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
      key({ key: 'Escape', code: 'Escape' })
      key({ key: 'k', code: 'KeyK', ...(mod === 'Meta' ? { metaKey: true } : { ctrlKey: true }) })
    }, MOD)
    await expect(pal).toBeVisible()
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await expect(input).toBeFocused()
    await page.keyboard.type('Quick')
    await expect(input).toHaveValue('Quick')
    expect(await plainOf(page, id)).toBe('Some text here.')
  })
})

/** Every animation frame comes late (a busy machine): requestAnimationFrame waits `ms`. */
async function slowFrames(page: import('@playwright/test').Page, ms = 150): Promise<void> {
  await page.addInitScript((ms) => {
    let seq = 0
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    window.requestAnimationFrame = (cb) => {
      const id = ++seq
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          cb(performance.now())
        }, ms),
      )
      return id
    }
    window.cancelAnimationFrame = (id) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
    }
  }, ms)
}

test.describe('keyboard on a busy machine', () => {
  test('table: keys typed right after Esc or Enter land in the grid and the picker — none get lost waiting for a frame', async ({ page }) => {
    await slowFrames(page)
    await openApp(page)
    const dbId = await wsEval(page, (s) => {
      const dbId = s.createDatabase({
        title: 'Fast keys',
        properties: [
          { id: 'pName', name: 'Name', type: 'title' },
          { id: 'pNotes', name: 'Notes', type: 'text' },
          { id: 'pKind', name: 'Kind', type: 'select', options: [{ id: 'oApple', name: 'Apple', color: 'red' }, { id: 'oBanana', name: 'Banana', color: 'yellow' }] },
        ],
      })
      s.createRow(dbId, { title: 'Alpha' })
      s.createRow(dbId, { title: 'Beta' })
      return dbId
    })
    await gotoPage(page, dbId)
    const grid = page.locator('#main section.db .dbt[role="grid"]')
    await expect(grid.locator('.dbt-row[role="row"]', { hasText: 'Beta' })).toBeVisible()
    await grid.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator('.db-textedit__area')).toBeFocused()
    // no waiting in between: Esc commits, → moves on, Enter opens the picker, the letters filter it
    await page.keyboard.type('note')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Ban')
    await page.keyboard.press('Enter')
    const props = () => wsEval(page, (s) => (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.title === 'Alpha')?.properties) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect.poll(props).toMatchObject({ pNotes: 'note', pKind: 'oBanana' })
  })
})

test.describe('block selection', () => {
  test('Esc right after a click selects the clicked block — also before the browser reported the new caret', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Quick Esc', content: doc(para('Alpha line.'), para('Bravo line.'), para('Charlie line.'), para('Delta line.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Alpha' }).click()
    // the click on "Charlie" has moved the caret in the page; its selectionchange event is still queued
    await ed.evaluate((root) => {
      const p = [...root.querySelectorAll('p')].find((x) => x.textContent === 'Charlie line.')!
      getSelection()!.collapse(p.firstChild!, 3)
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    })
    await expect(ed.locator('.is-block-selected')).toHaveText(['Charlie line.'])
    // Shift+click grows it from there
    await ed.locator('p', { hasText: 'Delta' }).click({ modifiers: ['Shift'] })
    await expect(ed.locator('.is-block-selected')).toHaveText(['Charlie line.', 'Delta line.'])
  })

  test('copy right after selecting copies what is selected now, and Enter splits where the caret is now', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Quick copy', content: doc(para('Alpha line.'), para('Bravo line.'), para('Charlie line.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Alpha' }).click()
    // the browser selected "Charlie line." (Shift+Home, a drag …) and ⌘C comes before its selectionchange event
    const copied = await ed.evaluate((root) => {
      const p = [...root.querySelectorAll('p')].find((x) => x.textContent === 'Charlie line.')!
      getSelection()!.setBaseAndExtent(p.firstChild!, 0, p.firstChild!, p.textContent!.length)
      const data = new DataTransfer()
      root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return data.getData('text/plain')
    })
    expect(copied).toBe('Charlie line.')
    // a click puts the caret after "Bravo", Enter comes first: the split happens there
    await ed.evaluate((root) => {
      const p = [...root.querySelectorAll('p')].find((x) => x.textContent === 'Bravo line.')!
      getSelection()!.collapse(p.firstChild!, 5)
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    })
    await expect.poll(() => plainOf(page, id)).toMatch(/Alpha line\.\s+Bravo\s+line\.\s+Charlie line\./)
    await expect(ed.locator('p')).toHaveText(['Alpha line.', 'Bravo', /^\s*line\.$/, 'Charlie line.'])
  })
})

test.describe('undo steps', () => {
  test("Claude's inserted answer is its own undo step: typing right after it is undone on its own", async ({ page, context }) => {
    await mockClaude(context, () => 'Inserted by Claude.')
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, { title: 'Undo steps', content: doc(para('First line.'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const ask = page.getByPlaceholder('Ask Claude to write anything…')
    await expect(async () => {
      await ed.locator('p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      try {
        await expect(ask).toBeFocused({ timeout: 2000 })
      } catch (e) {
        if (!(await ask.count())) await page.keyboard.press('Backspace')
        throw e
      }
    }).toPass({ timeout: 15_000 })
    await ask.fill('Write one line')
    await ask.press('Enter')
    const panel = page.getByRole('dialog', { name: 'Ask Claude' })
    await expect(panel.locator('.ai-out__body')).toContainText('Inserted by Claude.')
    await panel.getByRole('option', { name: /^Insert/ }).first().click()
    await expect(ed).toContainText('Inserted by Claude.')
    // at once, in the same place
    await page.keyboard.type(' More')
    await expect(ed).toContainText('Inserted by Claude. More')
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed).toContainText('Inserted by Claude.')
    await expect(ed).not.toContainText('More')
    await page.keyboard.press(`${MOD}+z`)
    await expect(ed).not.toContainText('Inserted by Claude.')
    await expect(ed).toContainText('First line.')
  })
})

test.describe('version history', () => {
  test('a script run keeps the page first as a "Script · <name>" version', async ({ page }) => {
    await openApp(page)
    const pid = await createPage(page, { title: 'Script target', content: doc(para('Before the script.')) })
    const sid = await wsEval(
      page,
      (s, pid) => {
        const now = Date.now()
        s.upsertScript({ id: 'scHIST1', name: 'Tidy notes', code: `page(@[Script target](p:${pid})).append("Added by the script.")`, kind: 'script', createdAt: now, updatedAt: now })
        return 'scHIST1'
      },
      pid,
    )
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), sid)
    await page.getByTestId('sc-run').click()
    await expect(page.locator('.sc-summary--run')).toBeVisible()
    await expect.poll(() => plainOf(page, pid)).toContain('Added by the script.')
    await gotoPage(page, pid)
    await page.locator('.tb').getByRole('button', { name: 'Version history' }).click()
    const dialog = page.getByRole('dialog')
    const row = dialog.locator('.hist__row', { has: page.locator('.hist__tag--script') })
    await expect(row.locator('.hist__tag')).toHaveText('Script')
    await row.click()
    await expect(dialog.locator('.hist__stamp .label')).toHaveText(/^Script · Tidy notes · /)
    await expect(dialog.locator('.hist__preview')).toContainText('Before the script.')
  })
})
