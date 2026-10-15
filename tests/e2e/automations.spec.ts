/**
 * Automations — the modal on the one reader and writer (B15, plan §1.14 / §1.20): AutomationsModal reads through
 * readAutomations (a newer build's entry is neither shown nor run, and kept by the writer) and writes only through
 * saveAutomations as the person; a LOCKED database shows its automations with only the off switch and removals (a
 * removal is saved; an add — the delete toast's Undo puts one back — is refused with the reason); the Patchbay's hint
 * line ("On fuse F1 — show in the Patchbay") opens `#/patchbay?f=<path key>`.
 * Every name is fictional (Nordlicht, Tessera, Mara Lind); every host `*.example` (never called).
 */
import { test, expect, openApp, wsEval, uiEval, flush } from './fixtures'
import type { Page } from '@playwright/test'

type Seeded = { db: string; prop: string }

/** A database "Nordlicht Leads" with a checkbox and the given automations (written through the test hook, you~ui:e2e). */
async function seed(page: Page, automations: (ids: Seeded) => unknown[], opts: { locked?: boolean } = {}): Promise<Seeded> {
  const ids = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht Leads', parentId: null })
    const prop = s.addProperty(db, { type: 'checkbox', name: 'Weiterleiten' })
    return { db, prop }
  })
  await wsEval(page, (s, a) => s.updateDatabase(a.ids.db, { automations: a.list, ...(a.locked ? { locked: true } : {}) }), { ids, list: automations(ids), locked: !!opts.locked })
  await flush(page)
  return ids
}

const hook = (id: string, name: string, prop: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  enabled: true,
  trigger: { type: 'property_changed', propertyId: prop },
  actions: [
    { type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } },
    { type: 'notify', message: '{title} weitergeleitet' },
  ],
  lastRunAt: null,
  lastStatus: null,
  lastMessage: null,
  ...over,
})

async function openAutomations(page: Page, db: string) {
  await uiEval(page, (s, id) => s.openModal({ type: 'automations', databaseId: id }), db)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Automations · Nordlicht Leads')
  return dialog
}

const stored = (page: Page, db: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.databases[id].automations ?? [])), db)

test.describe('automations (B15): the one reader and writer', () => {
  test('a newer build\'s automation is neither shown nor run, and an edit here keeps it as it is', async ({ page }) => {
    await openApp(page)
    const newer = { id: 'autNeu', name: 'Aus der Zukunft', enabled: true, trigger: { type: 'row_moved', to: 'x' }, actions: [{ type: 'webhook', url: 'https://later.example/in', method: 'POST' }] }
    const { db, prop } = await seed(page, ({ prop }) => [hook('autChat', 'An Team-Chat', prop), newer])
    const dialog = await openAutomations(page, db)
    await expect(dialog.getByRole('option')).toHaveCount(1)
    await expect(dialog.getByText('One automation from a newer version of One is kept as it is and does not run here.')).toBeVisible()
    // the person renames it: written through the one writer, the newer entry kept untouched after it
    const name = dialog.getByRole('textbox', { name: 'Automation name' })
    await name.fill('An Team-Chat · Nordlicht')
    await expect.poll(() => stored(page, db)).toEqual([expect.objectContaining({ id: 'autChat', name: 'An Team-Chat · Nordlicht', trigger: { type: 'property_changed', propertyId: prop } }), newer])
  })

  test('a locked database: the automations show with only the off switch and removals — a removal is saved, an add refused', async ({ page }) => {
    await openApp(page)
    const { db } = await seed(page, ({ prop }) => [hook('autChat', 'An Team-Chat', prop), hook('autMara', 'An Mara Lind', prop, { enabled: false })], { locked: true })
    const dialog = await openAutomations(page, db)
    // the lock is said, in ink
    const note = dialog.getByRole('note')
    await expect(note).toContainText('Locked')
    await expect(note).toContainText('can only be switched off or removed here')
    // nothing new: no "New", no recipe, no duplicate, no "Add action"
    await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: /Send new rows/ })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Duplicate' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Add action' })).toHaveCount(0)
    // no re-wiring: name, trigger, URL and method are read only
    await expect(dialog.getByRole('textbox', { name: 'Automation name' })).toHaveAttribute('readonly', '')
    await expect(dialog.getByRole('textbox', { name: 'Webhook URL' })).toHaveAttribute('readonly', '')
    await expect(dialog.getByRole('radio', { name: 'Row created' })).toBeDisabled()
    await expect(dialog.getByRole('radio', { name: 'PUT' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Watched property' })).toBeDisabled()

    // the off switch works — and stays off (switching on adds capability)
    const arm = dialog.getByRole('switch', { name: 'Enabled' })
    await expect(arm).toHaveAttribute('aria-checked', 'true')
    await arm.click()
    await expect(arm).toHaveAttribute('aria-checked', 'false')
    await expect(arm).toBeDisabled()
    await expect.poll(async () => (await stored(page, db)).find((a: { id: string }) => a.id === 'autChat')?.enabled).toBe(false)

    // removing an action is saved (the notification goes, the webhook with its headers stays)
    await dialog.getByRole('button', { name: 'Remove action' }).nth(1).click()
    await expect.poll(async () => (await stored(page, db)).find((a: { id: string }) => a.id === 'autChat')?.actions).toEqual([{ type: 'webhook', url: 'https://chat.example/hook', method: 'POST', headers: { 'X-Room': 'team' } }])

    // removing an automation is saved; its Undo would add it back — refused on the locked database, with the reason
    await dialog.getByRole('option', { name: /An Mara Lind/ }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect.poll(async () => (await stored(page, db)).map((a: { id: string }) => a.id)).toEqual(['autChat'])
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.toast').filter({ hasText: 'The database is locked — “An Mara Lind” cannot be put back here.' })).toBeVisible()
    expect((await stored(page, db)).map((a: { id: string }) => a.id)).toEqual(['autChat'])
    await flush(page)
  })

  test('a locked database: removing an action of an automation with a generated name keeps the name (no rename on the way)', async ({ page }) => {
    await openApp(page)
    const { db } = await seed(page, ({ prop }) => [hook('autAuto', '', prop)], { locked: true })
    const dialog = await openAutomations(page, db)
    await dialog.getByRole('button', { name: 'Remove action' }).nth(1).click()
    await expect.poll(async () => (await stored(page, db))[0]?.actions?.length).toBe(1)
    expect((await stored(page, db))[0].name).toBe('')
    await expect(page.locator('.toast').filter({ hasText: 'The database is locked' })).toHaveCount(0)
  })

  test('unlocked, the same Undo puts the automation back (you~undo) — the lock is the only difference', async ({ page }) => {
    await openApp(page)
    const { db } = await seed(page, ({ prop }) => [hook('autChat', 'An Team-Chat', prop), hook('autMara', 'An Mara Lind', prop)])
    const dialog = await openAutomations(page, db)
    await expect(dialog.getByRole('note')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Add action' })).toBeVisible()
    await dialog.getByRole('option', { name: /An Mara Lind/ }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect.poll(async () => (await stored(page, db)).map((a: { id: string }) => a.id)).toEqual(['autChat'])
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await stored(page, db)).map((a: { id: string }) => a.id)).toEqual(['autChat', 'autMara'])
  })

  test('the hint line: an automation on an open fuse says so and opens #/patchbay?f=<path key>; the others say nothing', async ({ page }) => {
    await openApp(page)
    const { db } = await seed(page, ({ prop }) => [hook('autChat', 'An Team-Chat', prop), hook('autMara', 'An Mara Lind', prop)])
    const key = 'e04746c37db3a1b6612a1de019fcab368b8215e2d9a71f3f30fd105013c5307b'
    const dialog = await openAutomations(page, db)
    await page.evaluate(
      ({ db, key }) => (window as unknown as { __onePatchbayHints: { set: (l: unknown[]) => void } }).__onePatchbayHints.set([{ kind: 'automation', id: `${db}:autChat`, fuse: { key, label: 'F1' } }]),
      { db, key },
    )
    const line = dialog.getByRole('link', { name: /On fuse F1 — show in the Patchbay/ })
    await expect(line).toBeVisible()
    await expect(line).toHaveAttribute('href', `#/patchbay?f=${key}`)
    // the other automation sits on no fuse: no line
    await dialog.getByRole('option', { name: /An Mara Lind/ }).click()
    await expect(dialog.getByRole('link', { name: /On fuse/ })).toHaveCount(0)
    await dialog.getByRole('option', { name: /An Team-Chat/ }).click()
    await dialog.getByRole('link', { name: /On fuse F1/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/patchbay?f=${key}`)
  })

  test('German: the lock note and the hint line', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { db } = await seed(page, ({ prop }) => [hook('autChat', 'An Team-Chat', prop)], { locked: true })
    await uiEval(page, (s, id) => s.openModal({ type: 'automations', databaseId: id }), db)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('note')).toContainText('Gesperrt')
    await expect(dialog.getByRole('note')).toContainText('nur ausschalten oder entfernen')
    await page.evaluate((db) => (window as unknown as { __onePatchbayHints: { set: (l: unknown[]) => void } }).__onePatchbayHints.set([{ kind: 'automation', id: `${db}:autChat`, fuse: { key: 'a'.repeat(64), label: 'F2' } }]), db)
    await expect(dialog.getByRole('link', { name: /Liegt auf Sicherung F2 — im Schaltplan zeigen/ })).toBeVisible()
  })
})
