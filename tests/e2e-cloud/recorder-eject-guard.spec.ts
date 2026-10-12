/**
 * Flight recorder — the eject in a team workspace (R3): reading works, ejecting does not yet. The EJECT key is off with
 * its reason, the seam's eject refuses before planning, and the store's applyRewind refuses through the guard the cloud
 * registers (setRewindGuard) — nothing is written. Fictional people and pages (Mara Lind, Tessera).
 */
import { test, expect, email, signIn, openApp, waitOnline, wsEval, createWorkspace } from './fixtures'
import { rec, startRecorder, step } from '../e2e/helpers/recorder'

const agent = (run: string, change: string) => ({ kind: 'agent', id: 'tessera-helfer', run, change })

test.describe('flight recorder — the eject in a team workspace', () => {
  test('EJECT is off ("comes to team workspaces later"), the seam refuses, applyRewind refuses; reading the window works', async ({ page }) => {
    test.setTimeout(150_000)
    await signIn(page, email('mara'))
    const wsId = await createWorkspace(page, 'Tessera Team')
    await openApp(page, wsId)
    await waitOnline(page)
    await startRecorder(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Tessera Plan' }) as string)
    await step(page, agent('t1', 'c1'), [['updatePage', pageId, { title: 'Tessera Plan (Entwurf)' }]], { note: { seq: 1 }, end: true })
    await rec(page, 'settle')
    const run = (await rec<Array<{ key: string; from: number; to: number }>>(page, 'runs')).find((r) => r.key.startsWith('agent:tessera-helfer'))!
    expect(run).toBeTruthy()

    // the deck: the run's flag brackets it, the plate reads it — the key is off with its reason
    await page.keyboard.press('Control+Alt+z')
    const deck = page.locator('section.deck')
    await page.locator('.lane[data-lane="agent:tessera-helfer"] .flag').first().click()
    await expect(deck.locator('.win .mtr b').first()).toHaveText(/\d/)
    await expect(deck.locator('.eject__key')).toBeDisabled()
    await expect(deck.locator('.eject__off')).toHaveText('Ejecting comes to team workspaces later — reading works.')
    await expect(deck.locator('.eject__cover')).toHaveCount(0)
    // reading works
    await deck.locator('.dbtn--read').click()
    await expect(page.locator('.modal.rec-read .plan__label')).toHaveText(['Pages · 1'])
    await page.keyboard.press('Escape')

    // the seam refuses before planning; the store refuses through the guard
    const sel = { lane: 'agent:tessera-helfer', run: run.key, a: run.from - 1000, b: run.to + 60_000 }
    expect(await rec<{ refused?: { key: string } }>(page, 'ejectRaw', sel)).toMatchObject({ refused: { key: 'teamLater' } })
    expect(await rec<{ refused?: { key: string } }>(page, 'eject', sel)).toMatchObject({ refused: { key: 'teamLater' } })
    const written = await wsEval(page, (s, id) => s.applyRewind({ pages: { [id]: { ...s.pages[id], title: 'Tessera Plan' } }, databases: {} }, 'eject'), pageId)
    expect(written).toBe(false)
    expect(await wsEval(page, (s, id) => s.pages[id].title, pageId)).toBe('Tessera Plan (Entwurf)')
    expect(await rec<unknown[]>(page, 'ejects')).toEqual([])
    expect(await rec(page, 'unknowns')).toEqual([])
  })
})
