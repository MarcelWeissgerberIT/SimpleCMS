/**
 * The Patchbay's profile drop and setup band — B12, P2 done (plan §1.12, §3.7, §6 U3 / U4 / U7 / U25 / U26, mock-2):
 *  - a `.integration.json` dropped on the page: while it hovers the bench shows the drop zone ("Release to check the
 *    profile" / "Only .integration.json"); a wrong type and an invalid profile go to the plate under the head (its
 *    first problems with line and column, "Choose a file"); Paste is a dialog with the shared CodeArea;
 *  - a valid drop: the band (its tab "Profile dropped · <file> · IN-01"), the ghosts dotted with their step chips, the
 *    planned cables dotted, the readout "+4 from profile · +5 planned · SETUP 4/7", what the profile does not touch
 *    folded and named, § 00 the lamps as an <ol> with their state as words and `aria-current="step"`, the keyboard on
 *    the next lamp's key;
 *  - ↵ on 04 → MirrorSetup over the patchbay; create → 04 green, the keyboard on 05; ↵ → the agent editor over the
 *    patchbay; save → 06 next; ↵ → run by hand (a mocked Claude) → "review" → #/agents/<id> → the return chip → back,
 *    the keyboard on the lamp that is next, said politely;
 *  - Mod+Z right after the drop takes the profile back; after 04's create it does not (the key reads "Close setup");
 *    a same-id drop asks first ("Replaces …") and Undo puts the old profile back;
 *  - a reload shows the strip, not the band; × closes it; Integrations › "Set up in the Patchbay" opens it again; the
 *    status bar's cell "SETUP · 04 NEXT"; "What does 04 create?"; recipe tabs; the phone's vertical lamps.
 * A mocked Claude API only; every name is fictional (tests/fixtures/patchbay.ts — tracker, Tessera, *.example).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, MOD } from './fixtures'
import { mock2, profileFile, seedPatchbay, trackerCnsx, world, type PbWorld } from '../fixtures/patchbay'
import { TRACKER } from '../fixtures/patchbay-fuses'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const FILE = 'tracker-cnsx.integration.json'
const PID = 'in-01'

/** A file dragged onto the page: it hovers (`drop` false), leaves again (`leave`), or is dropped (the default). */
async function dragFile(page: Page, name: string, text: string, opts: { type?: string; drop?: boolean; leave?: boolean } = {}) {
  await page.evaluate(
    ({ name, text, type, drop, leave }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([text], name, { type }))
      const target = document.querySelector('[data-testid="pb-bench"]') ?? document.querySelector('[data-testid="patchbay-page"]')!
      const fire = (ev: string) => target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
      if (leave) return void fire('dragleave')
      fire('dragenter')
      fire('dragover')
      if (drop) fire('drop')
    },
    { name, text, type: opts.type ?? 'application/json', drop: opts.drop ?? !opts.leave, leave: opts.leave ?? false },
  )
}
const dropProfile = (page: Page, p: AnyState = trackerCnsx(), name = FILE) => dragFile(page, name, profileFile(p as never))

async function arrange(page: Page, lang: 'en' | 'de' = 'en', w: PbWorld = mock2()) {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await seedPatchbay(page, w)
  await wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', language: lang }), lang)
  await page.evaluate(() => (window.location.hash = '#/patchbay'))
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
  await expect(page.locator('[data-testid="pb-rack"], [data-testid="pb-strands"], [data-testid="pb-empty"]').first()).toBeVisible()
}

const lampKey = (page: Page, n: number) => page.locator(`[data-pb-lamp="${n}"][data-pb-profile="${PID}"]`).first()
const states = (page: Page) => page.getByTestId('pb-lamp').evaluateAll((els) => els.map((e) => e.getAttribute('data-s')).join(' '))
const profiles = (page: Page) => wsEval(page, (s) => ((s.integrations ?? []) as AnyState[]).map((p) => `${p.id}:${p.name}`))
const clearToasts = (page: Page) => page.evaluate(() => (window as unknown as { __one: { ui: { setState: (s: unknown) => void } } }).__one.ui.setState({ toasts: [], waitingToasts: [] }))

test.describe('Patchbay setup — the drop', () => {
  test('drop zone, a wrong type and an invalid profile in the plate, Paste in a CodeArea; a valid drop → the band, ghosts, planned cables, readout, lamps', async ({ page }) => {
    await arrange(page)
    // hovering: a JSON file → "Release to check the profile"; it leaves → the zone goes
    await dragFile(page, FILE, '{}', { drop: false })
    await expect(page.getByTestId('pb-dropzone')).toHaveText('Release to check the profile')
    await dragFile(page, FILE, '{}', { drop: false, leave: true })
    await expect(page.getByTestId('pb-dropzone')).toHaveCount(0)
    // any other type → "Only .integration.json"
    await dragFile(page, 'cover.png', 'x', { type: 'image/png', drop: false })
    await expect(page.getByTestId('pb-dropzone')).toHaveText('Only .integration.json')
    await dragFile(page, 'cover.png', 'x', { type: 'image/png', drop: false, leave: true })

    // dropped: a text file is no profile — the plate says so, nothing is saved
    await dragFile(page, 'notes.txt', 'hello', { type: 'text/plain' })
    const plate = page.getByTestId('pb-dropplate')
    await expect(plate).toHaveAttribute('data-why', 'type')
    await expect(plate).toContainText('notes.txt')
    await expect(plate).toContainText('Only .integration.json')
    // invalid JSON: its first problem with line and column, "Choose a file"
    await dragFile(page, 'broken.integration.json', '{\n  "id": "in-01",\n  "name": \n}')
    await expect(plate).toHaveAttribute('data-why', 'invalid')
    await expect(page.getByTestId('pb-drop-problems').locator('li').first()).toContainText(/line \d+:\d+/)
    await expect(plate.getByTestId('pb-drop-choose')).toBeVisible()
    // the plate has the keyboard (its heading) — and nothing was saved
    await expect(plate.locator('[data-pb-plate-h]')).toBeFocused()
    expect(await profiles(page)).toEqual([])
    await plate.getByRole('button', { name: 'Close the message' }).click()
    await expect(plate).toHaveCount(0)

    // the chip: Choose a file · Paste — Paste is the shared CodeArea (never a plain textarea)
    await page.getByTestId('pb-drop').click()
    await page.getByRole('menuitem', { name: 'Paste the profile …' }).click()
    const dialog = page.getByRole('dialog', { name: 'Paste a profile' })
    await expect(dialog).toBeVisible()
    const area = dialog.getByTestId('pb-paste-area')
    await expect(area).toBeVisible()
    await expect(area.locator('textarea')).toHaveCount(1)
    await area.locator('textarea').fill('{ "schema": "one.integration/1", "id": "in-01" ')
    await dialog.getByTestId('pb-paste-check').click()
    await expect(dialog.getByTestId('pb-paste-said')).toContainText(/problem/)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await profiles(page)).toEqual([])

    // the profile dropped: the band, its tab, the ghosts, the planned cables
    await dropProfile(page)
    const band = page.getByTestId('pb-band')
    await expect(band).toBeVisible()
    await expect(page.getByTestId('pb-band-tab')).toContainText('Profile dropped')
    await expect(page.getByTestId('pb-band-tab')).toContainText(`${FILE} · IN-01`)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
    const ghosts = band.locator('[data-testid="pb-module"][data-ghost]')
    await expect(ghosts).toHaveCount(4)
    await expect(band.locator('[data-testid="pb-module"][data-kind="agent"][data-ghost]')).toContainText('Tessera-Spiegel')
    await expect(band.locator('[data-testid="pb-module"][data-kind="agent"][data-ghost] [data-testid="pb-ghost-win"]')).toHaveText('not created')
    await expect(band.locator('[data-testid="pb-module"][data-kind="database"][data-ghost] [data-testid="pb-step"]')).toHaveText('04')
    await expect(band.locator('[data-testid="pb-module"][data-kind="database"][data-ghost] [data-testid="pb-step"]')).toHaveAttribute('data-next', 'true')
    await expect(page.locator('.pb-w--planned')).toHaveCount(5)
    // the readout: what the profile adds, the setup's count
    await expect(page.getByTestId('pb-ro-modules')).toContainText('+ 4 from profile')
    await expect(page.getByTestId('pb-ro-modules')).toContainText('· 3 idle')
    await expect(page.getByTestId('pb-ro-cables')).toContainText('+ 5 planned')
    await expect(page.getByTestId('pb-ro-setup')).toHaveText('4/7')
    // every number matches what is drawn or folded: drawn real modules + the folded untouched ones = MODULES' first figure
    const counts = await page.evaluate(() => {
      const real = document.querySelectorAll('[data-testid="pb-band"] [data-testid="pb-module"]:not([data-ghost])').length
      const folded = [...document.querySelectorAll('[data-testid="pb-band-folds"] .pb-fold--setup .pb-fold__label')].reduce((n, e) => n + Number(e.textContent), 0)
      return { real, folded, shown: Number(document.querySelector('[data-testid="pb-ro-modules"]')!.firstChild!.textContent) }
    })
    expect(counts.real + counts.folded).toBe(counts.shown)
    await expect(page.getByTestId('pb-untouched')).toContainText(`Not touched by the profile · ${counts.folded} modules`)
    // § 00: an <ol> of lamps, their state as words, the next one aria-current="step", "4/7 done"
    await expect(page.getByTestId('pb-setup-lamps')).toHaveJSProperty('tagName', 'OL')
    expect(await states(page)).toBe('ok ok ok ok next dark dark')
    await expect(page.getByTestId('pb-lamp-state')).toHaveText(['Done', 'Done', 'Done', 'Done', 'Next', 'Later', 'Later'])
    await expect(page.locator('[data-testid="pb-lamp"][aria-current="step"]')).toHaveAttribute('data-n', '4')
    await expect(page.getByTestId('pb-setup-count')).toHaveText('4/7 done')
    await expect(lampKey(page, 5)).toHaveAttribute('aria-disabled', 'true')
    await expect(lampKey(page, 5)).toHaveText('after 04')
    // the keyboard is on the next lamp's key; the chip is gone while the band is on
    await expect(lampKey(page, 4)).toBeFocused()
    await expect(lampKey(page, 4)).toHaveText(/Create database/)
    await expect(page.getByTestId('pb-drop')).toHaveCount(0)
    // the band's legend: ↵ next lamp · Mod+Z profile back
    await expect(page.getByTestId('pb-legend')).toContainText('next lamp')
    await expect(page.getByTestId('pb-legend')).toContainText('profile back')
  })

  test('“What does 04 create?” lists the recipe’s fields and views; a profile with two recipes has recipe tabs, each its own 04–06', async ({ page }) => {
    await arrange(page)
    await dropProfile(page)
    await page.getByTestId('pb-what-key').click()
    const what = page.getByTestId('pb-what')
    await expect(what).toBeVisible()
    await expect(what).toContainText('Database “Tessera Handoff”')
    expect(await what.getByTestId('pb-what-fields').locator('li').count()).toBeGreaterThan(3)
    await expect(what).toContainText('Report page')
    await page.keyboard.press('Escape')
    await expect(what).toHaveCount(0)
    await expect(page.getByTestId('pb-what-key')).toBeFocused()

    // two recipes: tabs; the second one's lamps and count
    await clearToasts(page)
    const two = trackerCnsx({ id: 'in-02', name: 'Tessera Zwei', recipes: [trackerCnsx().recipes![0], { kind: 'mirror', id: 'second', database: { name: 'Tessera Archiv' } }] })
    await dropProfile(page, two, 'tessera-zwei.integration.json')
    const tabs = page.getByTestId('pb-recipe-tab')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    // fix mid: each tab named by the database its recipe makes (both recipes are "Mirror a list into a database")
    await expect(tabs.nth(0)).toContainText('Tessera Handoff')
    await expect(tabs.nth(1)).toContainText('Tessera Archiv')
    await expect(tabs.nth(1)).toHaveAttribute('title', 'Mirror a list into a database')
    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-testid="pb-band"] [data-testid="pb-module"][data-kind="database"][data-ghost]')).toContainText('Tessera Archiv')
    await expect(page.locator('[data-pb-lamp="4"][data-pb-profile="in-02"]')).toHaveAttribute('data-pb-recipe', 'second')
  })
})

/** A mocked Claude: request n gets script[n] (Messages API SSE, served as the model the request asked for); later ones a short "Done.". */
async function mockClaude(ctx: BrowserContext, script: Array<(body: AnyState) => string>) {
  let n = 0
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    const step = script[n++] ?? ((b: AnyState) => sse(b, [{ type: 'text', text: 'Done.' }]))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) }).catch(() => undefined)
  })
}
let seq = 0
function sse(req: AnyState, blocks: AnyState[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let out = ev('message_start', { message: { id: `msg_pb_${++seq}`, type: 'message', role: 'assistant', model: String(req.model ?? ''), content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    out += ev('content_block_stop', { index })
  })
  out += ev('message_delta', { delta: { stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 60 } })
  out += ev('message_stop', {})
  return out
}

test.describe('Patchbay setup — the lamps lead through the setup', () => {
  test('↵ 04 → MirrorSetup over the patchbay → 05 → the editor → 06 → run by hand → review → the return chip → back on the next lamp', async ({ page, context }) => {
    test.setTimeout(120_000)
    await arrange(page)
    await dropProfile(page)
    await expect(lampKey(page, 4)).toBeFocused()

    // 04: MirrorSetup as a dialog over #/patchbay, at this profile's recipe
    await page.keyboard.press('Enter')
    const mirror = page.locator('.agx-mir')
    await expect(mirror).toBeVisible()
    await expect(page).toHaveURL(/#\/patchbay/)
    await mirror.getByRole('button', { name: 'Create database', exact: true }).click()
    await expect(mirror).toHaveCount(0)
    await expect(lampKey(page, 5)).toBeFocused()
    expect(await states(page)).toBe('ok ok ok ok ok next dark')
    // the database is real now: no database ghost; the agent still one
    await expect(page.locator('[data-testid="pb-band"] [data-testid="pb-module"][data-kind="database"][data-ghost]')).toHaveCount(0)
    await expect(page.locator('[data-testid="pb-band"] [data-testid="pb-module"][data-kind="agent"][data-ghost]')).toHaveCount(1)

    // 05: the agent editor over the patchbay; save → 06 next, its key has the keyboard
    await page.keyboard.press('Enter')
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await expect(page).toHaveURL(/#\/patchbay/)
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(lampKey(page, 6)).toBeFocused()
    expect(await states(page)).toBe('ok ok ok ok ok ok next')
    await expect(page.locator('[data-testid="pb-band"] [data-testid="pb-module"][data-ghost]')).toHaveCount(0)

    // 06: run by hand (a mocked Claude proposes one row) → "1 proposal to review"
    const agent = await wsEval(page, (s) => (Object.values(s.agents ?? {}) as AnyState[]).find((a) => a.mirrorOf) as AnyState)
    const key = await wsEval(page, (s, db) => ((s.databases[db]?.properties ?? []) as AnyState[]).find((p) => p.key)?.name as string, agent.mirrorOf as string)
    await mockClaude(context, [(b) => sse(b, [{ type: 'tool_use', id: 'tu1', name: 'upsert_rows', input: { database_id: agent.mirrorOf, key_property: key, rows: [{ key: 'T-1', title: 'Launch plan', properties: {} }] } }])])
    await page.keyboard.press('Enter')
    await expect(lampKey(page, 6)).toHaveText('Review proposals', { timeout: 30_000 })
    await expect(page.locator('[data-testid="pb-lamp"][data-n="6"]')).toContainText('1 proposal to review')

    // review → #/agents/<id>; the return chip leads back; the keyboard on the lamp next, said politely
    await lampKey(page, 6).click()
    await expect(page).toHaveURL(new RegExp(`#/agents/${agent.id}$`))
    const chip = page.getByTestId('pb-return-key')
    await expect(chip).toHaveAccessibleName('Back to setup · 06 next')
    await chip.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#/patchbay\\?setup=${PID}$`))
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await expect(lampKey(page, 6)).toBeFocused()
    await expect(page.getByTestId('pb-return-live')).toHaveText('06 next')
  })
})

test.describe('Patchbay setup — Undo, replace, strip', () => {
  test('Mod+Z right after the drop takes the profile back; after 04’s create it does not and the key reads “Close setup”; a same-id drop asks first and Undo restores the old one', async ({ page }) => {
    await arrange(page)
    // right after the drop: Mod+Z (focus in the page) removes it — the band goes, the chip is back
    await dropProfile(page)
    await expect(page.getByTestId('pb-band-undo')).toBeVisible()
    await page.keyboard.press(`${MOD}+z`)
    await expect(page.getByTestId('pb-band')).toHaveCount(0)
    expect(await profiles(page)).toEqual([])
    await expect(page.getByTestId('pb-drop')).toBeVisible()

    // dropped again; 04 creates the database → the first lamp write: Undo is over, the key reads "Close setup"
    await clearToasts(page)
    await dropProfile(page)
    await page.keyboard.press('Enter')
    await page.locator('.agx-mir').getByRole('button', { name: 'Create database', exact: true }).click()
    await expect(lampKey(page, 5)).toBeFocused()
    await expect(page.getByTestId('pb-band-undo')).toHaveCount(0)
    await expect(page.getByTestId('pb-band-close')).toHaveText('Close setup')
    await page.keyboard.press(`${MOD}+z`)
    await page.waitForTimeout(300)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
    await expect(page.getByTestId('pb-legend')).not.toContainText('profile back')

    // the same id again: asked first ("Replaces “Tessera”"); Replace → the new one; Undo → the old one is back
    await page.getByTestId('pb-band-close').click()
    await expect(page.getByTestId('pb-band')).toHaveCount(0)
    await dropProfile(page, trackerCnsx({ name: 'Tessera neu' }))
    const plate = page.getByTestId('pb-dropplate')
    await expect(plate).toContainText('Replaces “Tessera”')
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
    await plate.getByTestId('pb-drop-replace').click()
    await expect(page.getByTestId('pb-band')).toBeVisible()
    expect(await profiles(page)).toEqual([`${PID}:Tessera neu`])
    await page.getByTestId('pb-band-undo').click()
    await expect(page.getByTestId('pb-band')).toHaveCount(0)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
  })

  test('a reload shows the strip, not the band; × closes it; Integrations › “Set up in the Patchbay” opens the band again; the status cell', async ({ page }) => {
    await arrange(page)
    await dropProfile(page)
    await expect(page.getByTestId('pb-band')).toBeVisible()
    // the status bar's cell (a wide window: the bar sheds nothing)
    await page.setViewportSize({ width: 1920, height: 900 })
    await expect(page.getByTestId('patchbay-status-setup')).toHaveText('Setup · 04 next')
    await page.setViewportSize({ width: 1440, height: 900 })

    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    const strip = page.getByTestId('pb-setup-strip')
    await expect(strip).toBeVisible()
    await expect(strip).toContainText(`Setup ${PID} · 4/7 · 04 next`)
    await expect(page.getByTestId('pb-band')).toHaveCount(0)
    // the ghosts stay dotted in place; the normal readout keeps RUNS TODAY and LIVE
    await expect(page.locator('[data-testid="pb-module"][data-ghost]')).toHaveCount(4)
    await expect(page.getByTestId('pb-ro-runs')).toBeVisible()
    await expect(page.getByTestId('pb-ro-setup')).toHaveCount(0)
    // the strip's key carries the lamps' contract (the way back lands on it)
    await expect(strip.getByTestId('pb-strip-key')).toHaveAttribute('data-pb-lamp', '4')

    // × closes it (also after a reload); the chip is back
    await strip.getByTestId('pb-strip-close').click()
    await expect(strip).toHaveCount(0)
    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('pb-rack')).toBeVisible()
    await page.waitForTimeout(400)
    await expect(page.getByTestId('pb-setup-strip')).toHaveCount(0)

    // ⌘K "Set up in the Patchbay: Tessera" (typed): the band
    await page.evaluate(() => (window.location.hash = '#/workspace/overview'))
    await page.keyboard.press(`${MOD}+k`)
    await page.getByRole('combobox').or(page.locator('.pal-scrim input')).first().fill('Set up in the Patchbay')
    await expect(page.getByRole('option', { name: 'Set up in the Patchbay: Tessera' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#/patchbay\\?setup=${PID}$`))
    await expect(page.getByTestId('pb-band')).toBeVisible()

    // Integrations › "Set up in the Patchbay": the band again (it only reads)
    await page.evaluate(() => (window.location.hash = '#/workspace/integrations'))
    await page.locator(`.int-row[data-id="${PID}"]`).getByTestId('int-setup').click()
    await expect(page).toHaveURL(new RegExp(`#/patchbay\\?setup=${PID}$`))
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await expect(page.getByTestId('pb-band-tab')).toContainText('Setting up a profile')
    // no drop to take back: the key closes the setup
    await expect(page.getByTestId('pb-band-close')).toBeVisible()
  })
})

/* ------------------------------------------------------------------ fix mid */

/** Settings opened quietly / anything else: every request to the Claude API counted (and refused — nothing is answered). */
async function countClaude(page: Page): Promise<() => number> {
  let n = 0
  await page.route('https://api.anthropic.com/**', (route) => {
    if (route.request().method() === 'POST') n++
    return route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '{}' })
  })
  return () => n
}
const tested = (page: Page, on: boolean) =>
  wsEval(page, (s, on) => s.updateSettings({ mcpServers: (s.settings.mcpServers as AnyState[]).map((x) => (x.name === 'tracker' ? { ...x, tools: on ? ['query_issues', 'get_issue', 'whoami', 'create_issue', 'update_issue', 'add_comment', 'post_status'] : undefined, checkedAt: on ? Date.now() : undefined } : x)) }), on)

test.describe('Patchbay setup — fix mid: the drop’s Undo, the setup record, lamps without a recipe', () => {
  test('the drop’s Undo lives only in its visit: after leaving and coming back no Undo key, Mod+Z keeps the profile, “Show the whole setup” offers none; the taken-back toast names the profile', async ({ page }) => {
    await arrange(page)
    await dropProfile(page)
    // taken back right away: the toast and the polite region name the profile, never its id
    await page.keyboard.press(`${MOD}+z`)
    await expect(page.locator('.toast').filter({ hasText: 'taken back' }).last()).toHaveText(/Profile “Tessera” taken back/)
    await expect(page.getByTestId('pb-live')).toHaveText('Profile “Tessera” taken back')
    expect(await profiles(page)).toEqual([])

    // dropped again; the visit ends (another route); back: the strip, no Undo anywhere
    await clearToasts(page)
    await dropProfile(page)
    await expect(page.getByTestId('pb-band-undo')).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/workspace/overview'))
    await expect(page.getByTestId('patchbay-page')).toHaveCount(0)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('pb-setup-strip')).toBeVisible()
    await expect(page.getByTestId('pb-band-undo')).toHaveCount(0)
    await page.getByRole('heading', { level: 1 }).focus()
    await page.keyboard.press(`${MOD}+z`)
    await page.waitForTimeout(300)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
    await expect(page.getByTestId('pb-legend')).not.toContainText('profile back')
    // the whole setup again from the strip: the band — its key closes the setup, no Undo
    await page.getByTestId('pb-strip-open').click()
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await expect(page.getByTestId('pb-band-undo')).toHaveCount(0)
    await expect(page.getByTestId('pb-band-close')).toBeVisible()
    await page.keyboard.press(`${MOD}+z`)
    await page.waitForTimeout(300)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
  })

  test('a lamp that turns green off the page ends the Undo: 02 → #/mcp, the test passes there, the drop toast’s Undo is refused', async ({ page }) => {
    await arrange(page)
    await tested(page, false)
    await dropProfile(page)
    await expect(lampKey(page, 2)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/mcp$/)
    // the connection test's result arrives (as the test writes it): 02 is green — the setup made something
    await tested(page, true)
    await expect(page.getByTestId('pb-return-key')).toHaveAccessibleName('Back to setup · 04 next')
    await page.locator('.toast').filter({ hasText: 'Profile “Tessera” dropped' }).getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.toast').filter({ hasText: 'The setup has begun' })).toBeVisible()
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
  })

  test('a replace taken back keeps the setup record as it was: the strip of the setup in progress comes back', async ({ page }) => {
    await arrange(page)
    await wsEval(page, (s, p) => s.upsertIntegration(p), trackerCnsx() as AnyState)
    // "Set up in the Patchbay" from Integrations, then away and back: the strip
    await page.evaluate(() => (window.location.hash = '#/workspace/integrations'))
    await page.locator(`.int-row[data-id="${PID}"]`).getByTestId('int-setup').click()
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/workspace/overview'))
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    await expect(page.getByTestId('pb-setup-strip')).toHaveCount(1)
    // a corrected file of the same id: Replace, then Undo — the old profile and its strip back
    await dropProfile(page, trackerCnsx({ name: 'Tessera neu' }))
    await page.getByTestId('pb-dropplate').getByTestId('pb-drop-replace').click()
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await page.getByTestId('pb-band-undo').click()
    await expect(page.getByTestId('pb-band')).toHaveCount(0)
    expect(await profiles(page)).toEqual([`${PID}:Tessera`])
    await expect(page.getByTestId('pb-setup-strip')).toHaveCount(1)
  })

  test('a profile without a recipe: the band holds its server and lamps 00–03 (never folded as untouched)', async ({ page }) => {
    await arrange(page)
    await dropProfile(page, trackerCnsx({ recipes: [] }))
    const band = page.getByTestId('pb-band')
    await expect(band).toBeVisible()
    await expect(page.getByTestId('pb-lamp')).toHaveCount(4)
    await expect(band.locator('[data-testid="pb-module"][data-kind="server"]').filter({ hasText: 'tracker' })).toHaveCount(1)
    await expect(page.locator('[data-testid="pb-band-folds"]')).not.toContainText('tracker')
  })

  test('a profile without a recipe in an empty workspace: the band and its lamps instead of the empty rack, the keyboard on the next lamp', async ({ page }) => {
    await arrange(page, 'en', world({ servers: [TRACKER({ enabled: false })] }))
    await expect(page.getByTestId('pb-empty')).toBeVisible()
    await dropProfile(page, trackerCnsx({ recipes: [] }))
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await expect(page.getByTestId('pb-empty')).toHaveCount(0)
    await expect(page.getByTestId('pb-lamp')).toHaveCount(4)
    await expect(lampKey(page, 1)).toBeFocused()
  })

  test('lamp 01 opens Settings quietly — no server is checked on its own; switched on there, Esc moves the keyboard on to the next lamp', async ({ page }) => {
    await arrange(page)
    const claude = await countClaude(page)
    await wsEval(page, (s) => s.updateSettings({ mcpServers: (s.settings.mcpServers as AnyState[]).map((x) => (x.name === 'tracker' ? { ...x, enabled: false } : x)) }))
    await dropProfile(page)
    await expect(lampKey(page, 1)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('mcp-servers')).toBeVisible()
    await page.waitForTimeout(800)
    expect(claude()).toBe(0)
    await expect(page.locator('.mcps-check, [data-checking]').filter({ hasText: /checking/i })).toHaveCount(0)
    // the server switched on in the dialog, then Esc: the keyboard on 04 (no longer on 01's quiet "Open")
    await page.locator('.mcps-card[data-id="srvTracker"]').getByRole('switch').first().click()
    await expect.poll(() => wsEval(page, (s) => (s.settings.mcpServers as AnyState[]).find((x) => x.name === 'tracker')?.enabled)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mcp-servers')).toHaveCount(0)
    await expect(lampKey(page, 4)).toBeFocused()
    expect(claude()).toBe(0)
  })

  test('lamp 00 opens the assistant; the key saved there, Esc moves the keyboard on to the next lamp — not back to 00’s quiet “Open”', async ({ page }) => {
    await arrange(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: '' }))
    await dropProfile(page)
    await expect(lampKey(page, 0)).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible()
    // the key arrives (as step 02 saves it)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await expect.poll(() => states(page)).toBe('ok ok ok ok next dark dark')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(lampKey(page, 4)).toBeFocused()
  })

  test('1440 German: a key wider than its lamp column stays one line, centred over its column (mock-2) — the sentences keep their own columns', async ({ page }) => {
    await arrange(page, 'de')
    await dropProfile(page)
    await expect(lampKey(page, 4)).toContainText('Datenbank anlegen')
    const boxes = await page.getByTestId('pb-lamp').evaluateAll((els) =>
      els.map((li) => {
        const r = li.getBoundingClientRect()
        const say = li.querySelector('.pb-lamp__say')!.getBoundingClientRect()
        const key = li.querySelector('[data-pb-lamp]')?.getBoundingClientRect()
        return { l: r.left, r: r.right, sl: say.left, sr: say.right, kl: key?.left ?? r.left, kr: key?.right ?? r.right, kh: key?.height ?? 0 }
      }),
    )
    for (const b of boxes) {
      // each sentence in its own column; a key at most a few pixels past it, centred
      expect(b.sl).toBeGreaterThanOrEqual(b.l - 0.5)
      expect(b.sr).toBeLessThanOrEqual(b.r + 0.5)
      expect(b.kl).toBeGreaterThanOrEqual(b.l - 11)
      expect(b.kr).toBeLessThanOrEqual(b.r + 11)
      expect(Math.abs(b.kl + b.kr - (b.l + b.r))).toBeLessThanOrEqual(1)
    }
    // "Datenbank anlegen" on one line, as in mock-2
    expect(boxes[4].kh).toBeLessThanOrEqual(34)
    // clear gaps between neighbouring sentences, and between neighbouring keys
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].sl - boxes[i - 1].sr).toBeGreaterThanOrEqual(8)
      expect(boxes[i].kl - boxes[i - 1].kr).toBeGreaterThanOrEqual(8)
    }
  })
})

test.describe('Patchbay setup — the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('390 px: the card with the lamps one under the other, what gets created, what is not touched — no sideways scroll', async ({ page }) => {
    await arrange(page, 'de')
    await expect(page.getByTestId('patchbay-page')).toHaveAttribute('data-view', 'strands')
    await dropProfile(page)
    const card = page.getByTestId('pb-setup-card')
    await expect(card).toBeVisible()
    await expect(card.locator('.pb-lampsbox')).toHaveAttribute('data-v', 'true')
    await expect(page.getByTestId('pb-setup-count')).toContainText('4/7')
    await expect(page.getByTestId('pb-ro-setup')).toHaveText('4/7')
    await expect(page.locator('[data-testid="pb-strand"][data-ghost]')).toHaveCount(1)
    await expect(page.getByTestId('pb-strands-untouched')).toBeVisible()
    await expect(lampKey(page, 4)).toHaveText(/Datenbank anlegen/)
    const box = (await lampKey(page, 4).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(40)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('fix mid · 390 px, a profile without a recipe: the card with lamps 00–03 — no “what gets created”', async ({ page }) => {
    await arrange(page)
    await dropProfile(page, trackerCnsx({ recipes: [] }))
    const card = page.getByTestId('pb-setup-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('pb-lamp')).toHaveCount(4)
    await expect(page.getByTestId('pb-ro-setup')).toHaveText('4/4')
    await expect(page.getByTestId('pb-strands')).not.toContainText('What gets created')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
