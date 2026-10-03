/**
 * AI meeting notes: the `meetingNotes` block (speech recognition + Claude mocked — never
 * reaches a microphone or api.anthropic.com). The fake SpeechRecognition below emits results on
 * demand through window.__speech.say(text, final).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { test, expect, openApp, gotoPage, createPage, wsEval, flush, reloadApp, pageIdByTitle, editorOf, doc, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** A Web Speech API stand-in: start → onstart, say() → onresult (interim / final), stop → onend. */
function fakeSpeech() {
  const speech: AnyState = { current: null, denyNext: false, langs: [] as string[] }
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    results: AnyState[] = []
    running = false
    onstart: (() => void) | null = null
    onresult: ((e: AnyState) => void) | null = null
    onerror: ((e: AnyState) => void) | null = null
    onend: (() => void) | null = null
    constructor() {
      speech.current = this
    }
    start() {
      speech.langs.push(this.lang)
      if (speech.denyNext) {
        speech.denyNext = false
        setTimeout(() => {
          this.onerror?.({ error: 'not-allowed' })
          this.onend?.()
        }, 20)
        return
      }
      this.running = true
      setTimeout(() => this.onstart?.(), 20)
    }
    stop() {
      if (!this.running) return
      this.running = false
      setTimeout(() => this.onend?.(), 20)
    }
    abort() {
      this.running = false
      setTimeout(() => this.onend?.(), 0)
    }
    emit(text: string, isFinal: boolean) {
      const last = this.results[this.results.length - 1]
      const r = Object.assign([{ transcript: text }], { isFinal })
      let index = this.results.length
      if (last && !last.isFinal) index = this.results.length - 1
      this.results[index] = r
      this.onresult?.({ resultIndex: index, results: this.results })
    }
  }
  speech.say = (text: string, final = true) => (speech.current?.running ? (speech.current.emit(text, final), true) : false)
  speech.silence = () => {
    const c = speech.current
    if (c?.running) {
      c.running = false
      c.onend?.()
    }
  }
  const w = window as unknown as AnyState
  w.SpeechRecognition = FakeRecognition
  w.webkitSpeechRecognition = FakeRecognition
  w.__speech = speech
}

/** A browser without speech recognition (Firefox). */
function noSpeech() {
  const w = window as unknown as AnyState
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true })
  w.__noSpeech = true
}

const SUMMARY = {
  title: 'Relaunch sync',
  summary: ['The relaunch ships in two steps.', 'The homepage goes first.'],
  decisions: ['Ship in two steps.'],
  actionItems: [
    { text: 'Send the deck to legal', owner: 'Alex', due: '2026-10-09' },
    { text: 'Book the venue', owner: null, due: null },
  ],
}

interface Captured {
  body: AnyState
  prompt: string
}

/** api.anthropic.com → one structured-output message per request (non-streaming JSON). */
async function mockClaude(ctx: BrowserContext, answer: () => object = () => SUMMARY, opts: { hold?: Promise<void> } = {}): Promise<Captured[]> {
  const captured: Captured[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    captured.push({ body, prompt: String(body.messages?.[0]?.content ?? '') })
    if (opts.hold) await opts.hold
    try {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answer()) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 120 } }),
      })
    } catch {
      /* aborted */
    }
  })
  return captured
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const say = (page: Page, text: string, final = true) => page.evaluate(([text, final]) => (window as unknown as AnyState).__speech.say(text, final), [text, final] as const)

/** A fresh page with a meeting notes block inserted from the slash menu. */
async function newMeeting(page: Page, title = 'Design sync', query = 'meeting'): Promise<string> {
  const id = await createPage(page, { title })
  await gotoPage(page, id)
  await editorOf(page).click()
  await page.keyboard.type(`/${query}`)
  await expect(page.locator('.slash')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main .mtg')).toBeVisible()
  return id
}

const deck = (page: Page) => page.locator('#main .mtg').first()
const key = (page: Page, name: string) => deck(page).locator(`[data-meeting-key="${name}"]`)

async function meetingNode(page: Page, pageId: string): Promise<AnyState | null> {
  return wsEval(
    page,
    (s, id) => {
      let hit: AnyState | null = null
      const walk = (n: AnyState) => {
        if (hit) return
        if (n.type === 'meetingNotes') hit = n
        ;(n.content ?? []).forEach(walk)
      }
      if (s.pages[id]?.content) walk(s.pages[id].content)
      return hit ? JSON.parse(JSON.stringify(hit)) : null
    },
    pageId,
  )
}

test.describe('AI meeting notes', () => {
  test('slash insert → record → live transcript → pause / resume → stop → notes; undo / redo; reload keeps everything', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    const reqs = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await newMeeting(page)
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'standby')
    await expect(deck(page)).toContainText('Chrome sends the audio to Google')

    // record: the key latches, the LED pulses, the read-out says REC
    await key(page, 'record').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
    await expect(key(page, 'record')).toHaveAttribute('aria-pressed', 'true')
    await expect(key(page, 'record').locator('.mtg-key__led')).toHaveClass(/is-pulse/)
    await expect.poll(() => page.evaluate(() => (window as unknown as AnyState).__speech.langs)).toEqual(['en-US'])

    // a final phrase lands in the transcript, an interim one shows faint with the caret
    await say(page, 'We ship the relaunch in two steps.')
    await expect(deck(page).locator('.mtg__line:not(.is-interim)')).toHaveText([/00:0\d\s*We ship the relaunch in two steps\./])
    await say(page, 'Alex sends the deck', false)
    await expect(deck(page).locator('.mtg__line.is-interim')).toContainText('Alex sends the deck')
    await expect(deck(page).locator('.mtg__line.is-interim .mtg__caret')).toHaveCount(1)

    // pause: PAUSE latches, the engine stops, the attrs say paused
    await key(page, 'pause').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'paused')
    await expect(key(page, 'pause')).toHaveAttribute('aria-pressed', 'true')
    await expect(key(page, 'record')).toHaveText('Resume')
    await expect(deck(page).locator('.mtg__line.is-interim')).toHaveCount(0)
    await flush(page)
    expect((await meetingNode(page, id))?.attrs.status).toBe('paused')

    // the engine silently stopping mid-recording is restarted
    await key(page, 'record').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
    await page.evaluate(() => (window as unknown as AnyState).__speech.silence())
    await expect.poll(() => page.evaluate(() => (window as unknown as AnyState).__speech.current?.running)).toBe(true)
    await say(page, 'Alex sends the deck to legal by Friday.')
    await expect(deck(page).locator('.mtg__line:not(.is-interim)')).toHaveCount(2)

    // stop → Claude writes the notes into the block
    await key(page, 'stop').click()
    const notes = deck(page).locator('.mtg__notes')
    await expect(notes.getByRole('heading', { name: 'Summary' })).toBeVisible()
    await expect(notes.getByRole('heading', { name: 'Decisions' })).toBeVisible()
    await expect(notes.getByRole('heading', { name: 'Action items' })).toBeVisible()
    await expect(notes.locator('ul[data-type="taskList"] > li')).toHaveCount(2)
    await expect(notes.locator('.mention--person')).toHaveText('@Alex')
    await expect(deck(page).locator('.mtg__title')).toHaveValue('Relaunch sync')
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'done')
    // the transcript folds away, still there
    await expect(deck(page).locator('.mtg__tx-toggle')).toContainText('Transcript · 15 words')
    await expect(deck(page).locator('.mtg__tx-list')).toHaveCount(0)

    // one request: structured output, the transcript with timestamps, the language
    expect(reqs).toHaveLength(1)
    expect(reqs[0].body.output_config.format.type).toBe('json_schema')
    expect(reqs[0].prompt).toContain('Language: en-US')
    expect(reqs[0].prompt).toMatch(/\[00:0\d\] We ship the relaunch in two steps\./)
    expect(reqs[0].prompt).toContain('Known people: You, Alex, Sam, Mira')

    // undo removes the generated notes (one step), redo brings them back
    await notes.getByRole('heading', { name: 'Decisions' }).click()
    await page.keyboard.press(`${MOD}+z`)
    await expect(notes.getByRole('heading', { name: 'Summary' })).toHaveCount(0)
    await expect(key(page, 'summarize')).toBeVisible()
    await expect(deck(page).locator('.mtg__line')).toHaveCount(0) // folded
    await expect(deck(page).locator('.mtg__tx-toggle')).toContainText('15 words')
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(notes.getByRole('heading', { name: 'Summary' })).toBeVisible()

    // stored: attrs + notes; the page is searchable by the notes
    await flush(page)
    const node = await meetingNode(page, id)
    expect(node?.attrs).toMatchObject({ status: 'done', title: 'Relaunch sync', language: 'en-US' })
    expect(node?.attrs.transcript.map((s: AnyState) => s.text)).toEqual(['We ship the relaunch in two steps.', 'Alex sends the deck to legal by Friday.'])
    expect(node?.attrs.startedAt).toBeGreaterThan(0)
    expect(node?.attrs.endedAt).toBeGreaterThanOrEqual(node?.attrs.startedAt)

    await reloadApp(page)
    await gotoPage(page, id)
    await expect(deck(page).locator('.mtg__notes').getByRole('heading', { name: 'Summary' })).toBeVisible()
    await expect(deck(page).locator('.mtg__title')).toHaveValue('Relaunch sync')
    await deck(page).locator('.mtg__tx-toggle').click()
    await expect(deck(page).locator('.mtg__line')).toHaveCount(2)
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'done')
  })

  test('no API key: stop keeps the transcript and explains the Settings → Claude AI path in place', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    const reqs = await mockClaude(context)
    await openApp(page)
    const id = await newMeeting(page, 'Keyless sync', 'protokoll')
    await key(page, 'record').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
    await say(page, 'A short meeting without a key.')
    await key(page, 'stop').click()
    const notice = deck(page).locator('.mtg__notice')
    await expect(notice).toContainText('ERR · NO_KEY')
    await expect(notice).toContainText('Add it in Settings → Claude AI')
    await expect(key(page, 'summarize')).toBeVisible()
    expect(reqs).toHaveLength(0)
    await flush(page)
    expect((await meetingNode(page, id))?.attrs).toMatchObject({ status: 'idle', transcript: [{ text: 'A short meeting without a key.' }] })

    await notice.getByRole('button', { name: 'Open Settings → Claude AI' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('tab', { name: 'Claude AI' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')

    // a title typed by hand is kept (Claude's suggestion only fills an empty title)
    const title = deck(page).getByRole('textbox', { name: 'Meeting title' })
    await title.fill('Keyless retro')
    await title.press('Enter')
    await flush(page)
    expect((await meetingNode(page, id))?.attrs.title).toBe('Keyless retro')

    // with a key, "Write notes" finishes the job
    await setKey(page)
    await key(page, 'summarize').click()
    await expect(deck(page).locator('.mtg__notes').getByRole('heading', { name: 'Summary' })).toBeVisible()
    await expect(deck(page).locator('.mtg__notice')).toHaveCount(0)
    await expect(title).toHaveValue('Keyless retro')
    expect(reqs).toHaveLength(1)
    expect(reqs[0].prompt).toContain('Title so far: Keyless retro')
  })

  test('microphone blocked: a helpful notice, nothing written', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    await openApp(page)
    const id = await newMeeting(page, 'Blocked mic')
    await page.evaluate(() => ((window as unknown as AnyState).__speech.denyNext = true))
    await key(page, 'record').click()
    const notice = deck(page).locator('.mtg__notice')
    await expect(notice).toContainText('Microphone blocked')
    await expect(notice).toContainText('Allow microphone access for this site')
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'standby')
    await flush(page)
    expect((await meetingNode(page, id))?.attrs).toMatchObject({ status: 'idle', startedAt: null })
    // try again → it records
    await notice.getByRole('button', { name: 'Try again' }).click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
  })

  test('a browser without speech recognition: paste a transcript, Claude writes the notes', async ({ page, context }) => {
    await context.addInitScript(noSpeech)
    const reqs = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const id = await newMeeting(page, 'Pasted sync', 'transcript')
    await expect(deck(page)).toContainText('Live transcription isn’t available in this browser')
    await expect(key(page, 'record')).toHaveCount(0)
    const box = deck(page).getByRole('textbox', { name: 'Transcript text' })
    await box.fill('WEBVTT\n\n1\n00:00:05.000 --> 00:00:09.000\n<v Ada>We ship in two steps.</v>\n\n2\n00:01:23.500 --> 00:01:30.000\n<v Alex>I send the deck to legal by Friday.</v>\n')
    await deck(page).getByRole('button', { name: 'Use transcript' }).click()
    await expect(deck(page).locator('.mtg__notes').getByRole('heading', { name: 'Action items' })).toBeVisible()
    expect(reqs).toHaveLength(1)
    expect(reqs[0].prompt).toContain('[00:05] Ada: We ship in two steps.')
    expect(reqs[0].prompt).toContain('[01:23] Alex: I send the deck to legal by Friday.')
    await flush(page)
    const node = await meetingNode(page, id)
    expect(node?.attrs.transcript).toEqual([
      { t: 5000, text: 'Ada: We ship in two steps.' },
      { t: 83000, text: 'Alex: I send the deck to legal by Friday.' },
    ])
    // no browser-recognition line in the privacy note: only what goes to Claude
    await expect(deck(page).locator('.mtg__privacy')).not.toContainText('Google')
    await expect(deck(page).locator('.mtg__privacy')).toContainText('Only the transcript text goes to Claude')
  })

  test('send action items to the seeded Projects database: rows with owner + date, linked back in the notes', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    await openApp(page)
    const alex = await wsEval(page, (s) => s.people.find((p: AnyState) => p.name === 'Alex').id)
    const blockId = 'meeting-e2e-1'
    const id = await createPage(page, {
      title: 'Done meeting',
      content: doc({
        type: 'meetingNotes',
        attrs: { id: blockId, title: 'Relaunch sync', status: 'done', language: 'en-US', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 600_000, duration: 2_940_000, transcript: [{ t: 0, text: 'Alex sends the deck.' }] },
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Action items' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Send the deck to legal ' },
                      { type: 'mention', attrs: { id: alex, label: 'Alex', kind: 'person' } },
                      { type: 'text', text: ' ' },
                      { type: 'mention', attrs: { id: '2026-10-09', label: 'October 9, 2026', kind: 'date' } },
                    ],
                  },
                ],
              },
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book the venue' }] }] },
            ],
          },
        ],
      }),
    })
    await gotoPage(page, id)
    await expect(deck(page).locator('.mtg__meta')).toContainText('49 min')
    const send = deck(page).locator('[data-meeting-key="send"]')
    await expect(send).toHaveText('Send 2 action items to a database')
    await send.click()
    const picker = page.getByRole('dialog', { name: 'Send to database' })
    await picker.getByRole('textbox').fill('Proj')
    await expect(picker.getByRole('menuitem')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.toast').filter({ hasText: '2 action items → Projects' })).toBeVisible()

    const dbId = await pageIdByTitle(page, 'Projects')
    const rows = await wsEval(
      page,
      (s, dbId) => {
        const db = s.databases[dbId]
        const owner = db.properties.find((p: AnyState) => p.type === 'person').id
        const date = db.properties.find((p: AnyState) => p.type === 'date').id
        return (Object.values(s.pages) as AnyState[])
          .filter((p) => p.databaseId === dbId && (p.title === 'Send the deck to legal' || p.title === 'Book the venue'))
          .map((p) => ({ id: p.id, title: p.title, owner: p.properties[owner] ?? null, due: p.properties[date]?.start ?? null, backlink: JSON.stringify(p.content).includes('"kind":"page"') }))
      },
      dbId,
    )
    expect(rows.map(({ id: _id, ...r }) => r).sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: 'Book the venue', owner: null, due: null, backlink: true },
      { title: 'Send the deck to legal', owner: [alex], due: '2026-10-09', backlink: true },
    ])

    // the items now link to their rows; owner + date stay; nothing left to send
    const items = deck(page).locator('.mtg__notes ul[data-type="taskList"] > li')
    await expect(items.nth(0).locator('.mention--page')).toHaveText('Send the deck to legal')
    await expect(items.nth(0).locator('.mention--person')).toHaveText('@Alex')
    await expect(items.nth(0).locator('.mention--date')).toHaveCount(1)
    await expect(items.nth(1).locator('.mention--page')).toHaveText('Book the venue')
    await expect(send).toHaveCount(0)
    await flush(page)
    const linked = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)
    for (const r of rows) expect(linked).toContain(`"id":"${r.id}"`)
  })

  test('export + share: Markdown / HTML carry notes and transcript; share link and locked page render without controls', async ({ page, browser, errors }, testInfo) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Exported meeting',
      content: doc({
        type: 'meetingNotes',
        attrs: { title: 'Board review', status: 'done', language: 'en-US', startedAt: Date.parse('2026-10-02T14:02:00'), endedAt: Date.parse('2026-10-02T14:48:00'), duration: 2_760_000, transcript: [{ t: 12_000, text: 'We approve the budget.' }, { t: 3_725_000, text: 'Meeting closed.' }] },
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Summary' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Budget approved.' }] }] }] },
        ],
      }),
    })
    await gotoPage(page, id)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Markdown folder/ }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const file = testInfo.outputPath('meeting.zip')
    await (await download).saveAs(file)
    const zip = unzipSync(new Uint8Array(readFileSync(file)))
    const mdName = Object.keys(zip).find((n) => n.endsWith('.md'))!
    const md = strFromU8(zip[mdName])
    expect(md).toContain('**Board review**')
    expect(md).toContain('- Budget approved.')
    expect(md).toMatch(/<details>\n<summary>Transcript · 6 words<\/summary>/)
    expect(md).toContain('- `00:12` We approve the budget.')
    expect(md).toContain('- `1:02:05` Meeting closed.')
    expect(md).toContain('</details>')
    await page.keyboard.press('Escape')

    // HTML: the notes, then the transcript as a native <details> list
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('>export')
    await page.keyboard.press('Enter')
    await dialog.getByRole('radio', { name: /Web page/ }).click()
    const htmlDownload = page.waitForEvent('download')
    await dialog.locator('[data-export-run]').click()
    const htmlFile = testInfo.outputPath('meeting.html')
    await (await htmlDownload).saveAs(htmlFile)
    const html = readFileSync(htmlFile, 'utf8')
    expect(html).toContain('data-type="meeting-notes"')
    expect(html).toMatch(/<strong class="meeting-notes__title">Board review<\/strong>/)
    expect(html).toContain('Budget approved.')
    expect(html).toMatch(/<details class="meeting-notes__transcript"[^>]*><summary>Transcript · 6 words<\/summary><ol><li data-t="12000"><time>00:12<\/time> <span class="meeting-notes__text">We approve the budget\.<\/span><\/li>/)
    await page.keyboard.press('Escape')

    // share link: a static render — notes + foldable transcript, no transport, no recording
    await page.locator('.tb').getByRole('button', { name: 'Share', exact: true }).click()
    const link = await page.getByRole('dialog').getByRole('textbox', { name: 'Share link' }).inputValue()
    await page.keyboard.press('Escape')
    const other = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' })
    const p2 = await other.newPage()
    errors.watch(p2)
    await p2.goto(link)
    const shared = p2.locator('.shv__doc')
    await expect(shared).toContainText('Budget approved.')
    await expect(shared.locator('.mtg__title, .meeting-notes__title').first()).toHaveText('Board review')
    await expect(shared.locator('[data-meeting-key], .mtg__more, .mtg__foot')).toHaveCount(0)
    await other.close()

    // locked page: read-only render — title, meta and transcript, no transport, no menu
    await wsEval(page, (s, id) => s.updatePageSettings(id, { locked: true }), id)
    await expect(deck(page).locator('.mtg__title')).toHaveText('Board review')
    await expect(deck(page).locator('[data-meeting-key]')).toHaveCount(0)
    await expect(deck(page).locator('.mtg__more')).toHaveCount(0)
    await deck(page).locator('.mtg__tx-toggle').click()
    await expect(deck(page).locator('.mtg__line')).toHaveCount(2)
  })

  test('reload while recording: the block shows the interrupted recording, Resume continues the transcript', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    await openApp(page)
    const id = await newMeeting(page, 'Interrupted')
    await key(page, 'record').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
    await say(page, 'First part of the meeting.')
    await expect(deck(page).locator('.mtg__line')).toHaveCount(1)
    await reloadApp(page)
    await gotoPage(page, id)
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'paused')
    await expect(deck(page)).toContainText('The recording was interrupted')
    await key(page, 'record').click()
    await expect(deck(page).locator('.mtg__readout')).toHaveAttribute('data-state', 'rec')
    await say(page, 'Second part.')
    await expect(deck(page).locator('.mtg__line:not(.is-interim)')).toHaveCount(2)
  })

  test('German UI: slash item, controls and the generated headings', async ({ page, context }) => {
    await context.addInitScript(fakeSpeech)
    await mockClaude(context, () => ({ ...SUMMARY, title: 'Relaunch-Abstimmung', summary: ['Der Relaunch kommt in zwei Schritten.'] }))
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const id = await createPage(page, { title: 'Abstimmung' })
    await gotoPage(page, id)
    await editorOf(page).click()
    await page.keyboard.type('/besprechung')
    await expect(page.locator('.slash')).toContainText('Besprechungsnotizen')
    await page.keyboard.press('Enter')
    await expect(deck(page)).toContainText('Besprechungsnotizen')
    await expect(key(page, 'record')).toHaveText('Aufnehmen')
    await expect(deck(page).getByRole('button', { name: 'Transkript einfügen' })).toBeVisible()
    await expect(deck(page)).toContainText('Chrome schickt das Audio an Google')
    await key(page, 'record').click()
    await expect(page.evaluate(() => (window as unknown as AnyState).__speech.langs)).resolves.toEqual(['de-DE'])
    await say(page, 'Wir liefern in zwei Schritten aus.')
    await key(page, 'stop').click()
    const notes = deck(page).locator('.mtg__notes')
    await expect(notes.getByRole('heading', { name: 'Zusammenfassung' })).toBeVisible()
    await expect(notes.getByRole('heading', { name: 'Entscheidungen' })).toBeVisible()
    await expect(notes.getByRole('heading', { name: 'Aufgaben' })).toBeVisible()
    await expect(deck(page).locator('.mtg__tx-toggle')).toContainText('Transkript · 6 Wörter')
    await expect(deck(page).locator('[data-meeting-key="send"]')).toHaveText('2 Aufgaben an eine Datenbank senden')
  })
})
