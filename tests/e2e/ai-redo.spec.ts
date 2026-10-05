/**
 * "Redo with instructions" (features/ai/redo + the redo purpose of the context picker): mark separate
 * passages, give instructions (presets, a rules page), one structured request in the background, the
 * review passage by passage, applied in one transaction. Claude is mocked (structured JSON answers);
 * request bodies are checked. Never api.anthropic.com.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, selectText, reloadApp, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const setKey = (page: Page, lang?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), lang)
const panel = (page: Page) => page.locator('.ai-panel')
const layer = (page: Page) => page.getByTestId('ctx-layer')
const rows = (page: Page) => layer(page).getByRole('option')
const bar = (page: Page) => page.getByTestId('ctx-bar')
const card = (page: Page) => page.getByTestId('redo-setup')
const review = (page: Page) => page.getByTestId('redo-review')
const toast = (page: Page, text: string | RegExp) => page.locator('.toast').filter({ hasText: text })

interface Captured {
  prompt: string
  body: AnyState
}

/**
 * api.anthropic.com → one structured answer per request: every passage of the prompt comes back with
 * " (redone)" appended (its Markdown kept). `gate`: the answer waits for it.
 */
async function mockRedo(ctx: BrowserContext, gate?: Promise<void>): Promise<Captured[]> {
  const captured: Captured[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    const prompt = String(body.messages?.[0]?.content ?? '')
    captured.push({ prompt, body })
    if (gate) await gate
    const items = [...prompt.matchAll(/<passage n="(\d+)">\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ n: Number(m[1]), markdown: `${m[2]} (redone)` }))
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 300, output_tokens: 200 } }),
    })
  })
  return captured
}

const linkPara = (before: string, bold: string, link: string): AnyState => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: before },
    { type: 'text', text: bold, marks: [{ type: 'bold' }] },
    { type: 'text', text: ' and a ' },
    { type: 'text', text: link, marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
    { type: 'text', text: '.' },
  ],
})

/** Caret on the empty last line, Space → the AI panel. */
async function openPanel(page: Page, id: string) {
  const ed = editorOf(page, id)
  await ed.locator('p').last().click()
  await ed.evaluate((root) => {
    const e = (root as unknown as { editor: AnyState }).editor
    e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run()
  })
  await page.waitForTimeout(150)
  await page.keyboard.press('Space')
  await expect(panel(page)).toBeVisible()
}

const textOf = (page: Page, id: string) =>
  editorOf(page, id).evaluate((root) => {
    const e = (root as unknown as { editor: AnyState }).editor
    const out: string[] = []
    e.state.doc.forEach((n: AnyState) => out.push(n.textContent))
    return out
  })

test.describe('redo with instructions', () => {
  test('three separate passages → instructions, preset, rules page, nothing else of the page → review by keys → one step, one ⌘Z', async ({ page, context }) => {
    const sent = await mockRedo(context)
    await openApp(page)
    await setKey(page)
    await createPage(page, { title: 'Style guide', content: doc(para('Always write RULESMARKER in plain words.')) })
    const id = await createPage(page, {
      title: 'Redo notes',
      content: doc(para('Alpha draft about the launch.'), para('Bravo SECRETBRAVO internal.'), para('Charlie draft about the beta.'), para('Delta SECRETDELTA notes.'), linkPara('Echo draft about ', 'the tracker', 'link'), para('')),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // a selection → Ask AI → Redo with instructions…: its block comes pre-marked
    await selectText(page, ed, 'draft about the launch')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await panel(page).getByRole('option', { name: /Redo with instructions/ }).click()
    await expect(layer(page)).toBeVisible()
    await expect(layer(page)).toHaveAttribute('data-purpose', 'redo')
    await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(bar(page)).toContainText(/Redo · 1 passage/i)
    await rows(page).nth(2).click()
    await rows(page).nth(4).click()
    await expect(bar(page)).toContainText(/Redo · 3 passages · 1\d words/i)
    // passages are numbered in document order
    await expect(rows(page).nth(4).locator('.ctx-row__n')).toHaveText('3')
    await page.keyboard.press('Enter')

    // the instructions card
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText(/Redo · 3 passages/i)
    await expect(card(page).getByRole('textbox', { name: 'Instructions' })).toBeFocused()
    await page.keyboard.type('Make it shorter and friendlier.')
    await card(page).getByRole('button', { name: /Save as preset/ }).click()
    await expect(card(page).getByTestId('redo-preset')).toHaveCount(1)
    // rename the preset
    await card(page).getByRole('button', { name: /rename or delete/ }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await card(page).getByRole('textbox', { name: 'Name of the preset' }).fill('Friendly')
    await page.keyboard.press('Enter')
    await expect(card(page).getByTestId('redo-preset')).toHaveText('Friendly')
    // the rules page
    await card(page).getByRole('button', { name: /Rules page/ }).click()
    await page.getByPlaceholder('Find a page…').fill('Style')
    await page.getByRole('menuitem', { name: 'Style guide' }).click()
    await expect(card(page).locator('.redo-rules__chip')).toContainText('Style guide')
    // nothing else of this page goes along: the reads line, and back to the card with everything kept
    await page.getByTestId('ai-reads').click()
    await panel(page).getByRole('option', { name: /Nothing from this page/ }).click()
    await expect(card(page).getByRole('textbox', { name: 'Instructions' })).toHaveValue('Make it shorter and friendlier.')
    await expect(page.getByTestId('ai-reads')).toHaveText(/3 passages \+ this page: nothing/i)
    await expect(card(page).locator('.redo-rules__chip')).toContainText('Style guide')

    await card(page).getByRole('textbox', { name: 'Instructions' }).press(`${MOD}+Enter`)
    await expect(review(page)).toBeVisible()
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 1\/3/i)
    await expect(panel(page).getByTestId('ai-run-reads')).toHaveText(/3 passages/i)

    // one request: numbered passages, the rules, the instructions — nothing unmarked
    expect(sent).toHaveLength(1)
    const prompt = sent[0].prompt
    expect(prompt).toContain('<passage n="1">\nAlpha draft about the launch.\n</passage>')
    expect(prompt).toContain('<passage n="2">\nCharlie draft about the beta.\n</passage>')
    expect(prompt).toContain('<passage n="3">\nEcho draft about **the tracker** and a [link](https://example.com/).\n</passage>')
    expect(prompt).toContain('RULESMARKER')
    expect(prompt).toContain('Make it shorter and friendlier.')
    for (const s of ['SECRETBRAVO', 'SECRETDELTA', '<page>']) expect(prompt).not.toContain(s)
    expect(JSON.stringify(sent[0].body.output_config?.format ?? sent[0].body)).toContain('"additionalProperties":false')

    // the review: removed words struck, added ones marked
    await expect(review(page).locator('ins')).toContainText('(redone)')
    // y accepts 1, n rejects 2, y accepts 3 → Enter applies
    await page.keyboard.press('y')
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 2\/3/i)
    await page.keyboard.press('n')
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 3\/3/i)
    await page.keyboard.press('y')
    await expect(page.getByTestId('redo-apply')).toHaveText(/Apply 2 passages/i)
    await page.keyboard.press('Enter')
    await expect(toast(page, '2 passages redone')).toBeVisible()
    await expect(panel(page)).toHaveCount(0)

    expect(await textOf(page, id)).toEqual(['Alpha draft about the launch. (redone)', 'Bravo SECRETBRAVO internal.', 'Charlie draft about the beta.', 'Delta SECRETDELTA notes.', 'Echo draft about the tracker and a link. (redone)', ''])
    // formatting and links stay
    await expect(ed.locator('p', { hasText: 'Echo draft' }).locator('strong')).toHaveText('the tracker')
    await expect(ed.locator('p', { hasText: 'Echo draft' }).locator('a[href="https://example.com/"]')).toHaveText('link')

    // one ⌘Z brings every passage back
    await ed.locator('p', { hasText: 'Bravo' }).click()
    await page.keyboard.press(`${MOD}+z`)
    expect(await textOf(page, id)).toEqual(['Alpha draft about the launch.', 'Bravo SECRETBRAVO internal.', 'Charlie draft about the beta.', 'Delta SECRETDELTA notes.', 'Echo draft about the tracker and a link.', ''])
  })

  test('block menu → runs in the background while you are elsewhere → back to the review; an image is skipped, a passage edited meanwhile stays', async ({ page, context }) => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const sent = await mockRedo(context, gate)
    await openApp(page)
    await setKey(page)
    const other = await createPage(page, { title: 'Elsewhere', content: doc(para('Another page.')) })
    const id = await createPage(page, {
      title: 'Redo notes',
      content: doc(para('Alpha draft about the launch.'), { type: 'image', attrs: { src: 'assets/covers/dunes.webp', alt: 'Dunes' } }, para('Charlie draft about the beta.'), para('')),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // the block menu: Redo with instructions… (Alpha pre-marked); the image and Charlie marked by keys
    await ed.locator('p', { hasText: 'Alpha draft' }).hover()
    await page.getByRole('button', { name: 'Block menu' }).click()
    await page.getByRole('menuitem', { name: /Redo with instructions/ }).click()
    await expect(layer(page)).toBeVisible()
    await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('j')
    await page.keyboard.press(' ')
    await page.keyboard.press('j')
    await page.keyboard.press(' ')
    await page.keyboard.press('Enter')
    await expect(card(page)).toContainText(/2 passages · \d+ words · 1 skipped/i)
    await card(page).getByRole('textbox', { name: 'Instructions' }).fill('Say it in fewer words.')
    await card(page).getByTestId('redo-run').click()
    await expect(page.getByTestId('ai-redo-wait')).toContainText(/Rewriting 2 passages/i)

    // elsewhere while it runs
    await page.keyboard.press('Escape')
    await gotoPage(page, other)
    release()
    await expect(toast(page, 'AI result ready · Redo notes')).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(sent[0].prompt).not.toContain('dunes')

    // back: the passage Charlie gets typed into before the review
    await gotoPage(page, id)
    await ed.evaluate((root) => {
      const e = (root as unknown as { editor: AnyState }).editor
      let at = -1
      e.state.doc.forEach((n: AnyState, pos: number) => {
        if (at < 0 && n.textContent.startsWith('Charlie')) at = pos + 1
      })
      e.chain().insertContentAt(at, 'Edited: ').run()
    })
    await page.getByTestId('ai-runs').locator('button').first().click()
    await expect(review(page)).toBeVisible()
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 1\/3/i)
    await page.keyboard.press('y')
    // the next open passage comes up; the image before it: skipped with a note
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 3\/3/i)
    await page.keyboard.press('k')
    await expect(page.getByTestId('redo-pos')).toHaveText(/Passage 2\/3/i)
    await expect(page.getByTestId('redo-state')).toHaveText('Skipped')
    await expect(review(page)).toContainText('images, databases, embeds')
    await page.keyboard.press('j')
    await page.keyboard.press('y')
    await page.keyboard.press('Enter')
    await expect(toast(page, '1 passage redone · 1 passage changed meanwhile — skipped')).toBeVisible()
    await expect(page.getByTestId('redo-state')).toHaveText('Changed meanwhile — skipped')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    const texts = await textOf(page, id)
    expect(texts[0]).toBe('Alpha draft about the launch. (redone)')
    expect(texts[2]).toBe('Edited: Charlie draft about the beta.')
    await expect(ed.locator('img')).toHaveCount(1)
  })

  test('DE · 390 px: /neu-machen in the terminal, presets saved, renamed, kept over a reload, deleted', async ({ page, context }) => {
    await mockRedo(context)
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page, 'de')
    const id = await createPage(page, { title: 'Notizen', content: doc(para('Erster Absatz zum Start.'), para('Zweiter Absatz.'), para('Dritter Absatz zum Test.'), para('')) })
    await gotoPage(page, id)

    // the terminal steps aside for the picker, the AI panel takes over
    await page.keyboard.press(`${MOD}+j`)
    const prompt = page.getByRole('textbox', { name: 'Aufgabe für den Agenten' })
    await expect(prompt).toBeFocused()
    await prompt.fill('/neu-machen')
    await prompt.press('Enter')
    await expect(layer(page)).toBeVisible()
    await page.keyboard.press('n')
    await rows(page).nth(0).click()
    await rows(page).nth(2).click()
    await expect(bar(page)).toContainText(/Neu machen · 2 Stellen · 8 Wörter/i)
    const done = bar(page).getByRole('button', { name: /Fertig/ })
    expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    await done.click()
    await expect(card(page)).toBeVisible()
    await expect(page.getByTestId('ai-redo-title')).toHaveText(/Neu machen mit Vorgaben/i)
    await expect(page.getByTestId('ai-reads')).toHaveText(/Liest\s*·\s*2 Stellen \+ diese Seite: ganz/i)
    await card(page).getByRole('textbox', { name: 'Vorgaben' }).fill('Kürzer, Du-Form.')
    await card(page).getByRole('button', { name: /Als Vorgabe speichern/ }).click()
    await expect(card(page).getByTestId('redo-preset')).toHaveText('Kürzer, Du-Form.')
    await card(page).getByRole('button', { name: /umbenennen oder löschen/ }).click()
    await page.getByRole('menuitem', { name: 'Umbenennen' }).click()
    await card(page).getByRole('textbox', { name: 'Name der Vorgabe' }).fill('Kurz')
    await page.keyboard.press('Enter')
    await expect(card(page).getByTestId('redo-preset')).toHaveText('Kurz')
    for (const el of [card(page), card(page).getByTestId('redo-run')]) {
      const box = (await el.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    // a reload keeps the preset (this device)
    await page.keyboard.press('Escape')
    await reloadApp(page)
    await gotoPage(page, id)
    await openPanel(page, id)
    await panel(page).locator('.ai-cmd__input').fill('neu machen')
    await panel(page).getByRole('option', { name: /Neu machen mit Vorgaben/ }).click()
    await expect(layer(page)).toBeVisible()
    await rows(page).nth(1).click()
    await bar(page).getByRole('button', { name: /Fertig/ }).click()
    await expect(card(page).getByTestId('redo-preset')).toHaveText('Kurz')
    // a chip puts its text into the field
    await card(page).getByRole('button', { name: 'Kurz', exact: true }).click()
    await expect(card(page).getByRole('textbox', { name: 'Vorgaben' })).toHaveValue('Kürzer, Du-Form.')
    // delete it
    await card(page).getByRole('button', { name: /umbenennen oder löschen/ }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await expect(card(page).getByTestId('redo-preset')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.redo.presets') ?? '[]'))).toEqual([])
  })
})
