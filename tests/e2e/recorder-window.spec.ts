/**
 * Flight recorder — reading a window (R2): the story's run 212 read through the plate (meters, held note, held
 * diamonds), the read dialog (groups, picked place, value diff and word diff in ink, foreign changes marked), the keys
 * (↵ on the tape, a focused flag, a tick's popover), partial windows and their extend key, a lost tail, the incident
 * report (titles, counts, schema names — never values or text), and the guarantee that reading writes nothing. Test
 * data is fictional (Nordlicht, Tessera, the story: tests/e2e/fixtures/recorder-story.json).
 */
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval } from './fixtures'
import { playStory, rec, seedPrivacyRun, startRecorder, storyTime, type Story } from './helpers/recorder'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const AGENT = `agent:${story.agent.id}`
const RUN = story.expect.run212.key

/** The app at the story's morning, the tape holding only the story. */
async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

const window212 = () => ({ lane: AGENT, run: RUN, a: storyTime(story, story.bracket[0]), b: storyTime(story, story.bracket[1]) })

const deck = (page: Page) => page.locator('section.deck')
const dialog = (page: Page) => page.locator('.modal.rec-read:not(.rec-sheet2)')
const german = (page: Page) => wsEval(page, (s) => s.updateSettings({ language: 'de' }))

/** The deck open, run 212 bracketed by its flag (its meters counted). */
async function bracket212(page: Page): Promise<void> {
  await page.keyboard.press('Control+Alt+z')
  await expect(deck(page).locator('.lane').first()).toBeVisible()
  await page.locator(`.lane[data-lane="${AGENT}"] .flag`).first().click()
  await expect(deck(page).locator('.win .mtr b').first()).toHaveText(/\d/)
}

/** A place of the read dialog's list by its text; the group's "+ n more" opened first when it is not shown. */
async function pickPlace(page: Page, text: string): Promise<Locator> {
  const item = dialog(page).locator('.pi', { hasText: text })
  if (!(await item.count())) await dialog(page).locator('.pi--more').first().click()
  await item.first().click()
  await expect(item.first()).toHaveAttribute('aria-selected', 'true')
  return item.first()
}

/** The person's own steps for a fresh boot (no story): store calls under a writer at a time of the story's day. */
async function at(page: Page, time: string, writer: Record<string, unknown>, calls: Array<[string, ...unknown[]]>, opts: Record<string, unknown> = {}): Promise<unknown[]> {
  await page.clock.setFixedTime(storyTime(story, time))
  return rec<unknown[]>(page, 'step', { writer, calls, ...opts })
}

const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })

test.describe('flight recorder — reading a window', () => {
  test('readWindow (seam): run 212 = 52 · 37 · +212 −40 · 35 (3 new) · 1 · 1; NL-1408 and NL-1415 held (you, 07:44 / 07:57)', async ({ page }) => {
    test.setTimeout(120_000)
    const ids = await bootStory(page)
    const r = await rec(page, 'readWindow', window212())
    expect(r.meters).toEqual({ ops: 52, places: { all: 37, rows: 35, newRows: 3, pages: 1, schema: 1, views: 0 }, words: [212, 40] })
    expect(r.held.map((h: { p: string }) => h.p).sort()).toEqual([`p:${ids['NL-1408']}`, `p:${ids['NL-1415']}`].sort())
    const by = Object.fromEntries(r.held.map((h: { p: string; by: unknown; at: number }) => [h.p, { by: h.by, at: h.at }]))
    expect(by[`p:${ids['NL-1408']}`]).toEqual({ by: [{ lane: 'you', at: storyTime(story, '07:44:12') }], at: storyTime(story, '07:44:12') })
    expect(by[`p:${ids['NL-1415']}`]).toEqual({ by: [{ lane: 'you', at: storyTime(story, '07:57:30') }], at: storyTime(story, '07:57:30') })
    expect(r.marks.map((m: { label: string }) => m.label).sort()).toEqual(['NL-1408', 'NL-1415'])
    expect(r.outcomes).toEqual({ back: 32, trash: 3, held: 2 })
    expect(r.groups).toEqual([
      { kind: 'schema', n: 1 },
      { kind: 'pages', n: 1 },
      { kind: 'rows', n: 32 },
      { kind: 'newRows', n: 3 },
    ])
    expect(r.partial).toEqual([])
    expect(r.incomplete).toBe(false)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('the plate and the dialog (German): flag → meters, held diamonds and note; ↵ reads (groups, NL-1402\'s Stage, word diffs); ↵ on a focused flag; Esc order; a one-place tick opens its page', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    await german(page)
    await bracket212(page)
    const plate = deck(page).locator('.win')
    await expect(plate.locator('.mtr b')).toHaveText(['52', '37', '+212 −40', /^35\s*3 neu$/, '1', '1'])
    // held: NL-1408 and NL-1415 (you, 07:44 / 07:57) as diamonds, and the note
    await expect(deck(page).locator('.held')).toHaveCount(2)
    expect((await deck(page).locator('.held').evaluateAll((els) => els.map((e) => e.getAttribute('data-held')))).sort()).toEqual([`p:${ids['NL-1408']}`, `p:${ids['NL-1415']}`].sort())
    await expect(plate.locator('.win__note--held')).toHaveText('2 Zeilen seitdem geändert (du) — sie werden gehalten.')
    await expect(plate.locator('.win__note--held b')).toHaveText('2 Zeilen')

    // ↵ on the playhead reads the window
    await deck(page).locator('.playhead__h').focus()
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('.rec-title')).toHaveText('52 Vorgänge von Agent · Nordlicht-Spiegel')
    await expect(dialog(page).locator('.rec-sub')).toHaveText('37 Stellen in diesem Fenster geändert. Lesen ändert nichts. 2 Zeilen seitdem geändert (du).')
    await expect(dialog(page).locator('.plan__label')).toHaveText(['Schema · 1', 'Seiten · 1', 'Zeilen · 32', 'Neue Zeilen · 3'])
    await expect(dialog(page).locator('.plan__n')).toHaveText(['01', '02', '03', '04'])
    await expect(dialog(page).locator('.rec-bar__l')).toHaveText(/§ 02\.14\s*Flugschreiber ·\s*Fenster lesen/)
    // held rows are shown even while their group is folded, with who and when
    await expect(dialog(page).locator('.pi--held .pi__r')).toHaveText(['Du 07:44', 'Du 07:57'])
    // NL-1402: Stage Ready → In Arbeit
    await pickPlace(page, 'NL-1402')
    const prev = dialog(page).locator('.rec-prev .prev')
    await expect(prev.locator('.prev__h')).toHaveText('NL-1402')
    await expect(prev.locator('.hprops__row')).toHaveCount(1)
    await expect(prev.locator('.hprops__name')).toHaveText('Stage')
    await expect(prev.locator('.hprops__vals del')).toHaveText('Ready')
    await expect(prev.locator('.hprops__vals ins')).toHaveText('In Arbeit')
    await expect(prev.locator('.prev__meta')).toContainText('Seitdem geändert:niemand')
    // a row body word by word (NL-1401 lost a paragraph), the report page word by word (+212)
    await pickPlace(page, 'NL-1401')
    await expect(prev.locator('.ddiff__seg[data-state="removed"]')).toContainText('Offene Fragen zur Zuordnung')
    await expect(prev.locator('.box__h').nth(1)).toContainText('Text · +0 −10 Wörter')
    await pickPlace(page, 'Nordlicht-Spiegel · Bericht')
    await expect(prev.locator('.box__h').first()).toContainText('Text · +212')
    expect(await prev.locator('.ddiff__seg[data-state="added"], .ddiff__seg ins').count()).toBeGreaterThan(0)
    // Esc: the dialog first, the deck stays; then the deck
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(deck(page)).toBeVisible()

    // ↵ on a focused flag: the window cleared, the agent's track focused, PageUp to its flag, ↵ brackets + reads
    await plate.getByRole('button', { name: 'Fenster aufheben' }).click()
    await expect(plate.locator('.mtr')).toHaveCount(0)
    await deck(page).locator(`.lane[data-lane="${AGENT}"]`).focus()
    await page.keyboard.press('PageUp')
    await expect(deck(page).locator(`.lane[data-lane="${AGENT}"] .flag`).first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('.rec-title')).toHaveText('52 Vorgänge von Agent · Nordlicht-Spiegel')
    await expect(plate.locator('.win__who')).toContainText('Lauf 212')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)

    // a tick with one place still opens its page (no read key on the way)
    await page.keyboard.press('Control+Alt+z')
    const lane = page.locator('.lane[data-lane="sync:folder"]')
    await expect(lane).toBeVisible()
    const x = await lane.locator('.lane__marks path.ev').evaluate((p) => Number(/^M([\d.]+)/.exec(p.getAttribute('d') ?? '')?.[1]) + 1)
    const box = (await lane.boundingBox())!
    await page.mouse.click(box.x + x, box.y + box.height - 12)
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/p\//)
    await expect(page.locator('.rec-pop')).toHaveCount(0)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('interleaving: an agent run with the person\'s edit in between — the preview tags the person\'s block "enthält Änderungen von Du 07:37"', async ({ page }) => {
    test.setTimeout(120_000)
    await page.clock.install({ time: storyTime(story, '07:30:00') })
    await openApp(page)
    await startRecorder(page)
    await german(page)
    const you = { kind: 'you', via: 'ui' }
    const [plan] = (await at(page, '07:30:00', you, [['createPage', { title: 'Tessera Plan' }]])) as string[]
    const doc = (b1: string, b2: string, b3: string) => ({ type: 'doc', content: [para('b1', b1), para('b2', b2), para('b3', b3)] })
    await at(page, '07:30:10', you, [['setContent', plan, doc('Tessera Ziel offen', 'Tessera Termin offen', 'Tessera Budget offen'), 'ui']])
    await rec(page, 'settle')
    const agent = (change: string) => ({ kind: 'agent', id: 'tessera-planer', run: 'r214', change })
    await at(page, '07:36:00', agent('c1'), [['setContent', plan, doc('Tessera Ziel steht fest', 'Tessera Termin offen', 'Tessera Budget offen'), 'ai']], { note: { seq: 214 } })
    await at(page, '07:37:00', you, [['setContent', plan, doc('Tessera Ziel steht fest', 'Tessera Termin am Freitag', 'Tessera Budget offen'), 'ui']])
    await at(page, '07:38:00', agent('c2'), [['setContent', plan, doc('Tessera Ziel steht fest', 'Tessera Termin am Freitag', 'Tessera Budget genehmigt'), 'ai']], { end: true })
    await page.clock.setFixedTime(storyTime(story, '07:45:00'))
    await rec(page, 'settle')
    await page.keyboard.press('Control+Alt+z')
    await page.locator('.lane[data-lane="agent:tessera-planer"] .flag').first().click()
    await expect(deck(page).locator('.win .mtr b').first()).toHaveText(/\d/)
    await deck(page).locator('.dbtn--read').click()
    await expect(dialog(page)).toBeVisible()
    await pickPlace(page, 'Tessera Plan')
    const prev = dialog(page).locator('.rec-prev .prev')
    // b2 is the person's: tagged; b1 and b3 are the run's own
    await expect(prev.locator('.ddiff__seg[data-block="b2"] .rec-tag')).toHaveText('enthält Änderungen von Du 07:37')
    await expect(prev.locator('.rec-tag')).toHaveCount(1)
    await expect(prev.locator('.ddiff__seg[data-block="b1"] ins')).toContainText('steht fest')
    await expect(prev.locator('.ddiff__seg[data-block="b3"] ins')).toContainText('genehmigt')
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('a window that cuts a typing stretch reads "partly" with the key that brackets it whole; a lost tail reads "possibly incomplete"', async ({ page, context }) => {
    test.setTimeout(180_000)
    await page.clock.install({ time: storyTime(story, '07:30:00') })
    await openApp(page)
    await startRecorder(page)
    const you = { kind: 'you', via: 'ui' }
    const [notes] = (await at(page, '07:30:00', you, [['createPage', { title: 'Nordlicht Notizen' }]])) as string[]
    // typing 07:40:00 → 07:43:00, a write every 30 s
    const words = ['Nordlicht', 'Abgleich', 'Zeile', 'Stand', 'geprüft', 'verschoben', 'offen']
    for (let i = 0; i < words.length; i++) {
      const time = new Date(storyTime(story, '07:40:00') + i * 30_000)
      const hms = [time.getUTCHours() + 2, time.getUTCMinutes(), time.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
      await at(page, hms, you, [['setContent', notes, { type: 'doc', content: [para('n1', words.slice(0, i + 1).join(' '))] }, 'ui']])
    }
    await page.clock.setFixedTime(storyTime(story, '07:50:00'))
    await rec(page, 'settle')
    // a stretch of the typing that holds two writes or more (however the tape split it)
    const segs = (await rec<Array<{ p: string; from: number; to: number }>>(page, 'segments')).filter((g) => g.p === `p:${notes}` && g.to - g.from >= 30_000)
    expect(segs.length).toBeGreaterThan(0)
    const seg = segs[0]
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page).locator('.lane[data-lane="you"]')).toBeVisible()
    // [ 10 s after the stretch began, ] at now (07:50) on the person's track
    await deck(page).locator('.lane[data-lane="you"]').focus()
    const back = Math.round((storyTime(story, '07:50:00') - (seg.from + 10_000)) / 10_000)
    for (let i = 0; i < back; i++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('[')
    await page.keyboard.press('End')
    await page.keyboard.press(']')
    const plate = deck(page).locator('.win')
    await expect(plate.locator('.win__t')).toHaveText(/^07:4\d:\d0 – 07:49:59$/)
    await expect(plate.locator('.win__note', { hasText: /^Partly: 1\splace without an exact earlier state or cut by the bracket\.$/ })).toBeVisible()
    const extend = plate.locator('.dbtn--extend')
    await expect(extend).toHaveText(/^Extend the bracket to 07:4\d–07:50$/)
    await extend.click()
    await expect(plate.locator('.win__note', { hasText: /^Partly/ })).toHaveCount(0)
    await expect(extend).toHaveCount(0)
    const read = await rec<{ partial: unknown[]; extendTo: unknown }>(page, 'readWindow', { lane: 'you', a: seg.from, b: storyTime(story, '07:50:00') })
    expect(read.partial).toEqual([])
    expect(read.extendTo).toBeNull()
    // whole now: readable word by word
    await plate.locator('.dbtn--read').click()
    await expect(dialog(page).locator('.plan__label')).toHaveText(['Pages · 1'])
    await expect(dialog(page).locator('.rec-prev .ddiff')).toContainText('Nordlicht Abgleich Zeile Stand geprüft verschoben offen')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)

    // a second tab writes, then dies before its write reaches the journal; this tab writes at 07:53
    const p2 = await context.newPage()
    await p2.clock.install({ time: storyTime(story, '07:52:00') })
    await openApp(p2)
    await startRecorder(p2)
    await rec(p2, 'step', { writer: you, calls: [['createPage', { title: 'Tessera Notiz' }]] })
    await rec(p2, 'flush')
    await rec(p2, 'step', { writer: you, calls: [['createPage', { title: 'Tessera Entwurf' }]] })
    await rec(p2, 'crash')
    await p2.close()
    await at(page, '07:53:00', you, [['updatePage', notes, { title: 'Nordlicht Notizen (Stand)' }]])
    await page.clock.setFixedTime(storyTime(story, '07:55:00'))
    await rec(page, 'settle')
    await expect
      .poll(async () => {
        await rec(page, 'recover')
        return (await rec<unknown[]>(page, 'lostTails')).length
      })
      .toBe(1)
    await page.keyboard.press('Control+Alt+z')
    await deck(page).locator('.lane[data-lane="you"]').focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('[')
    await page.keyboard.press('End')
    await page.keyboard.press(']')
    await expect(plate.locator('.win__t')).toHaveText('07:49:00 – 07:54:59')
    await expect(plate.locator('.win__note', { hasText: 'Possibly incomplete: recording was interrupted in this window.' })).toBeVisible()
    await plate.locator('.dbtn--read').click()
    await expect(dialog(page).locator('.rec-foot__note')).toHaveText('Possibly incomplete: recording was interrupted in this window.')
  })

  test('the incident report holds titles, counts and names — never values or text (the dialog shows them); reading writes nothing', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    const priv = await seedPrivacyRun(page, story)
    // read-only: the store's pages / databases and the tape's Vorgänge, before and after everything the dialog does
    const ops = async () => {
      await rec(page, 'flush')
      return (await rec<unknown[]>(page, 'ops')).length
    }
    const keep = () => page.evaluate(() => {
      const s = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> } } }).__one.workspace.getState()
      ;(window as unknown as { __refs: unknown }).__refs = { pages: s.pages, databases: s.databases }
    })
    const same = () => page.evaluate(() => {
      const s = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> } } }).__one.workspace.getState()
      const r = (window as unknown as { __refs: { pages: unknown; databases: unknown } }).__refs
      return s.pages === r.pages && s.databases === r.databases
    })
    await keep()
    const before = await ops()
    await page.keyboard.press('Control+Alt+z')
    await page.locator(`.lane[data-lane="${AGENT}"] .flag[data-runs~="${priv.run}"]`).click()
    await expect(deck(page).locator('.win .mtr b').first()).toHaveText(/\d/)
    await deck(page).locator('.dbtn--read').click()
    await expect(dialog(page)).toBeVisible()
    // the dialog shows values and text (the positive control for the report)
    await pickPlace(page, 'NL-1398')
    const prev = dialog(page).locator('.rec-prev .prev')
    await expect(prev.locator('.hprops')).toContainText('Lindenweg 12')
    await expect(prev.locator('.hprops')).toContainText('98765.4321')
    await pickPlace(page, 'Tessera Quartalsplan')
    await expect(prev.locator('.ddiff')).toContainText('Nordlicht-Geheimwert-7')
    expect(await same()).toBe(true)
    const download = page.waitForEvent('download')
    await dialog(page).locator('.rec-foot__report').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^incident-2026-10-09-08\d\d-agent-nordlicht-spiegel\.md$/)
    const md = readFileSync((await file.path())!, 'utf8')
    expect(await same()).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    expect(await same()).toBe(true)
    expect(await ops()).toBe(before)
    // what the report holds: titles, writer, counts, names of properties and the schema's option
    expect(md).toContain('Tessera Quartalsplan')
    expect(md).toContain('NL-1398')
    expect(md).toContain('Nordlicht-Spiegel')
    expect(md).toMatch(/Schätzung/)
    expect(md).toMatch(/Notiz/)
    expect(md).toContain('Stage')
    const schemaAt = md.indexOf('\n### Schema')
    const optAt = md.indexOf('Tessera-Option')
    expect(schemaAt).toBeGreaterThan(0)
    expect(optAt).toBeGreaterThan(schemaAt)
    const nextAt = md.indexOf('\n#', schemaAt + 4)
    expect(nextAt < 0 || optAt < nextAt).toBe(true)
    expect(md.split('Tessera-Option').length - 1).toBe(1)
    // never values or text
    for (const secret of ['Lindenweg 12', '98765.4321', '98765,4321', '98.765', 'Nordlicht-Geheimwert-7', 'Offene Fragen zur Zuordnung', 'Platzhalter']) expect(md, secret).not.toContain(secret)
    for (const st of story.steps) {
      const texts = JSON.stringify(st.calls).match(/"text":"([^"]{12,})"/g) ?? []
      for (const t of texts) expect(md).not.toContain(JSON.parse(`{${t}}`).text)
    }
    // positive control of the read-only check: a write changes both
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['setRowProperty', ids['NL-1400'], 'story-est', 5]] })
    expect(await same()).toBe(false)
    expect(await ops()).toBe(before + 1)
  })

  test('the diffs are ink: nothing inside .rec-diff takes the signal colours (History\'s own diff still does)', async ({ page }) => {
    test.setTimeout(120_000)
    await bootStory(page)
    await bracket212(page)
    await deck(page).locator('.dbtn--read').click()
    await pickPlace(page, 'NL-1401')
    const prev = dialog(page).locator('.rec-prev .prev')
    await expect(prev.locator('.rec-diff ins').first()).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const found = await page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.append(probe)
      const signal = ['--signal', '--signal-ink', '--signal-wash', '--signal-wash-strong', '--signal-on-ink'].map((v) => {
        probe.style.color = `var(${v})`
        return getComputedStyle(probe).color
      })
      // History's own diff: an ins outside .rec-diff
      probe.innerHTML = '<div class="ddiff"><ins class="ddiff-ins">x</ins></div>'
      const own = getComputedStyle(probe.querySelector('ins')!)
      const history = [own.color, own.backgroundColor]
      probe.remove()
      const props = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'text-decoration-color', 'outline-color']
      const hits: string[] = []
      let ins = 0
      for (const root of document.querySelectorAll('.modal.rec-read .rec-diff'))
        for (const el of [root, ...root.querySelectorAll('*')]) {
          if (el.matches('ins')) ins++
          const cs = getComputedStyle(el)
          for (const p of props) {
            const v = cs.getPropertyValue(p)
            for (const s of signal) if (v.includes(s)) hits.push(`${el.tagName.toLowerCase()}.${el.className} ${p}: ${v}`)
          }
        }
      return { hits, ins, history, signal }
    })
    expect(found.ins).toBeGreaterThan(0)
    expect(found.hits).toEqual([])
    // History's own added words: the signal colour on the strong signal wash
    expect(found.signal).toContain(found.history[0])
    expect(found.history[1]).toBe(found.signal[3])
  })

  test('keys in the dialog: ↑ ↓ pick, "+ n more" by ↵ (the first new place picked), Home / End; Esc: the dialog, then the deck', async ({ page }) => {
    test.setTimeout(120_000)
    await bootStory(page)
    await bracket212(page)
    await page.keyboard.press('Enter') // focus is on the flag: brackets again, reads
    await expect(dialog(page)).toBeVisible()
    const list = dialog(page).getByRole('listbox')
    await expect(list).toBeFocused()
    const active = async () => {
      const id = await list.getAttribute('aria-activedescendant')
      return id ? ((await dialog(page).locator(`#${id}`).textContent()) ?? '').trim() : ''
    }
    await expect.poll(active).toMatch(/^Nordlicht Handoff · schema/)
    await page.keyboard.press('ArrowDown')
    await expect.poll(active).toMatch(/^Nordlicht-Spiegel · Bericht/)
    await expect(dialog(page).locator('.rec-prev .prev__h')).toHaveText(/Nordlicht-Spiegel · Bericht/)
    await page.keyboard.press('ArrowUp')
    await expect.poll(active).toMatch(/^Nordlicht Handoff · schema/)
    // down to "+ 27 more": ↵ opens the group, the first new place (NL-1402) becomes the active one
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowDown')
    await expect.poll(active).toBe('+ 27 more')
    await page.keyboard.press('Enter')
    await expect.poll(active).toMatch(/^NL-1402/)
    await expect(dialog(page).locator('.pi--more')).toHaveCount(0)
    await expect(dialog(page).locator('.rec-prev .prev__h')).toHaveText('NL-1402')
    await page.keyboard.press('End')
    await expect.poll(active).toMatch(/^NL-1434/)
    await page.keyboard.press('Home')
    await expect.poll(active).toMatch(/^Nordlicht Handoff · schema/)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(deck(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(deck(page)).toHaveCount(0)
  })

  test('390: a bottom sheet in one column, a place on the second sheet ("‹ Plan" goes back), "Report" in the sheet\'s footer', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await bootStory(page)
    await bracket212(page)
    await deck(page).locator('.dbtn--read').click()
    await expect(dialog(page)).toBeVisible()
    await page.waitForTimeout(500)
    const box = (await dialog(page).boundingBox())!
    expect(Math.round(box.x)).toBe(0)
    expect(Math.round(box.width)).toBe(390)
    expect(Math.round(box.y + box.height)).toBe(844)
    await expect(dialog(page).locator('.rec-prev')).toHaveCount(0)
    await expect(dialog(page).locator('.plan__hint')).toBeVisible()
    await expect(dialog(page).locator('.rec-foot__report')).toBeVisible()
    await expect(dialog(page).locator('.rec-foot__report')).toHaveText('Report')
    await page.waitForTimeout(500)
    await dialog(page).locator('.pi', { hasText: 'NL-1401' }).click()
    const sheet = page.locator('.modal.rec-sheet2')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.prev__h')).toHaveText('NL-1401')
    await expect(sheet.locator('.hprops__name')).toHaveText('Stage')
    const back = sheet.locator('.rec-bar__back')
    await expect(back).toHaveText('Plan')
    await expect(back).toBeFocused()
    await page.waitForTimeout(500)
    await back.click()
    await expect(sheet).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
  })

  test('performance marks: bracket → meters < 50 ms, the held check < 150 ms, the report < 200 ms (the story at real time: a page clock hides marks)', async ({ page }) => {
    test.setTimeout(150_000)
    // the story played without the page clock (its steps' times collapse to now; the run and the rows are the same)
    const realTime = new Proxy(page, { get: (p, k) => (k === 'clock' ? { setFixedTime: async () => undefined } : typeof (p as never)[k] === 'function' ? ((p as never)[k] as (...a: unknown[]) => unknown).bind(p) : (p as never)[k]) })
    await openApp(page)
    await startRecorder(page)
    await flush(page)
    await rec(page, 'wipe')
    await playStory(realTime, story)
    await bracket212(page)
    await expect(deck(page).locator('.win .dbtn--read')).toBeVisible()
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('rec-held').length)).toBeGreaterThan(0)
    await deck(page).locator('.dbtn--read').click()
    await expect(dialog(page).locator('.pi').first()).toBeVisible()
    const download = page.waitForEvent('download')
    await dialog(page).locator('.rec-foot__report').click()
    await download
    const m = await page.evaluate(() => Object.fromEntries(['rec-meters', 'rec-held', 'rec-report'].map((n) => [n, performance.getEntriesByName(n).map((e) => e.duration)])))
    for (const n of ['rec-meters', 'rec-held', 'rec-report']) expect(m[n].length, n).toBeGreaterThan(0)
    expect(Math.min(...m['rec-meters'])).toBeLessThan(50)
    expect(Math.min(...m['rec-held'])).toBeLessThan(150)
    expect(Math.min(...m['rec-report'])).toBeLessThan(200)
  })

  /* ---------------- R3 review: follow-ups, closing segments, too many places, an old window ---------------- */

  test('follow-ups go with the write that caused them: a lane window takes the automation\'s follow-up of its own write, never one of a later write of the lane', async ({ page }) => {
    test.setTimeout(120_000)
    await page.clock.install({ time: storyTime(story, '07:00:00') })
    await openApp(page)
    await startRecorder(page)
    const you = { kind: 'you', via: 'ui' }
    const [db] = (await at(page, '07:00:00', you, [['createDatabase', { title: 'Nordlicht Abgleich' }]])) as string[]
    const [note] = (await at(page, '07:00:10', you, [['addProperty', db, { type: 'text', name: 'Notiz' }]])) as string[]
    const rows = (await at(page, '07:00:20', you, ['NL-1398', 'NL-1399', 'NL-1400', 'NL-1401', 'NL-1402'].map((title) => ['createRow', db, { title }] as [string, ...unknown[]]))) as string[]
    const [a, b, c, d, e] = rows
    await page.clock.setFixedTime(storyTime(story, '07:02:00'))
    await rec(page, 'settle')
    const auto = (run: string) => ({ kind: 'automation', db, id: 'au-notiz', run, cause: 'you~ui' })
    await at(page, '07:05:00', you, [['setRowProperty', a, note, 'Mara Lind']])
    await at(page, '07:05:02', auto('ar1'), [['setRowProperty', d, note, 'Tessera (früh)']])
    // the person writes again after the window; the automation follows that write, within the horizon and long after
    await at(page, '07:08:00', you, [['setRowProperty', b, note, 'Launch plan']])
    await at(page, '07:08:01', auto('ar2'), [['setRowProperty', c, note, 'Tessera']])
    await at(page, '08:30:00', you, [['setRowProperty', b, note, 'Launch plan 2']])
    await at(page, '08:30:01', auto('ar3'), [['setRowProperty', e, note, 'Tessera (spät)']])
    await page.clock.setFixedTime(storyTime(story, '08:40:00'))
    await rec(page, 'settle')
    const sel = { lane: 'you', a: storyTime(story, '07:04:00'), b: storyTime(story, '07:06:00') }
    expect((await rec<{ places: number }>(page, 'loadWindow', sel)).places).toBe(2)
    const plan = await rec<{ places: Array<{ p: string }> }>(page, 'planEject', sel)
    expect(plan.places.map((x) => x.p).sort()).toEqual([`p:${a}`, `p:${d}`].sort())
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('the plate follows a segment that closes on its own: "partly" while it is still being written, whole once it closes', async ({ page }) => {
    test.setTimeout(120_000)
    await page.clock.install({ time: storyTime(story, '07:30:00') })
    await openApp(page)
    await startRecorder(page)
    const you = { kind: 'you', via: 'ui' }
    const [notes] = (await at(page, '07:30:00', you, [['createPage', { title: 'Nordlicht Notizen' }]])) as string[]
    await page.clock.setFixedTime(storyTime(story, '07:35:00'))
    await rec(page, 'settle')
    await at(page, '07:40:00', you, [['setContent', notes, { type: 'doc', content: [para('n1', 'Nordlicht Abgleich')] }, 'ui']])
    await page.clock.setFixedTime(storyTime(story, '07:40:30'))
    await flush(page)
    expect((await rec<Array<{ p: string }>>(page, 'open')).some((o) => o.p === `p:${notes}`)).toBe(true)
    await page.keyboard.press('Control+Alt+z')
    await expect(deck(page).locator('.lane[data-lane="you"]')).toBeVisible()
    await page.evaluate((b) => (window as unknown as { __oneDeck: { set: (p: unknown) => void } }).__oneDeck.set({ bracket: b }), { lane: 'you', a: storyTime(story, '07:39:00'), b: storyTime(story, '07:41:00') })
    const plate = deck(page).locator('.win')
    await expect(plate.locator('.win__note', { hasText: /^Partly: 1\splace/ })).toBeVisible()
    // the segment closes (no new op: only the segment is written) — the plate reads again
    await rec(page, 'settle')
    await expect(plate.locator('.win__note', { hasText: /^Partly/ })).toHaveCount(0)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('too many places: only the first 2,000 are listed, but the meters count every event of the window', async ({ page }) => {
    test.setTimeout(240_000)
    await openApp(page)
    await startRecorder(page)
    await rec(page, 'settle')
    await rec(page, 'wipe')
    const now = await page.evaluate(() => Date.now())
    // one Vorgang of the person's on 6,000 places inside the last 75 minutes
    await rec(page, 'seedBulk', { events: 0, inSpan: 1, bigVorgang: 6000, spanEnd: now })
    const r = await rec<{ meters: { ops: number; places: { all: number } }; tooMany: number | null }>(page, 'readWindow', { lane: 'you', a: now - 76 * 60_000, b: now })
    expect(r.tooMany).toBe(6000)
    expect(r.meters).toMatchObject({ ops: 1, places: { all: 6000 } })
  })

  test('an old window reads what the window holds — not the tape recorded after it (the follow-up scan is bounded)', async ({ page }) => {
    test.setTimeout(600_000)
    await openApp(page)
    await startRecorder(page)
    await rec(page, 'settle')
    await rec(page, 'wipe')
    const now = await page.evaluate(() => Date.now())
    const N = 24_000
    await rec(page, 'seedBulk', { events: N, inSpan: 0, bigVorgang: 1, spanEnd: now })
    // the first seeded Vorgang (the person's, at the start of the month): seedBulk spreads them evenly
    const spanStart = now - 75 * 60_000
    const monthStart = now - 30 * 24 * 3600_000
    const first = Math.floor(monthStart + (0.5 / N) * (spanStart - monthStart))
    const ms = await page.evaluate(async (sel) => {
      const r = (window as unknown as { __oneRecorder: { loadWindow: (s: unknown) => Promise<{ places: number }> } }).__oneRecorder
      await r.loadWindow(sel)
      const times: number[] = []
      let places = 0
      for (let i = 0; i < 3; i++) {
        const t = performance.now()
        places = (await r.loadWindow(sel)).places
        times.push(performance.now() - t)
      }
      return { best: Math.min(...times), places }
    }, { lane: 'you', a: first - 1000, b: first + 1000 })
    console.log('[recorder] an old window over', N, 'events:', JSON.stringify(ms))
    expect(ms.places).toBe(1)
    expect(ms.best).toBeLessThan(150)
  })
})
