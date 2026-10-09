/**
 * Dialogs closing (ui/Modal.tsx), app-wide:
 *  - a double-click / double tap on a key that closes a dialog never acts on what lies underneath: the rest of that
 *    gesture (a mouse's second click; a touch tap on the closing key, or within a finger's reach on a spot that acts on
 *    nothing) is swallowed for a moment outside any modal dialog still open — the side peek is no exception, and its
 *    outside-press close waits for the click count — single clicks, and taps on another key, are never touched
 *  - a double tap on a key that opens a dialog never presses what opened under the finger in it (its click counts 1)
 *  - a short label stays beside a title that fits on one line there (also at phone width, text size XL)
 *  - focus never ends on the page body: an opener that cannot take focus any more (disabled or aria-disabled meanwhile,
 *    also just after the close), a route change right after closing (it takes the restored element), a click on the
 *    scrim — focus goes to the main region instead
 *  - at phone width a long header label goes on its own line above the title (cut with "…", the full text as a title),
 *    the title gets the whole width
 * The recipe dialogs use a fictional MCP server (tracker.example.com) and a mocked nothing — no request leaves.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, uiEval, wsEval, flush, createPage, sse, MOD } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() },
]
const RECIPE = '[data-recipe="tracker:mirror"]'

async function setServers(page: Page, profile: AnyState = {}) {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
  await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, ...profile }))
}

/** #/agents → (New agent →) the mirror recipe: its setup dialog. */
async function openSetup(page: Page): Promise<Locator> {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx').first().waitFor()
  const inline = page.locator(`.agx-start ${RECIPE}`)
  if (await inline.count()) await inline.click()
  else {
    await page.locator('.agx-head .btn--primary').click()
    await page.locator(`.agx-recipe-modal ${RECIPE}`).click()
  }
  const dialog = page.locator('.agx-mir')
  await expect(dialog).toBeVisible()
  return dialog
}

/** A saved agent (the list then shows its card). */
const saveAgent = (page: Page, over: AnyState) =>
  wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
    },
    over,
  )

/** A button under `key` (same box), in the app behind the dialog: counts the presses and clicks that reach it. */
async function plantUnder(page: Page, key: Locator): Promise<Locator> {
  const box = (await key.boundingBox())!
  await page.evaluate((r) => {
    document.getElementById('e2e-under')?.remove()
    const b = document.createElement('button')
    b.id = 'e2e-under'
    b.type = 'button'
    b.textContent = 'under'
    Object.assign(b.style, { position: 'fixed', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '1' })
    b.dataset.clicks = '0'
    b.dataset.downs = '0'
    b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
    b.addEventListener('pointerup', () => (b.dataset.ups = String(Number(b.dataset.ups ?? 0) + 1)))
    b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
    document.querySelector('#root .app')!.appendChild(b)
  }, box)
  return page.locator('#e2e-under')
}
const counts = (under: Locator) => under.evaluate((b) => ({ downs: Number(b.dataset.downs), clicks: Number(b.dataset.clicks), focused: document.activeElement === b }))

async function openConfirm(page: Page, label = 'Go on') {
  await uiEval(page, (s, l) => s.openModal({ type: 'confirm', title: 'Sure?', body: 'Nothing happens.', confirmLabel: l, onConfirm: () => {} }), label)
  const key = page.getByRole('dialog').getByRole('button', { name: label })
  await expect(key).toBeVisible()
  return key
}

const focusState = (page: Page) =>
  page.evaluate(() => ({ body: document.activeElement === document.body || !document.activeElement, inMain: !!document.activeElement?.closest('#main'), tag: document.activeElement?.tagName ?? null }))

test.describe('Dialogs: a pointer that closes a dialog never acts on what lies underneath', () => {
  test('1440, mouse: the second click of a double-click on a closing key never reaches the app; a single click right after it does', async ({ page }) => {
    await openApp(page, '#/agents')
    let key = await openConfirm(page)
    const under = await plantUnder(page, key)
    await key.dblclick()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(150)
    expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })

    // a single click right after a dialog closed (as fast as a script clicks) is the person's own
    key = await openConfirm(page)
    await key.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await under.click()
    expect(await counts(under)).toEqual({ downs: 1, clicks: 1, focused: true })
    // and after the moment has passed, a double-click there is the app's again
    await page.waitForTimeout(500)
    await under.dblclick()
    expect(await counts(under)).toMatchObject({ downs: 3, clicks: 3 })
  })

  test('1440, mouse: a double-click on the scrim closes the dialog once — its second click never reaches the app', async ({ page }) => {
    await openApp(page, '#/agents')
    // a key of the app below the dialog, in the scrim's area (nothing of the dialog there), planted before it opens
    const spot = { x: 300, y: 860 }
    await page.evaluate((p) => {
      const b = document.createElement('button')
      b.id = 'e2e-under'
      b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${p.x - 10}px`, top: `${p.y - 10}px`, width: '20px', height: '20px', zIndex: '50' })
      b.dataset.clicks = '0'
      b.dataset.downs = '0'
      b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
      b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
      document.querySelector('#root .app')!.appendChild(b)
    }, spot)
    await openConfirm(page)
    await page.mouse.dblclick(spot.x, spot.y)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(150)
    const under = page.locator('#e2e-under')
    expect(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id, spot)).toBe('e2e-under')
    expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })
    // later, a click of its own reaches it
    await page.waitForTimeout(400)
    await under.click()
    expect(await counts(under)).toEqual({ downs: 1, clicks: 1, focused: true })
  })

  test('1440, German: a double-click on “Verwerfen, beide in den Papierkorb” never opens the agent card that lies under it', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    // saved agents: the list shows cards (a stray click on a card's name opens that agent)
    for (let i = 0; i < 6; i++) await saveAgent(page, { id: `ag-${i}`, name: i === 0 ? 'Wochenbericht für das ganze Team und alle Projekte' : `Agent ${i}`, createdAt: Date.now() + i })
    await flush(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Abbrechen' }).click()
    const trash = page.locator('.agx-discard .btn--danger')
    await expect(trash).toBeVisible()
    const kb = (await trash.boundingBox())!
    const at = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    // the list behind the dialogs scrolled so that the first card's name lies right under that key
    const hit = await page.evaluate((at) => {
      const main = document.querySelector<HTMLElement>('#main')!
      const link = document.querySelector<HTMLElement>('.agx-card__name')!
      const r = link.getBoundingClientRect()
      main.scrollTop += r.top + r.height / 2 - at.y
      const s = link.getBoundingClientRect()
      return s.left <= at.x && at.x <= s.right && s.top <= at.y && at.y <= s.bottom
    }, at)
    expect(hit).toBe(true)
    await page.mouse.dblclick(at.x, at.y)
    await expect(editor).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.location.hash)).toBe('#/agents')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the first click did its job: the database is in the trash
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === 'Tracker').map((p) => p.trashed))).toEqual([true])
  })

  test.describe('390 px, touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('a double tap on a closing key never reaches the app; a tap elsewhere right after it does', async ({ page }) => {
      await openApp(page, '#/agents')
      let key = await openConfirm(page)
      const under = await plantUnder(page, key)
      const box = (await key.boundingBox())!
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await key.tap()
      await page.touchscreen.tap(at.x, at.y)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.waitForTimeout(150)
      expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })

      // a tap well away from the closing tap, right after it: the person's own
      key = await openConfirm(page)
      const far = await plantUnder(page, page.locator('.agx-head .btn--primary, .agx-start .agx-recipe').first())
      await key.tap()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await far.tap()
      expect(await counts(far)).toMatchObject({ clicks: 1 })
    })

    test('German: a double tap on “Verwerfen, beide in den Papierkorb” leaves the agents list alone', async ({ page }) => {
      await openApp(page)
      await setServers(page)
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      const dialog = await openSetup(page)
      await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).tap()
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      // a person reads the editor first: a tap in it within 450 ms near the opening tap is that tap's rest
      await page.waitForTimeout(500)
      await editor.getByRole('button', { name: 'Abbrechen' }).tap()
      const trash = page.locator('.agx-discard .btn--danger')
      await expect(trash).toBeVisible()
      const box = (await trash.boundingBox())!
      await trash.tap()
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(editor).toHaveCount(0)
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.location.hash)).toBe('#/agents')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === 'Tracker').map((p) => p.trashed))).toEqual([true])
    })
  })
})

test.describe('Dialogs: focus never ends on the page body after closing', () => {
  test('an opener disabled while the dialog was open: focus goes to the main region', async ({ page }) => {
    await openApp(page, '#/agents')
    await page.evaluate(() => {
      const b = document.createElement('button')
      b.id = 'e2e-opener'
      b.type = 'button'
      b.textContent = 'opener'
      document.querySelector('#main')!.prepend(b)
      b.focus()
    })
    await openConfirm(page)
    await page.evaluate(() => ((document.getElementById('e2e-opener') as HTMLButtonElement).disabled = true))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(100)
    expect(await focusState(page)).toEqual({ body: false, inMain: true, tag: 'MAIN' })
  })

  test('an opener that becomes disabled just after the close (the action it confirmed starts), or is aria-disabled: focus goes to the main region, never stays on the body', async ({ page }) => {
    await openApp(page, '#/agents')
    const plantOpener = () =>
      page.evaluate(() => {
        document.getElementById('e2e-opener')?.remove()
        const b = document.createElement('button')
        b.id = 'e2e-opener'
        b.type = 'button'
        b.textContent = 'opener'
        document.querySelector('#main')!.prepend(b)
        b.focus()
      })
    // disabled 80 ms after "Go on" (what it confirmed starts a moment later): by mouse and by Enter
    for (const how of ['mouse', 'keyboard'] as const) {
      await plantOpener()
      await uiEval(page, (s) =>
        s.openModal({ type: 'confirm', title: 'Sure?', body: 'It starts.', confirmLabel: 'Run anyway', onConfirm: () => setTimeout(() => ((document.getElementById('e2e-opener') as HTMLButtonElement).disabled = true), 80) }),
      )
      const go = page.getByRole('dialog').getByRole('button', { name: 'Run anyway' })
      await expect(go).toBeVisible()
      if (how === 'mouse') await go.click()
      else {
        await go.focus()
        await page.keyboard.press('Enter')
      }
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => (document.getElementById('e2e-opener') as HTMLButtonElement).disabled)).toBe(true)
      await expect.poll(() => focusState(page), { timeout: 3000 }).toEqual({ body: false, inMain: true, tag: 'MAIN' })
    }
    // aria-disabled while the dialog is open: focus does not go back to it
    await plantOpener()
    await openConfirm(page)
    await page.evaluate(() => document.getElementById('e2e-opener')!.setAttribute('aria-disabled', 'true'))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(150)
    expect(await focusState(page)).toEqual({ body: false, inMain: true, tag: 'MAIN' })
  })

  test('agent page “Run now” with a placeholder left → “Run anyway” (mouse and Enter): Run now is disabled while the run goes, focus is in the main region — never on the body', async ({ page, context }) => {
    await context.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      // the run takes a while: Run now stays disabled
      await new Promise((r) => setTimeout(r, 2500))
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('Done.') }).catch(() => {})
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await saveAgent(page, { id: 'ag-ph', name: 'Digest', instructions: 'Report on [PROJECT NAME] weekly.', scope: { everything: true, pages: [], databases: [] } })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-ph'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    const run = page.locator('.agx-dhead').getByRole('button', { name: 'Run now' }).first()
    const dialog = page.getByRole('dialog')
    for (const how of ['mouse', 'keyboard'] as const) {
      await expect(run).toBeEnabled({ timeout: 15_000 })
      if (how === 'mouse') await run.click()
      else {
        await run.focus()
        await page.keyboard.press('Enter')
      }
      await expect(dialog).toBeVisible()
      if (how === 'mouse') await dialog.getByRole('button', { name: 'Run anyway' }).click()
      else {
        await dialog.getByRole('button', { name: 'Run anyway' }).focus()
        await page.keyboard.press('Enter')
      }
      await expect(dialog).toHaveCount(0)
      await expect(run).toBeDisabled()
      await expect.poll(() => focusState(page), { timeout: 3000 }).toMatchObject({ body: false, inMain: true })
      await page.waitForTimeout(400)
      expect(await focusState(page)).toMatchObject({ body: false, inMain: true })
    }
  })

  test('the setup’s “Open “X”” (closes, then opens the agent): focus lands in the main region of the agent page', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: /^Open / }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.waitForTimeout(700)
    expect(await focusState(page)).toMatchObject({ body: false, inMain: true })
  })

  test('agent page ⋯ → Delete agent → Delete (back to #/agents): focus lands in the main region', async ({ page }) => {
    await openApp(page)
    await saveAgent(page, { id: 'ag-del', name: 'Digest' })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-del'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Delete agent' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/agents')
    await page.waitForTimeout(700)
    expect(await focusState(page)).toMatchObject({ body: false, inMain: true })
  })

  test('a mouse click on the setup dialog’s scrim: focus goes back to the key that opened it', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await openSetup(page)
    await page.mouse.click(8, 300)
    await expect(page.locator('.agx-mir')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await focusState(page)).toMatchObject({ body: false })
    expect(await page.locator(`.agx-start ${RECIPE}`).evaluate((el) => el === document.activeElement)).toBe(true)
  })
})

/** The header's parts: label above / beside the title, the title's width against the header's inner width. */
const headerOf = (dialog: Locator) =>
  dialog.locator('.modal__header').evaluate((head) => {
    const box = (sel: string) => head.querySelector(sel)!.getBoundingClientRect()
    const cs = getComputedStyle(head)
    const label = head.querySelector<HTMLElement>(':scope > .label')!
    const [l, t, c] = [box(':scope > .label'), box('.modal__title'), box('.modal__close')]
    return {
      stacked: head.hasAttribute('data-stacked'),
      labelAbove: l.bottom <= t.top + 1,
      sameRow: Math.abs(l.top + l.height / 2 - (t.top + t.height / 2)) < 12,
      closeOnLabelRow: c.top < t.top,
      titleFull: t.width >= head.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1,
      clipped: label.scrollWidth > label.clientWidth + 1,
      inside: l.left >= head.getBoundingClientRect().left && l.right <= head.getBoundingClientRect().right + 0.5,
      titleOneLine: t.height < 1.5 * (parseFloat(getComputedStyle(head.querySelector('.modal__title')!).lineHeight) || 20),
    }
  })

test.describe('Dialogs: a long header label at phone width', () => {
  test('390 px: the label goes on its own line above the title (cut with “…”, its full text as a title on hover); the title gets the full width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setServers(page, { name: 'Tracker · Handoff-Board des Plattform-Teams' })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openSetup(page)
    const h = await headerOf(dialog)
    expect(h).toMatchObject({ stacked: true, labelAbove: true, closeOnLabelRow: true, titleFull: true, clipped: true, inside: true, titleOneLine: true })
    // its full text on hover
    const label = dialog.locator('.modal__header > .label')
    await label.hover()
    await expect(label).toHaveAttribute('title', '§ AG-S · TRACKER · HANDOFF-BOARD DES PLATTFORM-TEAMS')
    await expect(dialog.getByRole('heading', { name: 'Liste in eine Datenbank spiegeln' })).toBeVisible()
    await page.keyboard.press('Escape')

    // a short label stays beside the title, on one row (Import: "§ IO-01")
    await expect(dialog).toHaveCount(0)
    await uiEval(page, (s) => s.openModal({ type: 'import' }))
    const io = page.locator('.modal.io-modal')
    await expect(io).toBeVisible()
    expect(await headerOf(io)).toMatchObject({ stacked: false, sameRow: true, clipped: false })
  })

  test('1440: a usual label stays beside the title on one row; a label that takes a good part of the row and would make the title wrap goes above it', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    let dialog = await openSetup(page)
    expect(await headerOf(dialog)).toMatchObject({ stacked: false, sameRow: true, clipped: false, titleOneLine: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await setServers(page, { name: 'Tracker · Handoff-Board des Plattform-Teams' })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    dialog = await openSetup(page)
    expect(await headerOf(dialog)).toMatchObject({ stacked: true, labelAbove: true, clipped: false, titleOneLine: true, titleFull: true })
  })
})

/**
 * A counting button of the app at a point (behind any dialog), planted before the dialog opens or while it is open —
 * or (`tag` div) a spot that acts on nothing, counting the clicks that reach it.
 */
async function plantAt(page: Page, at: { x: number; y: number }, id: string, size = 16, tag: 'button' | 'div' = 'button'): Promise<Locator> {
  await page.evaluate(
    ({ at, id, size, tag }) => {
      document.getElementById(id)?.remove()
      const b = document.createElement(tag)
      b.id = id
      if (b instanceof HTMLButtonElement) b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${at.x - size / 2}px`, top: `${at.y - size / 2}px`, width: `${size}px`, height: `${size}px`, zIndex: '50' })
      b.dataset.clicks = '0'
      b.dataset.downs = '0'
      b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
      b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
      document.querySelector('#root .app')!.appendChild(b)
    },
    { at, id, size, tag },
  )
  return page.locator(`#${id}`)
}

const peekId = (page: Page) => uiEval(page, (s) => s.peekPageId as string | null)

test.describe('Dialogs over the side peek: the closing double-click never reaches it', () => {
  test('1440, mouse: a double-click on a confirm’s Cancel over a peek with to-dos never toggles the to-do lying under it', async ({ page }) => {
    await openApp(page)
    const content = { type: 'doc', content: Array.from({ length: 30 }, (_, i) => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Task ${i + 1} with a longer label so the row is wide enough` }] }] }] })) }
    const id = await createPage(page, { title: 'Peek to-dos', content })
    await uiEval(page, (s, id) => s.openPeek(id, 'side'), id)
    await expect(page.locator('.peek input[type="checkbox"]').first()).toBeVisible()
    // where the confirm's keys are
    await openConfirm(page)
    const keys = await page.getByRole('dialog').locator('.confirm__actions button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    const cb = (await page.locator('.peek input[type="checkbox"]').first().boundingBox())!
    const key = keys.find((k) => k.x <= cb.x + cb.width / 2 && cb.x + cb.width / 2 <= k.x + k.w)
    expect(key, 'a confirm key over the to-dos’ checkbox column').toBeTruthy()
    const at = { x: cb.x + cb.width / 2, y: key!.y + key!.h / 2 }
    // the peek scrolled so that a to-do's checkbox lies right under that key
    const under = await page.evaluate((t) => {
      const sc = document.querySelector<HTMLElement>('.peek__scroll')!
      const items = Array.from(document.querySelectorAll<HTMLElement>('.peek input[type="checkbox"]'))
      const first = items.find((el) => el.getBoundingClientRect().top > t.y + 40) ?? items[items.length - 1]
      const r = first.getBoundingClientRect()
      sc.scrollTop += r.top + r.height / 2 - t.y
      const hit = document.elementFromPoint(t.x, t.y)
      return !!hit && (hit.matches('input[type="checkbox"]') || !!hit.closest('label')?.querySelector('input[type="checkbox"]'))
    }, at)
    expect(under).toBe(true)
    const checked = () => page.locator('.peek input[type="checkbox"]:checked').count()
    expect(await checked()).toBe(0)
    await openConfirm(page)
    await page.mouse.dblclick(at.x, at.y)
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await checked()).toBe(0)
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content).includes('"checked":true'), id)).toBe(false)
    expect(await peekId(page)).toBe(id)
  })

  test('1440, mouse: a double-click on a dialog’s scrim keeps the side peek; a single click there right after a close is the person’s own (it closes the peek)', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Peek target' })
    await uiEval(page, (s, id) => s.openPeek(id, 'side'), id)
    await expect(page.locator('.peek')).toBeVisible()
    await openConfirm(page)
    await page.mouse.dblclick(200, 500)
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await peekId(page)).toBe(id)
    // a single click on the scrim closes only the dialog; one more at the same spot right after: the peek closes
    await openConfirm(page)
    await page.mouse.click(200, 500)
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    expect(await peekId(page)).toBe(id)
    await page.mouse.click(200, 500)
    await expect.poll(() => peekId(page)).toBe(null)
  })

  test('1440, mouse: a double-click on a confirm key over the main column keeps a narrow side peek', async ({ page }) => {
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('one.shell.peekWidth', '0.3'))
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const id = await createPage(page, { title: 'Peek narrow' })
    await uiEval(page, (s, id) => s.openPeek(id, 'side'), id)
    const pr = (await page.locator('.peek').boundingBox())!
    const key = await openConfirm(page)
    const kb = (await key.boundingBox())!
    const at = { x: Math.min(kb.x + kb.width / 2, pr.x - 8), y: kb.y + kb.height / 2 }
    expect(at.x).toBeGreaterThan(kb.x)
    await page.mouse.dblclick(at.x, at.y)
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await peekId(page)).toBe(id)
  })

  test('1440, mouse: ⌘K → Import over a side peek, the dialog’s × double-clicked — nothing in the peek is pressed', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Peek under import' })
    await uiEval(page, (s, id) => s.openPeek(id, 'side'), id)
    await expect(page.locator('.peek')).toBeVisible()
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.locator('.pal-scrim')).toBeVisible()
    await page.keyboard.type('Import')
    await page.keyboard.press('Enter')
    const dialog = page.locator('.modal.io-modal')
    await expect(dialog).toBeVisible()
    const xb = (await dialog.locator('.modal__close').boundingBox())!
    const at = { x: xb.x + xb.width / 2, y: xb.y + xb.height / 2 }
    // a key inside the peek, under the dialog's ×
    await page.evaluate((at) => {
      const b = document.createElement('button')
      b.id = 'e2e-in-peek'
      b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${at.x - 10}px`, top: `${at.y - 10}px`, width: '20px', height: '20px', zIndex: '1' })
      b.dataset.clicks = '0'
      b.dataset.downs = '0'
      b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
      b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
      document.querySelector('.peek')!.appendChild(b)
    }, at)
    await page.mouse.dblclick(at.x, at.y)
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await page.locator('#e2e-in-peek').evaluate((b) => ({ downs: Number(b.dataset.downs), clicks: Number(b.dataset.clicks) }))).toEqual({ downs: 0, clicks: 0 })
    expect(await peekId(page)).toBe(id)
  })
})

test.describe('Dialogs: a finger’s double tap', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('390 px: a second tap on the closing key (its box widened a little: 20 px right, its far edge) or 30 px off on a spot that acts on nothing is part of the gesture; a tap on another key 30 px off — or farther away — is the person’s own', async ({ page }) => {
    await openApp(page, '#/agents')
    const cases: Array<{ name: string; dx: number; dy: number; edge?: boolean; spot?: boolean }> = [
      { name: '20 px right', dx: 20, dy: 0 },
      { name: '30 px below, another key', dx: 0, dy: 30 },
      { name: '30 px below, no key', dx: 0, dy: 30, spot: true },
      { name: 'on the key’s far edge', dx: 0, dy: 0, edge: true },
      { name: 'far away', dx: 0, dy: -160 },
    ]
    const out: Record<string, number> = {}
    for (const [i, c] of cases.entries()) {
      const key = await openConfirm(page)
      // the dialog settled (its opening slide done) before the key is measured
      await page.waitForTimeout(300)
      const kb = (await key.boundingBox())!
      const first = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
      const second = c.edge ? { x: kb.x + kb.width + 4, y: first.y } : { x: first.x + c.dx, y: first.y + c.dy }
      if (c.edge) expect(second.x - first.x, 'the far edge lies beyond the tap radius').toBeGreaterThan(32)
      if (c.dy === 30) expect(second.y, '30 px below lies off the closing key’s widened box').toBeGreaterThan(kb.y + kb.height + 8)
      const under = await plantAt(page, second, `e2e-tap-${i}`, 8, c.spot ? 'div' : 'button')
      // when each tap's pointerdown happened (a busy machine can stretch the gap past the gesture's moment)
      await page.evaluate(() => {
        const w = window as unknown as { __downs: number[] }
        w.__downs = []
        window.addEventListener('pointerdown', () => w.__downs.push(performance.now()), { capture: true })
      })
      await page.touchscreen.tap(first.x, first.y)
      await page.touchscreen.tap(second.x, second.y)
      await expect(page.locator('.modal-scrim')).toHaveCount(0)
      await page.waitForTimeout(200)
      expect(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id, second), 'the planted key is on top there').toBe(`e2e-tap-${i}`)
      const gap = await page.evaluate(() => {
        const d = (window as unknown as { __downs: number[] }).__downs
        return Math.round(d[d.length - 1] - d[d.length - 2])
      })
      expect(gap, 'the two taps came within the gesture’s moment').toBeLessThan(400)
      out[c.name] = (await counts(under)).clicks
      await under.evaluate((b) => b.remove())
      await page.waitForTimeout(500)
    }
    expect(out).toEqual({ '20 px right': 0, '30 px below, another key': 1, '30 px below, no key': 0, 'on the key’s far edge': 0, 'far away': 1 })
  })

  test('German: a tap on the recipe card 300 ms after closing the discard prompt with a tap — 29 px from it, another key — opens the setup', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).tap()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    // a person reads the editor first: a tap in it within 450 ms near the opening tap is that tap's rest
    await page.waitForTimeout(500)
    await editor.getByRole('button', { name: 'Abbrechen' }).tap()
    const keep = page.locator('.agx-discard').getByRole('button', { name: /beide behalten/ })
    await expect(keep).toBeVisible()
    await page.waitForTimeout(300)
    const kb = (await keep.boundingBox())!
    const at = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    await page.touchscreen.tap(at.x, at.y)
    await expect(editor).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the recipe card, 29 px below the closing tap: within a finger's reach, off the closing key's widened box
    const card = page.locator(`.agx-start ${RECIPE}`)
    const second = { x: at.x, y: at.y + 29 }
    expect(second.y).toBeGreaterThan(kb.y + kb.height + 8)
    expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('[data-recipe="tracker:mirror"]'), second), 'the card lies there').toBe(true)
    await page.waitForTimeout(300)
    await page.touchscreen.tap(second.x, second.y)
    await expect(page.locator('.agx-mir')).toBeVisible()
    await expect(card).toHaveCount(1)
  })
})

/**
 * A finger's double tap at `at`, `gap` ms apart. `count`: the click count the second tap's click gets — 2 as Chrome
 * counts a quick second tap here, or 1 as phones often give it (the first tap's events are stamped half a second
 * earlier, past the browser's double-tap time, so its tap counter starts anew at the second; on the page both taps
 * still come `gap` ms apart). Touch events must keep their order: the last tap before lies over 0.6 s back.
 */
async function doubleTap(page: Page, at: { x: number; y: number }, gap: number, count: 1 | 2) {
  if (count === 2) {
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForTimeout(gap)
    await page.touchscreen.tap(at.x, at.y)
    return
  }
  const cdp = await page.context().newCDPSession(page)
  const tap = async (t: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }], timestamp: t })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.03 })
  }
  await tap(Date.now() / 1000 - 0.5)
  await page.waitForTimeout(gap)
  await tap(Date.now() / 1000)
  await cdp.detach()
}

test.describe('Dialogs: a finger’s double tap that opens one', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('390 px: a double tap on a key that opens a dialog never presses the dialog’s key that opened under the finger (its click counts 1); a single tap after the moment does', async ({ page }) => {
    await openApp(page, '#/agents')
    // where the confirm's key lies once it has settled
    const key = await openConfirm(page)
    await page.waitForTimeout(300)
    const kb = (await key.boundingBox())!
    const at = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // a key of the app right there opens that confirm: its "Go on" lands under the finger
    await page.evaluate((at) => {
      const w = window as unknown as { __confirmed: number; __clicks: string[]; __one: { ui: { getState: () => AnyState } } }
      w.__confirmed = 0
      w.__clicks = []
      const b = document.createElement('button')
      b.id = 'e2e-opener'
      b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${at.x - 30}px`, top: `${at.y - 16}px`, width: '60px', height: '32px', zIndex: '50' })
      b.addEventListener('click', () =>
        w.__one.ui.getState().openModal({ type: 'confirm', title: 'Sure?', body: 'Nothing happens.', confirmLabel: 'Go on', onConfirm: () => (w.__confirmed += 1) }),
      )
      document.querySelector('#root .app')!.appendChild(b)
      // where each tap landed, and each click with its count (a swallowed tap has none)
      for (const type of ['pointerdown', 'click'])
        window.addEventListener(type, (e) => w.__clicks.push(`${type}:${(e.target as HTMLElement).closest('button')?.textContent?.trim() ?? '?'}:d${(e as MouseEvent).detail}`), true)
    }, at)
    const confirmed = () => page.evaluate(() => (window as unknown as { __confirmed: number }).__confirmed)
    for (const [gap, count] of [
      [60, 1],
      [120, 1],
      [200, 1],
      [90, 2],
    ] as const) {
      await page.evaluate(() => ((window as unknown as { __clicks: string[] }).__clicks.length = 0))
      await doubleTap(page, at, gap, count)
      await page.waitForTimeout(500)
      const clicks = await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks.splice(0))
      expect(clicks.filter((c) => c.startsWith('pointerdown:'))[1], `gap ${gap} ms, click count ${count}: the second tap lands on the dialog’s key (${clicks.join(', ')})`).toMatch(/^pointerdown:Go on/)
      expect(await confirmed(), `gap ${gap} ms, click count ${count}: ${clicks.join(', ')}`).toBe(0)
      await expect(page.getByRole('dialog')).toBeVisible()
      // after the moment, a single tap on that key is the person's own
      await page.getByRole('dialog').getByRole('button', { name: 'Go on' }).tap()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await confirmed()).toBe(1)
      await page.evaluate(() => ((window as unknown as { __confirmed: number }).__confirmed = 0))
      await page.waitForTimeout(800)
    }
  })

  test('German: a double tap on “Datenbank und Agent anlegen” opens the editor and saves nothing; a tap on “Agent anlegen” after the moment saves', async ({ page }) => {
    await openApp(page)
    // instructions without placeholders: "Agent anlegen" saves at once
    await setServers(page, { recipes: [{ kind: 'mirror', agent: { instructions: 'Halte die Datenbank „{db}“ mit den Einträgen in {server} im Gleichstand. Lies {server} nur.' } }] })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const agents = () => wsEval(page, (s) => Object.keys(s.agents ?? {}).length)
    const editor = page.locator('.agx-editor')
    for (const [round, [gap, count]] of ([
      [90, 1],
      [200, 1],
      [90, 2],
    ] as const).entries()) {
      const dialog = await openSetup(page)
      await dialog.getByRole('textbox', { name: /Name/ }).fill(`Tracker Handoff ${round + 1}`)
      const create = dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' })
      await create.scrollIntoViewIfNeeded()
      await page.waitForTimeout(700)
      const b = (await create.boundingBox())!
      const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      await doubleTap(page, at, gap, count)
      await page.waitForTimeout(800)
      await expect(editor).toBeVisible()
      expect(await agents(), `gap ${gap} ms, click count ${count}`).toBe(round)
      expect(await page.evaluate(() => window.location.hash)).toBe('#/agents')
      // a deliberate tap after the moment works
      await editor.getByRole('button', { name: 'Agent anlegen', exact: true }).tap()
      await expect(editor).toHaveCount(0)
      expect(await agents()).toBe(round + 1)
    }
  })
})

test.describe('Dialogs: label and title on one row whenever the title fits there', () => {
  test('390 px, text size XL: a short label stays beside a title that fits on one line (Import, Export, Templates); a long one still goes above', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await page.evaluate(() => localStorage.setItem('one.textScale', '4'))
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one)
    const id = await createPage(page, { title: 'Header page' })
    const kinds: AnyState[] = [{ type: 'import' }, { type: 'export', pageId: id }, { type: 'templates' }]
    const heights: number[] = []
    for (const k of kinds) {
      await uiEval(page, (s, k) => s.openModal(k), k)
      const dialog = page.locator('.modal').last()
      await expect(dialog.locator('.modal__header')).toBeVisible()
      await page.waitForTimeout(150)
      expect(await headerOf(dialog), JSON.stringify(k)).toMatchObject({ stacked: false, sameRow: true, clipped: false, titleOneLine: true })
      heights.push(Math.round((await dialog.locator('.modal__header').boundingBox())!.height))
      await page.keyboard.press('Escape')
      await expect(page.locator('.modal')).toHaveCount(0)
    }
    // the same header height for each
    expect(new Set(heights).size, JSON.stringify(heights)).toBe(1)
    // a long label with a title that would wrap beside it: above
    await setServers(page, { name: 'Tracker · Handoff-Board des Plattform-Teams' })
    const dialog = await openSetup(page)
    expect(await headerOf(dialog)).toMatchObject({ stacked: true, labelAbove: true, titleOneLine: true })
  })
})
