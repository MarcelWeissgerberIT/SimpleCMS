/**
 * Preflight's Bordbuch (T-P2-10; IndexedDB `one-preflight` / `kv`, `<scope>|log|<day>` and `<scope>|opened`): the day's
 * events of every kind (lamp test, acknowledgements, cards, Undo, a source's run, fold / unfold, all clear, lit again)
 * — first each kind asserted, then: the stored JSON holds ids and codes only (no seeded title, key, draft or name), days
 * older than 30 go at the next day's start, a local reset wipes it. Every name is fictional; no request leaves the machine.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp } from './fixtures'
import { flushLamps, seedMirror, seedRuns, waitPreflight } from './helpers/preflightStory.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>

/** Everything the `one-preflight` database holds: { key: value }. */
const dump = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const req = indexedDB.open('one-preflight')
        req.onerror = () => resolve({})
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('kv')) {
            db.close()
            return resolve({})
          }
          const st = db.transaction('kv').objectStore('kv')
          const keys = st.getAllKeys()
          const values = st.getAll()
          values.onsuccess = () => {
            const out: Record<string, unknown> = {}
            keys.result.forEach((k, i) => (out[String(k)] = values.result[i]))
            db.close()
            resolve(out)
          }
        }
      }),
  )

/** Put a value under a key in `one-preflight` / `kv` (an older day's Bordbuch). */
const put = (page: Page, key: string, value: unknown) =>
  page.evaluate(
    ({ key, value }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('one-preflight')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(value, key)
          tx.oncomplete = () => (db.close(), resolve())
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
    { key, value },
  )

const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  await openApp(page)
  await waitPreflight(page)
}

test('every kind of event, ids only in the stored JSON; days older than 30 go; a local reset wipes the Bordbuch', async ({ page }) => {
  test.setTimeout(120_000)
  await start(page)
  await page.evaluate(() => (window.location.hash = '#/'))
  // a probe lamp of test data: lit → the lamp test, acknowledged, folded, all clear, lit again
  const probe = (count: number) => pf(page, (p, count) => p.fakeLamps([{ id: 'probe', legend: 'Probe\nlamp', count }]), count)
  await probe(1)
  await flushLamps(page)
  await expect(page.locator('.pf-cap[data-lamp="probe"]')).toHaveAttribute('data-lit', 'amber')
  await pf(page, (p) => p.ack('probe'))
  await pf(page, (p) => p.fold())
  await pf(page, (p) => p.unfold())
  await probe(0)
  await flushLamps(page)
  await probe(1)
  await flushLamps(page)
  await probe(0)
  await flushLamps(page)

  // a mirror's run (a source event), one card applied, its Undo
  const m = await seedMirror(page)
  await seedRuns(page, m)
  await page.evaluate(() => (window.location.hash = '#/'))
  await flushLamps(page)
  await page.locator('.pf-cap[data-lamp="proposals"]').focus()
  await page.keyboard.press('Enter')
  const card = page.locator('.pf-q article.pf-card[data-current]')
  await expect(card).toBeFocused()
  await expect(card).not.toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('a')
  await expect.poll(() => pf(page, (p) => p.stores.queue.getState().done.length)).toBe(1)
  await expect(card).toBeFocused()
  await page.keyboard.press('z')
  await expect.poll(() => pf(page, (p) => p.stores.queue.getState().done.filter((d: AnyState) => d.undone).length)).toBe(1)

  // G6: every kind is there before anything is asserted about the stored form (a run is noted 1.5 s after it arrived)
  await expect.poll(async () => ((await pf(page, (p) => p.log())) as AnyState[]).some((e) => e.k === 'source')).toBe(true)
  const events = (await pf(page, (p) => p.log())) as AnyState[]
  const kinds = new Set(events.map((e) => e.k))
  for (const k of ['test', 'ack', 'card', 'undo', 'source', 'fold', 'unfold', 'clear', 'relit']) expect(kinds, `a "${k}" event`).toContain(k)
  expect(events.find((e) => e.k === 'source')).toMatchObject({ lamp: 'proposals', ref: `${m.mirrorId}/r-now`, n: 4 })
  expect(events.find((e) => e.k === 'card')).toMatchObject({ lamp: 'proposals', outcome: 'applied', kind: 'proposal', refs: { agentId: m.mirrorId, runId: 'r-now' } })
  expect(events.find((e) => e.k === 'ack' && e.lamp === 'probe')).toMatchObject({ how: 'enter', n: 1 })

  // the stored JSON: ids and codes only
  const json = JSON.stringify(await dump(page))
  for (const word of ['Exportfilter verliert Sonderzeichen', 'Zertifikat Halle Nord', 'NL-201', 'NL-202', 'Nordlicht', 'Mara Lind', 'Ivo Brandt', 'Oda Wendt', 'Kommentare', 'Probe']) expect(json, `"${word}" in one-preflight`).not.toContain(word)
  expect(json).toContain('run:r-now#c1')

  // retention: a day 31 days back goes at the next day's start, one 29 days back stays
  const scope = (await pf(page, (p) => p.state().scope)) as string
  const old = dayOf(Date.now() - 31 * 86_400_000)
  const kept = dayOf(Date.now() - 29 * 86_400_000)
  await put(page, `${scope}|log|${old}`, [{ at: Date.now() - 31 * 86_400_000, k: 'fold' }])
  await put(page, `${scope}|log|${kept}`, [{ at: Date.now() - 29 * 86_400_000, k: 'fold' }])
  await page.reload()
  await waitPreflight(page)
  await expect.poll(async () => Object.keys(await dump(page)).filter((k) => k.includes('|log|')).sort()).toEqual([`${scope}|log|${kept}`, `${scope}|log|${dayOf(Date.now())}`].sort())

  // a local reset wipes the Bordbuch and the opened cards
  expect(Object.keys(await dump(page))).toContain(`${scope}|opened`)
  await page.evaluate(() => localStorage.setItem('one.resetPending', '1'))
  await page.reload()
  await waitPreflight(page)
  await expect.poll(async () => Object.keys(await dump(page)).includes(`${scope}|log|${kept}`)).toBe(false)
  const after = await dump(page)
  expect(JSON.stringify(after[`${scope}|opened`] ?? {})).not.toContain('run:r-now')
  expect(JSON.stringify(after)).not.toContain('r-now')
})
