/**
 * Focus never ends on the page body (ui/focus.ts, ui/Popover.tsx, ui/Modal.tsx, shell/stage/Toasts.tsx):
 *  - a menu closed by Esc or by a pick gives focus back to the key that opened it (the ARIA menu button) — also inside
 *    a dialog — unless the pick moved it on (a dialog opened, the route changed, a field took it)
 *  - a dialog opened from a menu item (or from ⌘K) gives focus back to that menu's key (or to where it was before ⌘K)
 *    when it closes; that key hidden now (a sidebar row's ⋯, shown only on hover): the row's link
 *  - a dialog opened while nothing had the focus, closing with focus lost: the main region — and every global shortcut
 *    still works from there
 *  - a toast's key that removes the toast: focus back to where it was before the press (mouse or keyboard)
 * The recipe dialogs use a fictional MCP server (tracker.example.com); nothing leaves the page.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, uiEval, wsEval, flush, createPage, sidebarRow, MOD } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() },
]
const RECIPE = '[data-recipe="tracker:mirror"]'

/** Where focus is: body / inside main / the element's tag, class and text. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    return {
      body: !a || a === document.body,
      main: a?.id === 'main',
      tag: a?.tagName ?? null,
      cls: (a?.className?.toString() ?? '').slice(0, 40),
      label: a?.getAttribute('aria-label') ?? (a?.textContent ?? '').trim().slice(0, 30),
    }
  })

/** Is `loc` the focused element (polls a little: focus comes back a frame or two after the close). */
const focused = async (loc: Locator) => expect.poll(() => loc.evaluate((el) => el === document.activeElement), { timeout: 3000 }).toBe(true)

const saveAgent = (page: Page, over: AnyState) =>
  wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
    },
    over,
  )

test.describe('Menus and the dialogs they open give focus back to their key', () => {
  test('German, agent page ⋯ → Agent löschen → Abbrechen / Esc / keyboard only: focus back on ⋯', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await saveAgent(page, { id: 'ag-keep', name: 'Digest' })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-keep'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const more = page.locator('.agx-dhead').getByRole('button', { name: 'Mehr' })
    const dialog = page.locator('.modal-scrim')
    // mouse: Abbrechen
    await more.click()
    await page.getByRole('menuitem', { name: 'Agent löschen' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toHaveCount(0)
    await focused(more)
    // mouse, then Esc
    await more.click()
    await page.getByRole('menuitem', { name: 'Agent löschen' }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await focused(more)
    // keyboard only: Enter opens the menu, Enter on its first item, Esc
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Agent löschen' })).toBeVisible()
    const items = await page.getByRole('menuitem').allInnerTexts()
    for (let i = 0; i < items.findIndex((t) => t.includes('Agent löschen')); i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await focused(more)
    expect(await wsEval(page, (s) => Object.keys(s.agents ?? {}))).toEqual(['ag-keep'])
  })

  test('sidebar row ⋯ → Move to… closed by Esc, ×, the scrim or by keyboard: focus back in that row', async ({ page }) => {
    await openApp(page)
    await createPage(page, { title: 'Movable page' })
    const row = sidebarRow(page, 'Movable page')
    const out: Record<string, AnyState> = {}
    for (const how of ['esc', 'x', 'scrim', 'keyboard']) {
      if (how === 'keyboard') {
        await row.locator('.sb-row__link').focus()
        await row.getByRole('button', { name: 'More' }).focus()
        await page.keyboard.press('Enter')
        const names = await page.getByRole('menuitem').allInnerTexts()
        const at = names.findIndex((n) => n.includes('Move to'))
        for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
      } else {
        await row.hover()
        await row.getByRole('button', { name: 'More' }).click()
        await page.getByRole('menuitem', { name: 'Move to…' }).click()
      }
      const dialog = page.locator('.modal-scrim')
      await expect(dialog).toBeVisible()
      if (how === 'esc' || how === 'keyboard') await page.keyboard.press('Escape')
      else if (how === 'x') await dialog.locator('.modal__close').click()
      else await page.mouse.click(1430, 880)
      await expect(dialog).toHaveCount(0)
      await page.waitForTimeout(400)
      const f = await focusOf(page)
      out[how] = { body: f.body, inRow: await row.evaluate((r) => r.contains(document.activeElement)) }
      await page.mouse.move(700, 450)
    }
    expect(out).toEqual({ esc: { body: false, inRow: true }, x: { body: false, inRow: true }, scrim: { body: false, inRow: true }, keyboard: { body: false, inRow: true } })
  })

  test('⌘K → Import → Esc: focus back where it was before ⌘K (a key), or the main region when nothing had it', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => {
      const b = document.createElement('button')
      b.id = 'e2e-before'
      b.type = 'button'
      b.textContent = 'before'
      document.querySelector('#main')!.prepend(b)
      b.focus()
    })
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.locator('.pal-scrim')).toBeVisible()
    await page.keyboard.type('Import')
    await page.keyboard.press('Enter')
    const io = page.locator('.modal.io-modal')
    await expect(io).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(io).toHaveCount(0)
    await focused(page.locator('#e2e-before'))
    // nothing focused before ⌘K
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('Import')
    await page.keyboard.press('Enter')
    await expect(io).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(io).toHaveCount(0)
    await expect.poll(() => focusOf(page)).toMatchObject({ body: false, main: true })
  })

  test('a menu inside a dialog (the setup’s “where” picker): a pick and Esc give focus back to the picker, the dialog stays', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
    await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
    await createPage(page, { title: 'Mirror home' })
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator(`.agx-start ${RECIPE}`).click()
    const setup = page.locator('.agx-mir')
    await expect(setup).toBeVisible()
    const pick = setup.locator('.agx-pick')
    await pick.click()
    await page.locator('[data-popover] [role="menuitem"]').nth(1).click()
    await expect(page.locator('[data-popover]')).toHaveCount(0)
    await focused(pick)
    await expect(setup).toBeVisible()
    await pick.click()
    await expect(page.locator('[data-popover]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-popover]')).toHaveCount(0)
    await expect(setup).toBeVisible()
    await focused(pick)
  })
})

test.describe('A dialog opened while nothing had the focus', () => {
  test('quick capture opened with nothing focused → Esc: the main region — and the global shortcuts all work from there', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(`${MOD}+Shift+K`)
    const sheet = page.locator('.modal.qcap')
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => focusOf(page)).toMatchObject({ body: false, main: true })
    const onMain = async () => {
      await page.locator('#main').focus()
      expect(await focusOf(page)).toMatchObject({ main: true })
    }
    // ⌘K
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.locator('.pal-scrim')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.pal-scrim')).toHaveCount(0)
    // Mod+Shift+K
    await onMain()
    await page.keyboard.press(`${MOD}+Shift+K`)
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    // ? help
    await onMain()
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: /^(Help|Hilfe)$/ }).getByRole('searchbox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /^(Help|Hilfe)$/ })).toHaveCount(0)
    // the sidebar toggle
    await onMain()
    await page.keyboard.press(`${MOD}+\\`)
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'collapsed')
    await onMain()
    await page.keyboard.press(`${MOD}+\\`)
    await expect(page.locator('aside.sb')).toHaveAttribute('data-state', 'docked')
    // ⌘J: the AI terminal
    await onMain()
    await page.keyboard.press(`${MOD}+j`)
    await expect(page.getByRole('region', { name: 'AI terminal' })).toBeVisible()
    await page.keyboard.press(`${MOD}+j`)
    await expect(page.getByRole('region', { name: 'AI terminal' })).toHaveCount(0)
    // Mod+Alt+N: a new page
    await onMain()
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    await page.keyboard.press('Control+Alt+n')
    await expect(page.locator('#main .pv-title')).toBeFocused()
    expect(await wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before + 1)
  })
})

test.describe('Toasts: a key that removes the toast gives focus back', () => {
  test('mouse and keyboard: focus back to the field it was in before the press', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => {
      const f = document.createElement('input')
      f.id = 'e2e-field'
      f.setAttribute('aria-label', 'field')
      document.querySelector('#main')!.prepend(f)
      f.focus()
    })
    const raise = (label: string) =>
      uiEval(page, (s, label) => {
        const w = window as unknown as { __undone?: number }
        w.__undone = 0
        s.toast({ message: `Moved ${label} to the trash.`, action: { label: 'Undo', run: () => (w.__undone = (w.__undone ?? 0) + 1) }, timeout: 20_000 })
      }, label)
    // mouse
    await raise('one')
    const toast = page.locator('.toast').filter({ hasText: 'Moved one' })
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(toast).toHaveCount(0)
    await focused(page.locator('#e2e-field'))
    expect(await page.evaluate(() => (window as unknown as { __undone: number }).__undone)).toBe(1)
    // keyboard: the key reached from the field, Enter
    await raise('two')
    const second = page.locator('.toast').filter({ hasText: 'Moved two' })
    await second.getByRole('button', { name: 'Undo' }).focus()
    await page.keyboard.press('Enter')
    await expect(second).toHaveCount(0)
    await focused(page.locator('#e2e-field'))
    expect(await page.evaluate(() => (window as unknown as { __undone: number }).__undone)).toBe(1)
    // the field gone meanwhile: the main region
    await raise('three')
    const third = page.locator('.toast').filter({ hasText: 'Moved three' })
    await third.getByRole('button', { name: 'Undo' }).focus()
    await page.evaluate(() => document.getElementById('e2e-field')!.remove())
    await page.keyboard.press('Enter')
    await expect(third).toHaveCount(0)
    await expect.poll(() => focusOf(page)).toMatchObject({ body: false, main: true })
  })
})
