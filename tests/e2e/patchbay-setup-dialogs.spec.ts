/**
 * The Patchbay's setup lamps — the openers, the dialogs over the patchbay and the way back (B11, plan §1.11, §6 U2):
 *  - lamps 04 / 05: MirrorSetup and the agent editor open as dialogs over #/patchbay (agents/AgentDialogsHost, mounted
 *    in ModalHost); the route stays; Esc gives the keyboard back to the lamp's key; after a create / a save it moves on
 *    to the next lamp's key. Create keeps the agent draft in this tab for lamp 05; closing it unsaved asks as in the
 *    gallery (keep both → the draft is lost → 05 reopens MirrorSetup, whose "Use …" makes it again); saved → 06 next.
 *  - lamp 02 leaves for #/mcp with that server's Test key focused (the lamp never runs the test); the return chip shows
 *    in the topbar (also at 390 px with XL text, inside the viewport), follows the lamps live, and ↵ on it brings the
 *    keyboard back to the next lamp's key with the polite message "02 done · 04 next";
 *  - lamp 03 (a quiet link) opens Workspace › Integrations at that profile, its first key focused; coming back by
 *    Back is an arrival too; × on the chip closes the way back without leaving the keyboard on the body.
 *  - fix (rest): lamp 04 opens the setup on the database it means (a renamed one in the trash: Restore · Open); 06 of
 *    runs that cannot be read says so; the way back arrives only at its own profile's setup (`data-pb-profile`).
 * The lamps' own UI is B12's: here the lamp keys are stand-ins carrying the lamps' DOM contract (`data-pb-lamp`,
 * `data-pb-recipe`, setup/focus.ts) whose press runs the real lamp action (setup/act.ts through the DEV / ?e2e seam
 * `window.__onePatchbaySetup`). No AI request is sent; every server and name is fictional (tracker, *.example.com).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { TRACKER_SERVER, addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against the setup seam: (seam, arg) → value. */
const setup = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as { __onePatchbaySetup: AnyState }).__onePatchbaySetup, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>

/** The lamps' states of the profile's (first) set: "ok ok next dark …". */
const states = (page: Page) => setup(page, async (s) => ((await s.lamps('tracker')).sets[0].lamps as AnyState[]).map((l) => l.state).join(' '))
const sayOf = (page: Page, n: number) => setup(page, async (s, n) => (await s.lamps('tracker')).sets[0].lamps[n].say.key as string, n)

/**
 * Stand-ins for the lamp keys (B12 draws the real ones): buttons outside the app root carrying the lamps' DOM contract;
 * a press runs that lamp's action with the key as `from` — exactly what the band's keys do.
 */
async function lampKeys(page: Page, profile = 'tracker'): Promise<void> {
  await page.evaluate((profile) => {
    const id = profile === 'tracker' ? 'pb-stand-ins' : `pb-stand-ins-${profile}`
    document.getElementById(id)?.remove()
    const box = document.createElement('div')
    box.id = id
    box.style.cssText = `position:fixed;left:8px;bottom:${profile === 'tracker' ? 56 : 96}px;z-index:2;display:flex;gap:4px`
    for (let n = 0; n <= 6; n++) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${profile} ${n}`
      b.dataset.pbLamp = String(n)
      b.dataset.pbProfile = profile
      if (n >= 4) b.dataset.pbRecipe = 'mirror'
      b.addEventListener('click', () => void (window as unknown as { __onePatchbaySetup: AnyState }).__onePatchbaySetup.act(profile, 'mirror', n, `#${id} [data-pb-lamp="${n}"]`))
      box.append(b)
    }
    document.body.append(box)
  }, profile)
}
const lampKey = (page: Page, n: number, profile = 'tracker') => page.locator(`#${profile === 'tracker' ? 'pb-stand-ins' : `pb-stand-ins-${profile}`} [data-pb-lamp="${n}"]`)

async function press(page: Page, n: number): Promise<void> {
  await lampKey(page, n).focus()
  await page.keyboard.press('Enter')
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const UNTESTED = { ...TRACKER_SERVER, tools: undefined, checkedAt: undefined }

/** A tracker server of this device, Claude's key, the profile "tracker" (by name, the built-in mirror recipe). */
async function arrange(page: Page, server: AnyState = TRACKER_SERVER): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await setKey(page)
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), [server])
  expect(await addProfile(page, trackerProfile())).toBe(true)
  await page.evaluate(() => (window.location.hash = '#/patchbay?setup=tracker'))
  await expect(page).toHaveURL(/#\/patchbay\?setup=tracker$/)
  await lampKeys(page)
}

const onPatchbay = (page: Page) => expect(page).toHaveURL(/#\/patchbay\?setup=tracker$/)

/* ------------------------------------------------------------------ */

test.describe('Patchbay setup — dialogs over the patchbay (lamps 04 / 05)', () => {
  test('MirrorSetup and the agent editor open over #/patchbay; Esc gives the keyboard back to the lamp, a create or a save moves it on', async ({ page }) => {
    await arrange(page)
    await expect.poll(() => states(page)).toBe('ok ok ok ok next dark dark')

    // 04 → MirrorSetup as a dialog; the route stays; Esc → back on lamp 04
    await press(page, 4)
    const mirror = page.locator('.agx-mir')
    await expect(mirror).toBeVisible()
    await expect(mirror).toHaveAttribute('role', 'dialog')
    await onPatchbay(page)
    await page.keyboard.press('Escape')
    await expect(mirror).toHaveCount(0)
    await expect(lampKey(page, 4)).toBeFocused()

    // again → Create: the database and its report page; the dialog closes, 04 is green, the keyboard on lamp 05
    await page.keyboard.press('Enter')
    await expect(mirror).toBeVisible()
    await mirror.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(mirror).toHaveCount(0)
    await onPatchbay(page)
    await expect(lampKey(page, 5)).toBeFocused()
    await expect.poll(() => states(page)).toBe('ok ok ok ok ok next dark')
    const kept = await setup(page, (s) => s.kept('tracker', 'mirror'))
    expect(kept).not.toBeNull()
    expect(await wsEval(page, (s, id) => s.pages[id]?.title, kept!.dbId)).toBe('Tracker')
    expect(await sayOf(page, 5)).toBe('features.patchbay.lamp.agent.draftTab')

    // 05 → the editor with the kept draft over the patchbay; its note says what the setup made (with Undo)
    await page.keyboard.press('Enter')
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await onPatchbay(page)
    await expect(editor.getByTestId('agx-editor-intro')).toContainText('The database “Tracker” and the page')
    await expect(editor.getByTestId('agx-editor-intro-undo')).toBeVisible()
    // closing it unsaved asks (the setup made both); "Discard agent, keep both" → back on lamp 05, the draft is lost
    await page.keyboard.press('Escape')
    const ask = page.locator('.agx-discard')
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Discard agent, keep both' }).click()
    await expect(editor).toHaveCount(0)
    await expect(ask).toHaveCount(0)
    await expect(lampKey(page, 5)).toBeFocused()
    expect(await setup(page, (s) => s.kept('tracker', 'mirror'))).toBeNull()
    await expect.poll(() => sayOf(page, 5)).toBe('features.patchbay.lamp.agent.lost')
    await expect.poll(() => states(page)).toBe('ok ok ok ok ok next dark')

    // 05 with the draft lost → MirrorSetup again: "Use …" takes the database that is there and makes the draft again
    await page.keyboard.press('Enter')
    await expect(mirror).toBeVisible()
    await mirror.getByRole('button', { name: 'Use “Tracker”' }).click()
    await expect(mirror).toHaveCount(0)
    await expect(lampKey(page, 5)).toBeFocused()
    // still one database of that name
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === 'Tracker' && !p.trashed).length)).toBe(1)

    // 05 → the editor; nothing new was made this time (its report page taken back): no Undo in the note
    await page.keyboard.press('Enter')
    await expect(editor).toBeVisible()
    await expect(editor.getByTestId('agx-editor-intro')).toBeVisible()
    await expect(editor.getByTestId('agx-editor-intro-undo')).toHaveCount(0)
    // saved (switched off: the recipe's placeholders are still in it) → the dialog closes, 06 is next, its key focused
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await onPatchbay(page)
    await expect(lampKey(page, 6)).toBeFocused()
    await expect.poll(() => states(page)).toBe('ok ok ok ok ok ok next')
    expect(await sayOf(page, 6)).toBe('features.patchbay.lamp.firstRun.start')
    const agents = await wsEval(page, (s) => (Object.values(s.agents ?? {}) as AnyState[]).map((a) => ({ name: a.name, mirrorOf: a.mirrorOf, enabled: a.enabled })))
    expect(agents).toEqual([{ name: expect.stringContaining('Tracker'), mirrorOf: kept!.dbId, enabled: false }])

    // a green lamp opens its step as a quiet link: 05 → the saved agent in the editor (not new); Esc → back on 05
    await press(page, 5)
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(editor.getByTestId('agx-editor-intro')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(lampKey(page, 5)).toBeFocused()
    await onPatchbay(page)
  })
})

test.describe('Patchbay setup — the way back (return chip)', () => {
  test('lamp 02 → #/mcp with the Test key focused; the chip follows the lamps; ↵ on it → the next lamp’s key and "02 done · 04 next"', async ({ page }) => {
    await arrange(page, UNTESTED)
    await expect.poll(() => states(page)).toBe('ok ok next ok dark dark dark')
    await expect(page.getByTestId('pb-return')).toHaveCount(0)

    await press(page, 2)
    await expect(page).toHaveURL(/#\/mcp$/)
    const row = page.locator('.mcpc-row[data-row="one"][data-server="tracker"]')
    await expect(row.getByTestId('mcpc-test')).toBeFocused()
    // the lamp only opened the page: no test is running
    await expect(row).not.toHaveAttribute('data-testing', /.+/)
    const chip = page.getByTestId('pb-return-key')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAccessibleName('Back to setup · 02 next')
    expect(await setup(page, (s) => s.ret())).toMatchObject({ profileId: 'tracker', recipeId: 'mirror', next: 'test', away: true })

    // the test's result arrives (as the connection test writes it): the chip moves on to the lamp next now
    await wsEval(page, (s) => s.updateSettings({ mcpServers: (s.settings.mcpServers as AnyState[]).map((x) => (x.name === 'tracker' ? { ...x, tools: ['list_items', 'get_item', 'whoami'], checkedAt: Date.now() } : x)) }))
    await expect(chip).toHaveAccessibleName('Back to setup · 04 next')

    // ↵ on the chip: back on the patchbay, the keyboard on lamp 04, the polite live region says what happened
    await chip.focus()
    await page.keyboard.press('Enter')
    await onPatchbay(page)
    await expect(lampKey(page, 4)).toBeFocused()
    await expect(page.getByTestId('pb-return-live')).toHaveText('02 done · 04 next')
    await expect(page.getByTestId('pb-return')).toHaveCount(0)
    expect(await setup(page, (s) => s.ret())).toBeNull()
  })

  test('lamp 03 opens Integrations at the profile; Back is an arrival too; × closes the way back (keyboard to the main region)', async ({ page }) => {
    await arrange(page)
    await expect.poll(() => states(page)).toBe('ok ok ok ok next dark dark')

    // a green lamp's quiet link: Workspace › Integrations, that profile's first key has the keyboard
    await press(page, 3)
    await expect(page).toHaveURL(/#\/workspace\/integrations$/)
    const profileRow = page.locator('.int-row[data-id="tracker"]')
    await expect(profileRow.getByRole('button', { name: 'Edit: Tracker' })).toBeFocused()
    await expect(page.getByTestId('pb-return-key')).toHaveAccessibleName('Back to setup · 04 next')
    expect(await setup(page, (s) => s.ret())).toMatchObject({ next: 'database' })

    // Back (not the chip): an arrival all the same — 04 was next and still is
    await page.goBack()
    await onPatchbay(page)
    await expect(lampKey(page, 4)).toBeFocused()
    await expect(page.getByTestId('pb-return-live')).toHaveText('04 next')
    expect(await setup(page, (s) => s.ret())).toBeNull()

    // × on the chip: the way back goes, the keyboard goes to the main region (never the body)
    await press(page, 2)
    await expect(page).toHaveURL(/#\/mcp$/)
    const close = page.getByTestId('pb-return-close')
    await expect(close).toHaveAccessibleName('Close the way back to the setup')
    await close.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pb-return')).toHaveCount(0)
    expect(await setup(page, (s) => s.ret())).toBeNull()
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true)
    // coming back now is no arrival
    await page.evaluate(() => (window.location.hash = '#/patchbay?setup=tracker'))
    await onPatchbay(page)
    await page.waitForTimeout(400)
    await expect(lampKey(page, 4)).not.toBeFocused()
  })
})

test.describe('Patchbay setup — fix (rest)', () => {
  test('lamp 04 of a renamed mirror database in the trash opens the setup on it: Restore and Open, never a second database', async ({ page }) => {
    await arrange(page)
    await expect.poll(() => states(page)).toBe('ok ok ok ok next dark dark')
    const mirror = page.locator('.agx-mir')
    await press(page, 4)
    await mirror.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(mirror).toHaveCount(0)
    await expect(lampKey(page, 5)).toBeFocused()
    const kept = (await setup(page, (s) => s.kept('tracker', 'mirror')))!
    await page.keyboard.press('Enter')
    const editor = page.locator('.agx-editor')
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect.poll(() => states(page)).toBe('ok ok ok ok ok ok next')

    // renamed, then to the trash: lamp 04 names it by its name now
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Tickets' }), kept.dbId)
    await wsEval(page, (s, id) => s.trashPage(id), kept.dbId)
    await expect.poll(() => sayOf(page, 4)).toBe('features.patchbay.lamp.database.trashed')
    await press(page, 4)
    await expect(mirror).toBeVisible()
    await expect(mirror.getByRole('button', { name: /^Restore/ })).toBeVisible()
    await expect(mirror.getByRole('button', { name: /^Open/ })).toBeVisible()
    // Create waits (a second database of that agent is never made from here)
    await expect(mirror.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    // Restore brings it back: 04 is green again, nothing new was made
    await mirror.getByRole('button', { name: /^Restore/ }).click()
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id]?.trashed, kept.dbId)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(mirror).toHaveCount(0)
    await expect.poll(() => sayOf(page, 4)).toBe('features.patchbay.lamp.database.ok')
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && !p.trashed && /Tracker|Tickets/.test(p.title)).length)).toBe(1)
  })

  test('lamp 06 of a server agent in a local workspace: its runs cannot be read here — said, never busy for good', async ({ page }) => {
    await arrange(page)
    const dbId = await wsEval(page, (s) => s.createDatabase({ title: 'Tracker' }) as string)
    await wsEval(page, (s, a) => s.upsertAgent(a), {
      id: 'agMirror', name: 'Tracker mirror', instructions: 'x', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [dbId] }, write: 'stage', output: null,
      mcpServers: ['tracker'], runner: 'server', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1, mirrorOf: dbId,
    })
    await expect.poll(() => sayOf(page, 6)).toBe('features.patchbay.lamp.firstRun.unreadable')
    expect(await setup(page, async (s) => (await s.lamps('tracker')).sets[0].lamps[6].state)).not.toBe('busy')
  })

  test('the way back arrives only at its own setup: another profile’s setup keeps it and never takes the keyboard', async ({ page }) => {
    await arrange(page, UNTESTED)
    expect(await addProfile(page, trackerProfile({ id: 'other', name: 'Other', match: { name: 'other' } }))).toBe(true)
    await expect.poll(() => states(page)).toBe('ok ok next ok dark dark dark')
    await press(page, 2)
    await expect(page).toHaveURL(/#\/mcp$/)
    await expect(page.getByTestId('pb-return-key')).toBeVisible()

    // another profile's setup (e.g. "Set up in the Patchbay" on its row): no arrival — the way back stays
    await page.evaluate(() => (window.location.hash = '#/patchbay?setup=other'))
    await expect(page).toHaveURL(/#\/patchbay\?setup=other$/)
    await lampKeys(page, 'other')
    await page.waitForTimeout(800)
    await expect(page.getByTestId('pb-return-live')).toHaveText('')
    // no lamp key of either band took the keyboard
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-pb-lamp]'))).toBe(false)
    expect(await setup(page, (s) => s.ret())).toMatchObject({ profileId: 'tracker', next: 'test', away: true })
    await expect(page.getByTestId('pb-return-key')).toBeVisible()

    // its own setup: the arrival — tracker's lamp 02 (still next) has the keyboard, the way back is gone
    await page.evaluate(() => document.getElementById('pb-stand-ins-other')?.remove())
    await page.evaluate(() => (window.location.hash = '#/patchbay?setup=tracker'))
    await onPatchbay(page)
    await expect(lampKey(page, 2)).toBeFocused()
    await expect(page.getByTestId('pb-return-live')).toHaveText('02 next')
    expect(await setup(page, (s) => s.ret())).toBeNull()
  })
})

test.describe('Patchbay setup — the chip on the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('never shed: 390 px with XL text, German — inside the viewport, no sideways scroll, a 40 px target on touch', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.textScale', '4'))
    await arrange(page, UNTESTED)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await press(page, 2)
    await expect(page).toHaveURL(/#\/mcp$/)
    const chip = page.getByTestId('pb-return')
    await expect(chip).toBeVisible()
    await expect(page.getByTestId('pb-return-key')).toHaveAccessibleName('Zurück zur Einrichtung · 02 als Nächstes')
    const box = (await chip.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    const key = (await page.getByTestId('pb-return-key').boundingBox())!
    expect(key.height).toBeGreaterThanOrEqual(40)
    expect(key.width).toBeGreaterThanOrEqual(40)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // the words are the key's name; on the phone the number shows
    await expect(page.locator('.pb-ret__n')).toHaveText('02')
    await expect(page.locator('.pb-ret__text')).toBeHidden()
    await expect(page.getByTestId('pb-return-close')).toHaveAccessibleName('Rückweg zur Einrichtung schließen')
  })
})
