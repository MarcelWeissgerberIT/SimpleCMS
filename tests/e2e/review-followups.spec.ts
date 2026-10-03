/**
 * Follow-ups of the last review: each test here failed before its fix.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { strFromU8, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { test, expect, openApp, wsEval, createPage, doc, gotoPage, editorOf, flush, MOD } from './fixtures'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneSync: any
  }
}

// headless Chromium stores OPFS names through the process locale (see sync.spec.ts)
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } })

type Hook = {
  run: (now?: number) => Promise<void>
  data: () => { items: Array<{ id: string; kind: string; pageId: string }>; rem: Record<string, { seen: number; fired?: number }> }
  reminders: () => Array<{ key: string }>
}
const inbox = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: Hook }).__oneInbox.data())) as ReturnType<Hook['data']>)
const reminderKeys = (page: Page) => page.evaluate(() => (window as unknown as { __oneInbox: Hook }).__oneInbox.reminders().map((r) => r.key))

const text = (t: string): JSONContent => ({ type: 'text', text: t })
const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const dateMention = (id: string, label: string, reminder: string | null = null): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'date', reminder } })
const personMention = (id: string, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'person' } })
const pageMention = (id: string, label: string): JSONContent => ({ type: 'mention', attrs: { id, label, kind: 'page' } })

/** Mention nodes of a page (kind, id, reminder), in document order. */
const mentionsOf = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const out: Array<{ kind: string; id: string; reminder: string | null }> = []
      const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
        if (n.type === 'mention') out.push({ kind: String(n.attrs?.kind), id: String(n.attrs?.id), reminder: (n.attrs?.reminder as string | null | undefined) ?? null })
        ;(n.content ?? []).forEach((c) => walk(c as typeof n))
      }
      if (s.pages[id]?.content) walk(s.pages[id].content)
      return out
    },
    id,
  )

/* ------------------------------------------------------------------ 1. mentions in Markdown files */

async function folderText(page: Page, name: string, path: string): Promise<string | null> {
  return page.evaluate(
    async ({ name, path }) => {
      try {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
        const segs = path.split('/')
        for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s)
        return await (await (await d.getFileHandle(segs[segs.length - 1])).getFile()).text()
      } catch {
        return null
      }
    },
    { name, path },
  )
}

async function writeFolder(page: Page, name: string, path: string, text: string) {
  await page.evaluate(
    async ({ name, path, text }) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
      const segs = path.split('/')
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true })
      const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable()
      await w.write(text)
      await w.close()
    },
    { name, path, text },
  )
}

/** A page whose lines mention a date with a reminder, a person and another page. */
async function mentionPage(page: Page, title: string, parentId: string | null = null) {
  const alex = await wsEval(page, (s) => s.addPerson('Alex Rivera'))
  const target = await createPage(page, { title: 'Mention target', parentId })
  const id = await createPage(page, {
    title,
    parentId,
    content: doc(
      line(text('Call '), dateMention('2026-10-17', 'October 17, 2026', '-1d'), text(' with '), personMention(alex, 'Alex Rivera'), text(' about '), pageMention(target, 'Mention target'), text('.')),
      line(text('Kept as it is: '), dateMention('2026-10-20T14:30', 'October 20, 2026, 2:30 PM', '-15m'), text(' and '), personMention(alex, 'Alex Rivera'), text('.')),
    ),
  })
  // the mentioned page is a sub page (it travels with the export / sits in the page's folder)
  await wsEval(page, (s, x) => s.movePage(x.target, x.id), { target, id })
  await flush(page)
  return { id, alex, target }
}

test.describe('mentions survive a trip through Markdown files', () => {
  test('folder sync writes date / person mentions as one: links and an edit in the file keeps them (and the reminder)', async ({ page }) => {
    await openApp(page)
    const { id, alex, target } = await mentionPage(page, 'Mention sync')
    const before = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content.content[1]), id)
    await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('one-followup-mentions', { create: true })
      await window.__oneSync.connect(dir)
    })
    await expect.poll(() => folderText(page, 'one-followup-mentions', 'Mention sync.md'), { timeout: 15_000 }).toContain('# Mention sync')
    const file = (await folderText(page, 'one-followup-mentions', 'Mention sync.md'))!
    // readable on GitHub: the link text is the label
    expect(file).toContain(`Call [@October 17, 2026](one:date/2026-10-17?r=-1d) with [@Alex Rivera](one:person/${alex}) about [@Mention target](Mention%20sync/Mention%20target.md).`)
    expect(file).toContain(`[@October 20, 2026, 2:30 PM](one:date/2026-10-20T14:30?r=-15m)`)

    // edited outside One: the first line changes, the second stays as it was
    await writeFolder(page, 'one-followup-mentions', 'Mention sync.md', file.replace('Call [@', 'Phone [@'))
    await page.evaluate(() => window.__oneSync.pickup())
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain as string, id)).toContain('Phone')
    expect(await mentionsOf(page, id)).toEqual([
      { kind: 'date', id: '2026-10-17', reminder: '-1d' },
      { kind: 'person', id: alex, reminder: null },
      { kind: 'page', id: target, reminder: null },
      { kind: 'date', id: '2026-10-20T14:30', reminder: '-15m' },
      { kind: 'person', id: alex, reminder: null },
    ])
    // the line the file left alone is still One's own block (ids and all)
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content.content[1]), id)).toBe(before)
    // the reminder of the edited line is still scheduled
    expect(await reminderKeys(page)).toContain(`m:${id}:2026-10-17:-1d`)
    await gotoPage(page, id)
    await expect(editorOf(page, id).locator('.mention__date').first()).toBeVisible()
  })

  test('a Markdown export → import keeps date, person and page mentions; the website export has no one: links', async ({ page }, testInfo) => {
    await openApp(page)
    const root = await createPage(page, { title: 'Mention export' })
    const { id, alex } = await mentionPage(page, 'Mention notes', root)
    await gotoPage(page, root)

    const exportAs = async (format: RegExp) => {
      await page.keyboard.press(`${MOD}+k`)
      await page.keyboard.type('>export')
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('radio', { name: /Mention export/ }).click()
      await dialog.getByRole('radio', { name: format }).click()
      const download = page.waitForEvent('download')
      await dialog.locator('[data-export-run]').click()
      const d = await download
      const path = testInfo.outputPath(d.suggestedFilename())
      await d.saveAs(path)
      await expect(dialog.getByRole('status')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      return path
    }

    const mdZip = await exportAs(/Markdown folder/)
    const files = unzipSync(new Uint8Array(readFileSync(mdZip)))
    const notes = Object.keys(files).find((p) => p.endsWith('Mention notes.md'))!
    const md = strFromU8(files[notes])
    expect(md).toContain(`[@October 17, 2026](one:date/2026-10-17?r=-1d)`)
    expect(md).toContain(`[@Alex Rivera](one:person/${alex})`)
    expect(md).toContain('[@Mention target](Mention%20notes/Mention%20target.md)')

    // the website renders mentions as text / links — never as one: links
    const site = unzipSync(new Uint8Array(readFileSync(await exportAs(/Website/))))
    for (const [path, data] of Object.entries(site)) if (/\.(html|md|txt|json|xml)$/.test(path)) expect(strFromU8(data), path).not.toContain('one:')

    // import the Markdown ZIP: the mentions come back as mentions
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose files' }).click()
    await (await chooser).setFiles([{ name: 'mention-export.zip', mimeType: 'application/zip', buffer: readFileSync(mdZip) }])
    await expect(dialog.getByText(/Import complete/)).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    const copy = await wsEval(page, (s, id) => (Object.values(s.pages) as Array<{ id: string; title: string; trashed: boolean }>).find((p) => p.title === 'Mention notes' && p.id !== id && !p.trashed)?.id ?? null, id)
    expect(copy).not.toBeNull()
    const copyTarget = await wsEval(page, (s, copy) => (Object.values(s.pages) as Array<{ id: string; title: string; parentId: string }>).find((p) => p.title === 'Mention target' && p.parentId === copy)?.id ?? null, copy!)
    expect(copyTarget).not.toBeNull()
    expect(await mentionsOf(page, copy!)).toEqual([
      { kind: 'date', id: '2026-10-17', reminder: '-1d' },
      { kind: 'person', id: alex, reminder: null },
      { kind: 'page', id: copyTarget, reminder: null },
      { kind: 'date', id: '2026-10-20T14:30', reminder: '-15m' },
      { kind: 'person', id: alex, reminder: null },
    ])
  })
})

/* ------------------------------------------------------------------ 2. reminders × trash */

test.describe('reminders × trash', () => {
  test('a reminder that came due while its page was in the trash is noted on restore, not fired; later ones still fire', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T09:00:00+02:00') })
    await openApp(page)
    const id = await createPage(page, {
      title: 'Trashed standup',
      content: doc(line(text('Standup '), dateMention('2026-10-05T10:00', '10:00', 'at')), line(text('Review '), dateMention('2026-10-05T12:00', '12:00', 'at'))),
    })
    const early = `m:${id}:2026-10-05T10:00:at`
    const late = `m:${id}:2026-10-05T12:00:at`
    await expect.poll(async () => Object.keys((await inbox(page)).rem)).toEqual(expect.arrayContaining([early, late]))

    // in the trash while 10:00 passes
    await wsEval(page, (s, id) => s.trashPage(id), id)
    await flush(page)
    await page.clock.fastForward('01:30:00')
    await page.waitForTimeout(400)

    // back at 10:30: no toast, no inbox item — but noted
    await wsEval(page, (s, id) => s.restorePage(id), id)
    await flush(page)
    await page.clock.fastForward('00:01:00')
    await page.waitForTimeout(600)
    await expect(page.locator('.toast', { hasText: /reminder|Reminder/ })).toHaveCount(0)
    expect((await inbox(page)).items).toEqual([])
    expect((await inbox(page)).rem[early]?.fired).toBeTruthy()

    // the 12:00 one still fires
    await page.clock.fastForward('01:30:00')
    await expect(page.locator('.toast', { hasText: 'Reminder · Trashed standup' })).toBeVisible()
    expect((await inbox(page)).items.map((i) => i.id)).toEqual([`r:${late}`])
  })
})

/* ------------------------------------------------------------------ 5. orphaned synced copies × attribute steps */

test.describe('synced blocks × orphan filter', () => {
  test('an attribute-only step inside a copy whose original is gone is refused', async ({ page }) => {
    await openApp(page)
    const block = (source: string | null): JSONContent => ({
      type: 'syncedBlock',
      attrs: { syncId: 'followup-orphan', sourcePageId: source },
      content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [line(text('Sign the contract'))] }] }],
    })
    const a = await createPage(page, { title: 'Contract (original)', content: doc(block(null)) })
    const b = await createPage(page, { title: 'Contract hub', content: doc(line(text('Hub')), block(a)) })
    await wsEval(page, (s, id) => s.trashPage(id), a)
    await gotoPage(page, b)
    const ref = editorOf(page, b).locator('[data-type="synced-block"]')
    await expect(ref).toHaveAttribute('data-role', 'orphan')

    // setNodeAttribute (an AttrStep: no range in its step map) on the task item inside the copy
    const applied = await editorOf(page, b).evaluate((el) => {
      type N = { type: { name: string } }
      const ed = (el as HTMLElement & {
        editor: { state: { doc: { descendants: (f: (n: N, p: number) => boolean | void) => void }; tr: { setNodeAttribute: (p: number, k: string, v: unknown) => { docChanged: boolean } } }; view: { dispatch: (tr: unknown) => void } }
      }).editor
      let pos = -1
      ed.state.doc.descendants((n, p) => {
        if (pos < 0 && n.type.name === 'taskItem') pos = p
      })
      ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, 'checked', true))
      let checked: unknown = null
      ;(ed.state.doc as unknown as { descendants: (f: (n: N & { attrs: Record<string, unknown> }) => void) => void }).descendants((n) => {
        if (n.type.name === 'taskItem') checked = n.attrs.checked
      })
      return checked
    })
    expect(applied).toBe(false)
    await flush(page)
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), b)).toContain('"checked":false')
  })
})
