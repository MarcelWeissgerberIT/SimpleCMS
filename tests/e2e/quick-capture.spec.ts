/**
 * Mobile & quick capture (shell/capture): the manifest (share target with files, maskable icon, shortcuts,
 * screenshots), files shared into the app (the service worker keeps them in IndexedDB `one-share`, the app
 * asks, then writes a Clippings page and offers Claude's next step), the quick capture sheet (text → Clippings,
 * → a database row, → the end of a page, photo, voice, offline, Mod+Shift+K, the phone's floating key), the
 * home-screen shortcuts and "Install One". Claude and the browser's speech recognition are mocked —
 * nothing reaches api.anthropic.com or a microphone.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, waitForApp, gotoPage, createPage, doc, para, wsEval, pageById, pageIdByTitle, editorOf, flush, reloadApp, selectText, sse, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const inboxIds = (page: Page) => wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.id.startsWith('inbx') && !p.trashed).map((p) => p.id as string))
const childrenOf = (page: Page, id: string) =>
  wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.parentId === id && !p.trashed).map((p) => [p.id as string, p.title as string]), id)
const routeId = (page: Page) => page.evaluate(() => window.location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? null)
const blocksOf = (page: Page, id: string): Promise<AnyState[]> => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content?.content ?? [])), id)
const sheet = (page: Page, name = 'Quick capture') => page.getByRole('dialog', { name })
const askCard = (page: Page, name = 'Save to Clippings?') => page.getByRole('dialog', { name })
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text })
const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

/** A PDF of one empty page. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

/** A PNG drawn in the page. */
async function png(page: Page, label = 'Bench 4'): Promise<Buffer> {
  const b64 = await page.evaluate((label) => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 200
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 320, 200)
    g.fillStyle = '#111'
    g.font = 'bold 28px sans-serif'
    g.fillText(label, 24, 100)
    return c.toDataURL('image/png').split(',')[1]
  }, label)
  return Buffer.from(b64, 'base64')
}

/** What the service worker kept (IndexedDB `one-share`). */
const storedShares = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ id: string; title: string; text: string; files: Array<{ name: string; type: string; size: number }>; skipped: Array<{ name: string; reason: string }> }>>((resolve, reject) => {
        const req = indexedDB.open('one-share')
        req.onupgradeneeded = () => req.result.createObjectStore('shares')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const all = db.transaction('shares').objectStore('shares').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(
              (all.result as AnyState[]).map((e) => ({
                id: e.id,
                title: e.title,
                text: e.text,
                files: e.files.map((f: AnyState) => ({ name: f.name, type: f.type, size: f.size })),
                skipped: e.skipped.map((s: AnyState) => ({ name: s.name, reason: s.reason })),
              })),
            )
          }
          all.onerror = () => reject(all.error)
        }
      }),
  )

/** Put a share into `one-share` the way the service worker does (for the app's side alone). */
async function putShare(page: Page, id: string, entry: { title?: string; text?: string; url?: string; files: Array<{ name: string; type: string; b64: string }> }) {
  await page.evaluate(
    ({ id, entry }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('one-share')
        req.onupgradeneeded = () => req.result.createObjectStore('shares')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('shares', 'readwrite')
          const files = entry.files.map((f) => {
            const blob = new Blob([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], { type: f.type })
            return { name: f.name, type: f.type, size: blob.size, blob }
          })
          tx.objectStore('shares').put({ v: 1, id, at: Date.now(), title: entry.title ?? '', text: entry.text ?? '', url: entry.url ?? '', files, skipped: [] }, id)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { id, entry },
  )
}

/** Wait until the service worker controls the page. */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }))
  })
}

/**
 * A share sheet's POST: a multipart form to the manifest's share action (+ ?e2e), submitted like Android does.
 * Files are made in the page (`zeros`: a file of that many zero bytes).
 */
async function shareForm(page: Page, fields: Record<string, string>, files: Array<{ name: string; mimeType: string; buffer?: Buffer; zeros?: number }>) {
  const res = await page.request.get('manifest.webmanifest')
  const manifest = await res.json()
  const action = new URL(manifest.share_target.action, res.url())
  action.searchParams.set('e2e', '')
  await page.evaluate(
    ({ action, fields }) => {
      const f = document.createElement('form')
      f.id = 'share-form'
      f.method = 'post'
      f.enctype = 'multipart/form-data'
      f.action = action
      for (const [k, v] of Object.entries(fields)) {
        const i = document.createElement('input')
        i.name = k
        i.value = v
        f.append(i)
      }
      const file = document.createElement('input')
      file.type = 'file'
      file.name = 'files'
      file.multiple = true
      file.id = 'share-files'
      const go = document.createElement('button')
      go.type = 'submit'
      go.id = 'share-go'
      go.textContent = 'share'
      f.append(file, go)
      f.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff'
      document.body.append(f)
    },
    { action: action.href.replace('e2e=', 'e2e'), fields },
  )
  await page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) {
      const bytes = f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : new Uint8Array(f.zeros ?? 0)
      dt.items.add(new File([bytes], f.name, { type: f.mimeType }))
    }
    ;(document.getElementById('share-files') as HTMLInputElement).files = dt.files
  }, files.map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.buffer?.toString('base64') ?? '', zeros: f.zeros ?? 0 })))
  await page.locator('#share-go').click()
  await waitForApp(page)
}

/** The Web Speech API stand-in (see meeting-notes.spec.ts): say(text, final) emits a result. */
function fakeSpeech() {
  const speech: AnyState = { current: null }
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
  const w = window as unknown as AnyState
  w.SpeechRecognition = FakeRecognition
  w.webkitSpeechRecognition = FakeRecognition
  w.__speech = speech
}

/** api.anthropic.com → a canned answer; returns the request bodies. Never a real request. */
async function mockClaude(ctx: BrowserContext): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(JSON.parse(req.postData() ?? '{}'))
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(JSON.stringify({ alt: 'A bench with a label.', caption: 'Bench 4' })) }).catch(() => {})
  })
  return bodies
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

test('manifest: a POST share target with files, a maskable icon, four shortcuts, screenshots', async ({ page }) => {
  const res = await page.request.get('manifest.webmanifest')
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m.share_target).toMatchObject({ method: 'POST', enctype: 'multipart/form-data', params: { title: 'title', text: 'text', url: 'url' } })
  expect(m.share_target.params.files).toHaveLength(1)
  expect(m.share_target.params.files[0].name).toBe('files')
  expect(m.share_target.params.files[0].accept).toEqual(expect.arrayContaining(['image/*', 'application/pdf', 'audio/*', 'text/*', '.csv']))
  const action = new URL(m.share_target.action, res.url())
  expect(action.pathname).toBe('/SimpleCMS/app/')
  expect(action.searchParams.has('share-target')).toBe(true)
  expect(m.categories).toEqual(expect.arrayContaining(['productivity']))

  const maskable = (m.icons as AnyState[]).filter((i) => i.purpose === 'maskable')
  expect(maskable.map((i) => i.sizes)).toEqual(['512x512', '192x192'])
  expect((m.shortcuts as AnyState[]).map((s) => s.name)).toEqual(['Quick note', 'New page', 'Search', 'AI terminal'])
  expect((m.shortcuts as AnyState[]).map((s) => new URL(s.url, res.url()).searchParams.get('launch'))).toEqual(['capture', 'new-page', 'search', 'terminal'])
  expect((m.screenshots as AnyState[]).map((s) => s.form_factor)).toEqual(['wide', 'narrow'])

  // every picture the manifest names is there, an image of the size it claims
  const pictures = [...(m.icons as AnyState[]), ...(m.shortcuts as AnyState[]).flatMap((s) => s.icons), ...(m.screenshots as AnyState[])]
  for (const p of pictures) {
    const r = await page.request.get(new URL(p.src, res.url()).href)
    expect(r.ok(), p.src).toBe(true)
    expect(r.headers()['content-type'], p.src).toMatch(/^image\//)
    const body = await r.body()
    const [w, h] = String(p.sizes).split('x').map(Number)
    if (p.type === 'image/png') expect([body.readUInt32BE(16), body.readUInt32BE(20)], p.src).toEqual([w, h])
  }
  // the maskable icon has no transparent corner (a mask may cut anywhere)
  const icon = await page.request.get(new URL(maskable[0].src, res.url()).href)
  await page.goto('about:blank')
  const corner = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    return Array.from(g.getImageData(0, 0, 1, 1).data)[3]
  }, (await icon.body()).toString('base64'))
  expect(corner).toBe(255)
})

/* ------------------------------------------------------------------ */
/* Files shared into the app                                           */
/* ------------------------------------------------------------------ */

test.describe('share target (service worker)', () => {
  test.use({ serviceWorkers: 'allow' })

  test('shared photo + PDF + text: kept by the worker, asked first, saved to Clippings with next steps', async ({ page, context }) => {
    const bodies = await mockClaude(context)
    await openApp(page)
    await controlled(page)
    await setKey(page)
    await flush(page)
    const image = await png(page)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await shareForm(page, { title: 'Lab photos', text: 'From the bench today', url: '' }, [
      { name: 'bench.png', mimeType: 'image/png', buffer: image },
      { name: 'protocol.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: svg },
    ])

    // the worker kept it — outside the workspace — and the app asks (a share never carries the clip token)
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    await expect(ask.locator('.clipq__page')).toHaveText('Lab photos')
    await expect(ask.locator('.clipq__quote')).toHaveText('From the bench today')
    const files = ask.getByTestId('clip-files').locator('li')
    await expect(files).toHaveCount(3)
    await expect(files.nth(0)).toHaveAttribute('data-kind', 'image')
    await expect(files.nth(1)).toHaveAttribute('data-kind', 'pdf')
    await expect(files.nth(2)).toHaveAttribute('data-kind', 'file')
    const stored = await storedShares(page)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ title: 'Lab photos', text: 'From the bench today' })
    expect(stored[0].files.map((f) => f.name)).toEqual(['bench.png', 'protocol.pdf', 'drawing.svg'])
    expect(await inboxIds(page)).toEqual([])
    // the route is replaced: a reload never asks twice
    expect(await page.evaluate(() => window.location.hash)).not.toContain('share=')

    await ask.getByRole('button', { name: /Save to Clippings/ }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Lab photos')
    const id = (await routeId(page))!
    const blocks = await blocksOf(page, id)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blockquote', 'image', 'fileBlock', 'fileBlock', 'paragraph'])
    expect(blocks[0].content[0].text).toBe('Shared ')
    expect(blocks[2].attrs.src).toMatch(/^onefile:/)
    expect(blocks[3].attrs).toMatchObject({ name: 'protocol.pdf', display: 'viewer' })
    expect(blocks[4].attrs).toMatchObject({ name: 'drawing.svg', display: 'file' })
    // markup never renders: the SVG is stored as a plain download
    const types = await page.evaluate(
      async (refs) => Promise.all(refs.map(async (r) => (await (window as unknown as AnyState).__one.files.getFile(r))?.type)),
      [blocks[2].attrs.src, blocks[3].attrs.src, blocks[4].attrs.src],
    )
    expect(types).toEqual(['image/png', 'application/pdf', 'application/octet-stream'])
    const inbox = await inboxIds(page)
    expect((await pageById(page, id)).parentId).toBe(inbox[0])
    await expect.poll(() => storedShares(page)).toEqual([])

    // the next step: Claude for the image and the PDF
    const images = toast(page, 'Images saved — Claude can describe them or read out their text')
    await expect(images).toBeVisible()
    await expect(images.getByRole('button', { name: 'Read out text' })).toBeVisible()
    await expect(toast(page, 'PDF saved — Claude can summarise it or extract its tables').getByRole('button', { name: 'Extract tables' })).toBeVisible()
    await images.getByRole('button', { name: 'Describe' }).click()
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThan(0)
    const content = bodies[0].messages[0].content as AnyState[]
    expect(content.some((b) => b.type === 'image' && b.source?.type === 'base64')).toBe(true)
  })

  test('Discard drops the share; a file over 25 MB is listed but never kept', async ({ page }) => {
    await openApp(page)
    await controlled(page)
    await shareForm(page, { title: '', text: '', url: '' }, [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('a line of notes') },
      { name: 'huge.mov', mimeType: 'video/quicktime', zeros: 26 * 1024 * 1024 },
    ])
    const ask = askCard(page)
    await expect(ask).toBeVisible()
    // a share of one file is titled after it
    await expect(ask.locator('.clipq__page')).toHaveText('notes')
    await expect(ask.getByTestId('clip-files').locator('li[data-skipped]')).toContainText('over 25 MB · not kept')
    const stored = await storedShares(page)
    expect(stored[0].files.map((f) => f.name)).toEqual(['notes.txt'])
    expect(stored[0].skipped).toEqual([{ name: 'huge.mov', reason: 'size' }])
    await ask.getByRole('button', { name: /Discard/ }).click()
    await expect(ask).toHaveCount(0)
    await expect.poll(() => storedShares(page)).toEqual([])
    expect(await inboxIds(page)).toEqual([])
  })
})

test('app side: a share in IndexedDB → asked, saved; offline the next steps wait for the connection (DE)', async ({ page, context, errors }) => {
  // no service worker in these tests: offline, the page's own icon files cannot load
  errors.allow(/ERR_INTERNET_DISCONNECTED/)
  await openApp(page)
  await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  const image = (await png(page, 'Whiteboard')).toString('base64')
  await putShare(page, 'e2eshare01', { files: [{ name: 'whiteboard.png', type: 'image/png', b64: image }] })
  await page.evaluate(() => (window.location.hash = '#/clip?share=e2eshare01'))
  const ask = askCard(page, 'In der Ablage speichern?')
  await expect(ask).toBeVisible()
  await expect(ask.locator('.clipq__page')).toHaveText('whiteboard')
  await expect(ask.getByText('Dateien · 1')).toBeVisible()
  await context.setOffline(true)
  await ask.getByRole('button', { name: /In die Ablage/ }).click()
  await expect(page.locator('#main .pv-title')).toHaveValue('whiteboard')
  await expect(toast(page, 'Gespeichert. Claude kann es beschreiben oder zusammenfassen, sobald du online bist')).toBeVisible()
  await expect(toast(page, 'Bilder gespeichert')).toHaveCount(0)
  await context.setOffline(false)
  await expect(toast(page, 'Bilder gespeichert — Claude kann sie beschreiben oder ihren Text auslesen').getByRole('button', { name: 'Beschreiben' })).toBeVisible()
  // the share is used up: the same link again finds nothing
  await page.evaluate(() => (window.location.hash = '#/clip?share=e2eshare01'))
  await expect(toast(page, 'Schon gespeichert oder verworfen')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* Quick capture                                                       */
/* ------------------------------------------------------------------ */

test.describe('quick capture', () => {
  test('Mod+Shift+K: text → a Clippings page (first line = title, Markdown body); the draft survives closing', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+Shift+K`)
    const s = sheet(page)
    await expect(s).toBeVisible()
    const text = s.getByRole('textbox', { name: 'Note' })
    await expect(text).toBeFocused()
    await page.keyboard.type('Call the venue')
    // closed by accident: the words wait for the next time
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)
    await page.keyboard.press(`${MOD}+Shift+K`)
    await expect(text).toHaveValue('Call the venue')
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('- ask for the projector')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('- confirm **40** seats')
    await expect(s.getByText('A new page in Clippings.')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(s).toHaveCount(0)
    await expect(toast(page, 'Saved to Clippings')).toBeVisible()
    const inbox = await inboxIds(page)
    expect(inbox).toHaveLength(1)
    const kids = await childrenOf(page, inbox[0])
    expect(kids.map(([, title]) => title)).toEqual(['Call the venue'])
    const blocks = await blocksOf(page, kids[0][0])
    expect(blocks[0].type).toBe('bulletList')
    expect(JSON.stringify(blocks[0])).toContain('ask for the projector')
    expect(JSON.stringify(blocks[0])).toContain('"bold"')
    // the Clippings page lists it
    const links = (await blocksOf(page, inbox[0])).filter((b) => b.type === 'pageLink').map((b) => b.attrs.pageId)
    expect(links).toEqual([kids[0][0]])
    // the draft is gone once saved
    await page.keyboard.press(`${MOD}+Shift+K`)
    await expect(text).toHaveValue('')
    // the same keys close it
    await page.keyboard.press(`${MOD}+Shift+K`)
    await expect(s).toHaveCount(0)
    // toast → Open
    await toast(page, 'Saved to Clippings').getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Call the venue')
  })

  test('to a database: a new row titled by the first line; to a page: added at its end; ⌘K opens it', async ({ page }) => {
    await openApp(page)
    const db = await pageIdByTitle(page, 'Reading list')
    const notes = await createPage(page, { title: 'Groceries', content: doc(para('Weekly list:'), para('')) })

    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('quick capture')
    await page.keyboard.press('Enter')
    const s = sheet(page)
    await expect(s).toBeVisible()
    await page.keyboard.type('Thinking, Fast and Slow')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Recommended by Ana.')
    await s.getByTestId('capture-target').click()
    await page.keyboard.type('Reading')
    await page.getByRole('menuitem', { name: /^Reading list/ }).click()
    await expect(s.getByTestId('capture-target')).toContainText('Reading list')
    await expect(s.getByText('A new entry — the first line is its title.')).toBeVisible()
    await s.getByRole('button', { name: /^Save/ }).click()
    await expect(toast(page, 'Added to “Reading list”')).toBeVisible()
    const row = await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title === 'Thinking, Fast and Slow') ?? null, db)
    expect(row).not.toBeNull()
    expect(row!.plain).toContain('Recommended by Ana.')
    expect(await inboxIds(page)).toEqual([])

    await page.keyboard.press(`${MOD}+Shift+K`)
    await page.keyboard.type('oat milk')
    await s.getByTestId('capture-target').click()
    await page.keyboard.type('Groc')
    await page.getByRole('menuitem', { name: /^Groceries/ }).click()
    await expect(s.getByText('Added at the end of the page.')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(toast(page, 'Added to the end of “Groceries”')).toBeVisible()
    const blocks = await blocksOf(page, notes)
    expect(blocks.map((b) => b.content?.[0]?.text ?? '')).toEqual(['Weekly list:', 'oat milk'])
  })

  test('a photo (camera input) becomes an image block; offline it is saved on the device', async ({ page, context, errors }) => {
    errors.allow(/ERR_INTERNET_DISCONNECTED/)
    await openApp(page)
    const image = await png(page, 'Receipt')
    await context.setOffline(true)
    await page.keyboard.press(`${MOD}+Shift+K`)
    const s = sheet(page)
    await expect(s.getByText('Offline · saved on this device')).toBeVisible()
    const camera = s.getByTestId('capture-photo')
    await expect(camera).toHaveAttribute('accept', 'image/*')
    await expect(camera).toHaveAttribute('capture', 'environment')
    await camera.setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: image })
    await expect(s.locator('.qcap__thumb')).toBeVisible()
    await expect(s.locator('.qcap__file')).toContainText('receipt.png')
    await s.getByRole('button', { name: /^Save/ }).click()
    await expect(toast(page, 'Saved to Clippings · offline, kept on this device')).toBeVisible()
    const inbox = await inboxIds(page)
    const kids = await childrenOf(page, inbox[0])
    expect(kids[0][1]).toMatch(/^Note · /)
    const blocks = await blocksOf(page, kids[0][0])
    expect(blocks[0]).toMatchObject({ type: 'image', attrs: { alt: 'receipt' } })
    expect(blocks[0].attrs.src).toMatch(/^onefile:/)
    await context.setOffline(false)
    await reloadApp(page)
    expect((await blocksOf(page, kids[0][0]))[0].type).toBe('image')
  })

  test('voice note: the browser speech recognition types into the text (fake recognizer)', async ({ page }) => {
    await page.addInitScript(fakeSpeech)
    await openApp(page)
    await page.keyboard.press(`${MOD}+Shift+K`)
    const s = sheet(page)
    const mic = s.getByRole('button', { name: 'Voice note' })
    await mic.click()
    await expect(s.getByText('Listening')).toBeVisible()
    await expect(s.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => (window as unknown as AnyState).__speech.say('Buy oat milk', true))
    await expect(s.getByRole('textbox')).toHaveValue('Buy oat milk')
    await page.evaluate(() => (window as unknown as AnyState).__speech.say('and coffee', false))
    await expect(s.locator('.qcap__interim')).toHaveText('and coffee')
    // Save takes what is on screen, the phrase in flight included
    await s.getByRole('button', { name: /^Save/ }).click()
    await expect(toast(page, 'Saved to Clippings')).toBeVisible()
    const kids = await childrenOf(page, (await inboxIds(page))[0])
    expect(kids.map(([, t]) => t)).toEqual(['Buy oat milk and coffee'])
  })

  test('German: the sheet, its hints and the toast', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.keyboard.press(`${MOD}+Shift+K`)
    const s = sheet(page, 'Schnell erfassen')
    await expect(s).toBeVisible()
    await expect(s.getByRole('textbox', { name: 'Notiz' })).toHaveAttribute('placeholder', 'Schreib es auf — Markdown geht. Die erste Zeile wird der Titel.')
    await expect(s.getByText('Eine neue Seite in der Ablage.')).toBeVisible()
    await page.keyboard.type('Idee für Freitag')
    await s.getByRole('button', { name: /^Speichern/ }).click()
    await expect(toast(page, 'In der Ablage gespeichert')).toBeVisible()
    expect((await childrenOf(page, (await inboxIds(page))[0])).map(([, t]) => t)).toEqual(['Idee für Freitag'])
  })

  test('home-screen shortcuts: ?launch=capture / search / new-page, the parameter is removed', async ({ page }) => {
    await openApp(page)
    await page.goto('app/?e2e&launch=capture')
    await waitForApp(page)
    await expect(sheet(page)).toBeVisible()
    expect(await page.evaluate(() => window.location.search)).toBe('?e2e')
    await page.goto('app/?e2e&launch=search')
    await waitForApp(page)
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    const before = await wsEval(page, (s) => Object.keys(s.pages).length)
    await page.goto('app/?e2e&launch=new-page')
    await waitForApp(page)
    await expect.poll(() => wsEval(page, (s) => Object.keys(s.pages).length)).toBe(before + 1)
    await expect(page.locator('#main .pv-title')).toHaveValue('')
  })
})

test.describe('quick capture at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

  test('the floating key opens a bottom sheet with ≥ 44 px keys; it steps aside while typing', async ({ page }) => {
    await openApp(page)
    const fab = page.getByTestId('capture-fab')
    await expect(fab).toBeVisible()
    const box = (await fab.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 12)
    expect(box.y + box.height).toBeLessThanOrEqual(844 - 12)
    expect(box.width).toBeGreaterThanOrEqual(44)

    await fab.tap()
    const s = sheet(page)
    await expect(s).toBeVisible()
    const sb = (await s.boundingBox())!
    // on the bottom edge (±2 px: the sheet may still be settling from its 8 px slide-in)
    expect(Math.abs(sb.y + sb.height - 844)).toBeLessThanOrEqual(2)
    expect(sb.x).toBeGreaterThanOrEqual(0)
    expect(sb.x + sb.width).toBeLessThanOrEqual(390)
    for (const name of ['Voice note', 'Photo', 'Attach a file', 'Close'])
      expect((await s.getByRole('button', { name }).boundingBox())!.height, name).toBeGreaterThanOrEqual(44)
    expect((await s.getByRole('button', { name: /^Save/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await s.getByTestId('capture-target').boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await expect(fab).toHaveCount(0)
    await s.getByRole('button', { name: 'Close' }).tap()
    await expect(s).toHaveCount(0)
    await expect(fab).toBeVisible()

    // typing in the page: out of the way
    await page.locator('#main .ProseMirror p').first().tap()
    await expect(fab).toBeHidden()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(fab).toBeVisible()
    // the drawer covers it
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(fab).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ */
/* Install One                                                         */
/* ------------------------------------------------------------------ */

/** The browser offers an install (a stand-in for Chrome's beforeinstallprompt). */
const offerInstall = (page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') =>
  page.evaluate((outcome) => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & AnyState
    e.prompt = () => {
      ;(window as unknown as AnyState).__prompted = ((window as unknown as AnyState).__prompted ?? 0) + 1
      return Promise.resolve()
    }
    e.userChoice = Promise.resolve({ outcome })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }, outcome)

async function openGeneral(page: Page) {
  await page.keyboard.press(`${MOD}+,`)
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

test.describe('install One', () => {
  test('the key shows when the browser offers an install, runs its prompt, and is gone once installed', async ({ page }) => {
    await openApp(page)
    await openGeneral(page)
    await expect(page.getByTestId('install-one')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // One keeps the browser's mini-infobar away and offers the install itself
    expect(await offerInstall(page)).toBe(true)
    await page.locator('aside.sb .sb-head__ws').click()
    await expect(page.getByRole('menuitem', { name: 'Install One' })).toBeVisible()
    await page.keyboard.press('Escape')
    await openGeneral(page)
    const key = page.getByTestId('install-one')
    await expect(key).toContainText('As an app: its own window and icon, works offline')
    await key.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(key).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as AnyState).__prompted)).toBe(1)
  })

  test('hidden while One runs installed (display-mode: standalone)', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window)
      window.matchMedia = (q: string) =>
        q.includes('display-mode: standalone')
          ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
          : orig(q)
    })
    await openApp(page)
    await offerInstall(page)
    await openGeneral(page)
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByText('Spell check', { exact: true })).toBeVisible()
    await expect(page.getByTestId('install-one')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.locator('aside.sb .sb-head__ws').click()
    await expect(page.getByRole('menuitem', { name: /^Settings/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Install One' })).toHaveCount(0)
  })
})

test.describe('install One on iPhone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  })

  test('Safari has no prompt: the placard shows Share → Add to Home Screen with its symbols', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await page.locator('aside.sb .sb-head__ws').tap()
    await page.getByRole('menuitem', { name: 'Install One' }).tap()
    const placard = page.getByRole('dialog', { name: 'Add One to your Home Screen' })
    await expect(placard).toBeVisible()
    const steps = placard.locator('.installq__step')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText('tap Share')
    await expect(steps.nth(1)).toContainText('Add to Home Screen')
    await expect(placard.locator('.installq__glyph svg')).toHaveCount(2)
    await expect(placard).toContainText('Sharing files into One is not possible on iOS')
    const box = (await placard.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await placard.getByRole('button', { name: 'Got it' }).tap()
    await expect(placard).toHaveCount(0)
  })
})

test('the editor still links with Mod+K; the shortcuts list names quick capture', async ({ page }) => {
  await openApp(page)
  const id = await createPage(page, { title: 'Keys', content: doc(para('plain words')) })
  await gotoPage(page, id)
  // Mod+K on selected text: the link field (not the palette)
  await selectText(page, editorOf(page, id), 'plain')
  await page.keyboard.press(`${MOD}+k`)
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // the Keys tab of the help lists both
  await page.keyboard.press(`${MOD}+/`)
  const help = page.getByRole('dialog', { name: /^Help$/ })
  await expect(help).toBeVisible()
  await expect(help.getByText('Quick capture', { exact: true })).toBeVisible()
  await expect(help.getByText('Add link', { exact: true })).toBeVisible()
})
