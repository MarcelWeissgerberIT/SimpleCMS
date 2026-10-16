/**
 * The Patchbay after the review "ui-words" (fix ui-words) — what the words, the keyboard and the pictures promise:
 *  - Node: an almost-open path in plain if-then words (no "without review", no threat) and every way out said — HTTP,
 *    mail, the Outbox (a "Sendeweg", sent by hand), Git; start phrases after the first go on mid-sentence; a blocked
 *    module says why, in German without pronouns; an MCP or Git way out is a "Way out" fact; glyph labels never sit
 *    on another glyph or label; a pipeline whose gate this device's Approvals pass opens its path;
 *  - this device's Approvals changed in another tab rebuild the count with the Patchbay closed;
 *  - the setup lamps read nothing again for a row's title or cell (typing), and again for a database renamed;
 *  - the agent editor with unsaved changes: the fuse line and "Change in the Patchbay" say "save or cancel first";
 *  - the keyboard: a press outside the popover keeps the field it went to; a patch's Undo hands the keyboard to its
 *    jack; "Show the whole setup" → the next lamp's key; Esc deselects before the recorder deck closes; ↵ on the setup
 *    fold unfolds and hands on to the line's key; a stale `?f=` link is said (near: its grey row);
 *  - the module window and the strand card say why a module is blocked; the strand LED grey like the rack's; jack
 *    titles carry the direction; forced colours light the open plate's lamps; touch keys ≥ 40 px; reduced motion
 *    jumps; MirrorSetup over the Patchbay is the step "Create database".
 * Every name is fictional (tests/fixtures/patchbay.ts); every host `*.example`.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval } from './fixtures'
import { describe as describeModule, fuseSay, plainOf, text } from '../../src/app/features/patchbay/plain'
import { messages as fuseMessages } from '../../src/app/features/patchbay/messages-fuses'
import { glyphLabels, STATIC } from '../../src/app/features/patchbay/render'
import type { PipelineStage, PropertyDef } from '../../src/app/store/types'
import { exits, inputOf, mock1, mock2, modelOf, profileFile, prop, seedPatchbay, trackerCnsx, type PbWorld } from '../fixtures/patchbay'
import { ctxOf, pipelineWorld } from '../fixtures/patchbay-fuses'
import { startRecorder } from './helpers/recorder'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const P = 'features.patchbay'
const PRONOUNS = /\b(er|sie|es|ihn|ihm|ihr|ihre|ihren|ihrem|ihrer|ihres|sein|seine|seinen|seinem|seiner|seines)\b/i

/** mock 1 with Inbox-Helfer on a model route this build cannot run (blocked: 'route'). */
function blockedWorld(): PbWorld {
  const w = mock1()
  w.ws.agents!.agInbox = { ...w.ws.agents!.agInbox, route: [{ p: 'openrouter', m: 'nordlicht/tessera-mini' }] } as never
  return w
}

/**
 * A pipeline whose autofill (Plan, from the mail it links) moves its tasks: queue → plan → a gate without a hold → push.
 * A task stops at the gate only with Approvals "all" (one right after a plan stage is passed with "review").
 */
function gateWorld(approvals: 'all' | 'review' | 'none' = 'all'): PbWorld {
  const w = pipelineWorld(approvals)
  const stages = [
    { id: 'stQueue', kind: 'queue', auto: true },
    { id: 'stPlan', kind: 'plan', auto: true },
    { id: 'stGate', kind: 'gate', auto: false },
    { id: 'stPush', kind: 'git', auto: false, gitAction: 'push' },
  ] as PipelineStage[]
  const db = w.ws.databases.dbCoding
  // the Stage select names the stages (coding/schema.ts readPipeline reads the pipeline through it)
  const stage = prop('pCodingStage', 'Stage', 'select', { options: stages.map((x, i) => ({ id: x.id, name: ['Ready', 'Plan', 'Review', 'Ship'][i], color: 'gray' })) as PropertyDef['options'] })
  w.ws.databases.dbCoding = { ...db, properties: [...db.properties, stage], pipeline: stages }
  return w
}

/** mock 1 at rest: Tessera-Spiegel's weekday 07:30 slot would run it on open (its window and toast cover the words). */
function atRest(): PbWorld {
  const w = mock1()
  w.ws.agents = { ...w.ws.agents, agTessera: { ...w.ws.agents!.agTessera, updatedAt: Date.parse('2031-01-01T00:00:00Z') } }
  return w
}

/* ------------------------------------------------------------------ Node */

test.describe('ui-words · Node — the words', () => {
  test('a near miss in plain if-then words: every way out said, no "without review", no threat, German without pronouns', () => {
    const w = exits()
    const m = modelOf(w)
    const input = inputOf(w)
    const say = (exit: string, decider: string, lang: 'en' | 'de') => {
      const n = m.nearMisses.find((x) => x.chain.exit?.type === exit && x.chain.decider === decider)!
      return text(fuseSay(n, m, input, ctxOf(lang), { near: true }))
    }
    expect(say('http', 'agent:agExApply', 'en')).toBe('If the agent “Mail-Sortierer” writes into “Notizen”, the script “Senden” sends data out by HTTP (after one more step).')
    expect(say('http', 'agent:agExApply', 'de')).toBe('Schreibt der Agent „Mail-Sortierer“ in „Notizen“, dann schickt das Skript „Senden“ Daten per HTTP hinaus (nach einem weiteren Schritt).')
    expect(say('mail', 'agent:agExApply', 'en')).toBe('If the agent “Mail-Sortierer” writes into “Notizen”, the script “Senden” sends a mail (after one more step).')
    expect(say('mail', 'agent:agExApply', 'de')).toBe('Schreibt der Agent „Mail-Sortierer“ in „Notizen“, dann verschickt das Skript „Senden“ eine Mail (nach einem weiteren Schritt).')
    expect(say('outbox', 'agent:agExApply', 'en')).toBe('If the agent “Mail-Sortierer” changes a row in “Tickets”, the command “Outbox · reply” in “Tickets” hands the row to an Outbox route — sent by hand.')
    expect(say('outbox', 'agent:agExApply', 'de')).toBe('Ändert der Agent „Mail-Sortierer“ eine Zeile in „Tickets“, dann übergibt der Befehl „Ausgang · reply“ in „Tickets“ die Zeile einem Sendeweg — gesendet von Hand.')
    expect(say('git', 'agent:agExApply', 'en')).toBe('If the agent “Mail-Sortierer” writes a task into “Coding · Tessera”, the pipeline “Coding · Tessera” can push to Git.')
    expect(say('git', 'agent:agExApply', 'de')).toBe('Schreibt der Agent „Mail-Sortierer“ eine Aufgabe in „Coding · Tessera“, dann kann die Pipeline „Coding · Tessera“ nach Git pushen.')
    // every near miss: the path, never the fuse's claims
    expect(m.nearMisses.length).toBeGreaterThan(10)
    for (const n of m.nearMisses) {
      const en = text(fuseSay(n, m, input, ctxOf('en'), { near: true }))
      const de = text(fuseSay(n, m, input, ctxOf('de'), { near: true }))
      expect(en, en).not.toMatch(/without review|nobody in between|hidden instruction|\{|\}/)
      expect(de, de).not.toMatch(/ohne Prüfung|ohne einen Menschen|versteckter Anweisung|\{|\}/)
      expect(de, de).not.toMatch(PRONOUNS)
    }
    // an open fuse on the same kind of way out keeps its words (the threat and "without review")
    const open = m.fuses.find((f) => f.chain.exit?.type === 'git')!
    expect(text(fuseSay(open, m, input, ctxOf('en')))).toContain('with nobody in between')
  })

  test('start phrases after the first go on mid-sentence; a blocked module says why (EN · DE, no pronouns)', () => {
    const w = mock1()
    w.ws.databases.dbMails = { ...w.ws.databases.dbMails, commands: [{ id: 'cmdRun', kind: 'agent', label: 'Helfer starten', icon: null, config: { agentId: 'agInbox' } }] }
    const m = modelOf(w)
    const strand = (lang: 'en' | 'de') => text(plainOf(m, inputOf(w), ctxOf(lang)).find((s) => s.module === 'agent:agInbox')!.parts)
    expect(strand('en')).toBe('On the command “Helfer starten” in “Mails” (by hand) or on every new row in “Mails” (from outside), the agent “Inbox-Helfer” starts. The agent “Inbox-Helfer” may read everything, may write anywhere and can set “Weiterleiten” in “Mails”. On fuse F1.')
    expect(strand('de')).toBe('Beim Befehl „Helfer starten“ in „Mails“ (von Hand) oder bei jeder neuen Zeile in „Mails“ (von außen) startet der Agent „Inbox-Helfer“. Der Agent „Inbox-Helfer“ darf alles lesen, darf überall schreiben und kann „Weiterleiten“ in „Mails“ setzen. Auf Sicherung F1.')

    const b = blockedWorld()
    const bm = modelOf(b)
    expect(bm.modules.find((x) => x.key === 'agent:agInbox')?.blocked).toBe('route')
    expect(describeModule(bm, inputOf(b), 'agent:agInbox', ctxOf('en'))).toMatch(/^Agent “Inbox-Helfer” · needs a newer version of One — its AI model comes from a provider this version cannot use · on every new row/)
    expect(describeModule(bm, inputOf(b), 'agent:agInbox', ctxOf('de'))).toMatch(/^Agent „Inbox-Helfer“ · braucht eine neuere Version von One — das KI-Modell kommt von einem Anbieter, den diese Version nicht nutzen kann · bei jeder neuen Zeile/)
    for (const why of ['route', 'server', 'unreadable', 'notHere', 'confirm']) {
      expect(fuseMessages.en[`${P}.blocked.${why}`]).toBeTruthy()
      expect(fuseMessages.de[`${P}.blocked.${why}`], why).not.toMatch(PRONOUNS)
    }
  })

  test('an MCP or Git way out is a "Way out" fact on its plate, never what sets the path off', () => {
    const w = exits()
    const m = modelOf(w)
    const mcp = m.fuses.find((f) => f.chain.exit?.type === 'mcp' && !f.chain.steps.length) ?? m.fuses.find((f) => f.chain.exit?.type === 'mcp')!
    const git = m.fuses.find((f) => f.chain.exit?.type === 'git')!
    for (const f of [mcp, git]) {
      expect(f.facts.some((x) => x.kind === 'exit'), f.label).toBe(true)
      expect(f.facts.filter((x) => x.kind === 'trigger').map((x) => x.say.key)).not.toContain(`${P}.fact.trigger.tools`)
      expect(f.facts.filter((x) => x.kind === 'trigger').map((x) => x.say.key)).not.toContain(`${P}.fact.trigger.git`)
    }
    expect(fuseMessages.en[`${P}.fact.label.exit`]).toBe('Way out')
    expect(fuseMessages.de[`${P}.fact.label.exit`]).toBe('Weg nach außen')
  })

  test('glyph labels: a stub label and the labels never sit on another glyph or label (a dense rack column)', () => {
    // glyphs one rack row apart in one channel, some beside each other; the active glyph has its "↓ F1" stub label
    const gs = [
      { x: 400, y: 120, label: 22, stub: 44 },
      { x: 400, y: 120 + STATIC.row, label: 96, stub: null },
      { x: 448, y: 150, label: 22, stub: null },
      { x: 400, y: 120 + STATIC.row * 2, label: 60, stub: null },
      { x: 352, y: 150 + STATIC.row, label: 22, stub: null },
    ]
    const spots = glyphLabels(gs)
    type B = { x0: number; y0: number; x1: number; y1: number; what: string }
    const box = (cx: number, cy: number, w: number, h: number, what: string): B => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, what })
    const rings = gs.map((g, i) => box(g.x, g.y, 50, 30, `ring ${i}`))
    const labels: B[] = []
    spots.forEach((s, i) => {
      labels.push(box(gs[i].x + s.label.x, gs[i].y + s.label.y, gs[i].label, 14, `label ${i}`))
      if (s.stub) labels.push(box(gs[i].x + s.stub.x, gs[i].y + s.stub.y, gs[i].stub!, 14, `stub ${i}`))
    })
    expect(spots[0].stub).not.toBeNull()
    expect(spots.slice(1).every((s) => s.stub === null)).toBe(true)
    const hits = (a: B, b: B) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
    const clash: string[] = []
    for (let i = 0; i < labels.length; i++) {
      for (const r of rings) if (hits(labels[i], r)) clash.push(`${labels[i].what} × ${r.what}`)
      for (let j = i + 1; j < labels.length; j++) if (hits(labels[i], labels[j])) clash.push(`${labels[i].what} × ${labels[j].what}`)
    }
    expect(clash).toEqual([])
  })

  test('a gate the Approvals stop at closes the pipeline’s path; one they pass opens it (fix ui-words: what the background count reads)', () => {
    const at = (approvals: 'all' | 'review' | 'none') => modelOf(gateWorld(approvals))
    expect(at('all').fuses).toEqual([])
    expect(at('all').nearMisses.map((n) => `${n.chain.exit?.type}:${n.chain.gate}`)).toEqual(['git:afterApproval'])
    expect(at('review').fuses.map((f) => `${f.label}:${f.chain.exit?.type}:${f.chain.decider}`)).toEqual(['F1:git:autofill:dbCoding:pCodingPlan'])
    expect(at('none').fuses).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ browser helpers */

const module = (page: Page, key: string) => page.locator(`.pb-mod[data-key="${key}"]`)
const live = (page: Page) => page.getByTestId('pb-live')
const focused = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null
  return { tag: a?.tagName ?? null, jack: a?.getAttribute('data-jack') ?? null, lamp: a?.getAttribute('data-pb-lamp') ?? null, testid: a?.getAttribute('data-testid') ?? null, row: a?.getAttribute('data-row') ?? null }
})

async function openRack(page: Page, w: PbWorld = mock1(), hash = '#/patchbay', lang: 'en' | 'de' = 'en') {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
  await page.route(/\.example\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
  await seedPatchbay(page, w)
  if (lang === 'de') await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
  await page.evaluate((h) => (window.location.hash = h), hash)
  await expect(page.getByTestId('patchbay-page')).toBeVisible()
}

type Fuse = { key: string; label: string; exit: string | null }
const fusesOf = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __onePatchbay?: { model: () => { fuses: Array<{ key: string; label: string; chain: { exit?: { type: string } } }> } | null } }).__onePatchbay?.model()?.fuses ?? []).map((f) => ({ key: f.key, label: f.label, exit: f.chain.exit?.type ?? null })),
  ) as Promise<Fuse[]>

/** A file dropped on the Patchbay (the setup spec's way). */
async function dropProfile(page: Page) {
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], 'tracker-cnsx.integration.json', { type: 'application/json' }))
    const target = document.querySelector('[data-testid="pb-bench"]') ?? document.querySelector('[data-testid="patchbay-page"]')!
    for (const ev of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(ev, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, profileFile(trackerCnsx()))
  // the rack's band, the phone's card
  await expect(page.locator('[data-testid="pb-band"], [data-testid="pb-setup-card"]').first()).toBeVisible()
}

async function arrangeSetup(page: Page, lang: 'en' | 'de' = 'en') {
  await openRack(page, mock2(), '#/patchbay', lang)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
  await expect(page.locator('[data-testid="pb-rack"], [data-testid="pb-strands"]').first()).toBeVisible()
}

/* ------------------------------------------------------------------ the background count */

test.describe('ui-words · the background count and the setup reads', () => {
  test('this device’s Approvals changed in another tab: the count follows with the Patchbay closed', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.coding.approvals', 'all'))
    await openApp(page)
    await seedPatchbay(page, gateWorld())
    // the Patchbay never opened here: the sidebar LED from the idle build
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __onePatchbay?: { model: () => unknown } }).__onePatchbay?.model())).toBe(true)
    await expect.poll(async () => (await fusesOf(page)).filter((f) => f.exit === 'git').length).toBe(0)
    // "Use for new tasks" in another tab of this device: its storage event
    await page.evaluate(() => {
      localStorage.setItem('one.coding.approvals', 'review')
      window.dispatchEvent(new StorageEvent('storage', { key: 'one.coding.approvals', oldValue: 'all', newValue: 'review', storageArea: localStorage }))
    })
    await expect.poll(async () => (await fusesOf(page)).filter((f) => f.exit === 'git').length).toBe(1)
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    expect(await page.evaluate(() => location.hash)).not.toContain('patchbay')
  })

  test('the setup lamps: a row’s title and cell edits read nothing again; a database renamed does', async ({ page }) => {
    await arrangeSetup(page)
    // a row and a plain page beside the setup (Kontakte is no part of it)
    await wsEval(page, (s) => {
      s.createRow('dbKontakte', { title: 'Mara Lind' })
      s.createPage({ title: 'Launch plan' })
    })
    await dropProfile(page)
    await expect(page.getByTestId('pb-lamp').first()).toBeVisible()
    const stats = () => page.evaluate(() => (window as unknown as { __onePatchbaySetup: { stats: () => Promise<{ reads: number; rev: number }> } }).__onePatchbaySetup.stats())
    await page.waitForTimeout(600)
    const before = await stats()
    expect(before.reads).toBeGreaterThan(0)
    // typing in a row and a page: titles, a cell, content — nothing the lamps read
    for (let i = 0; i < 5; i++) {
      await wsEval(page, (s, n) => {
        const row = Object.values(s.pages as Record<string, AnyState>).find((p) => p.databaseId === 'dbKontakte')!
        s.updatePage(row.id, { title: `Mara Lind ${n}` })
        s.setRowProperty(row.id, 'pKontaktQuelle', `Mail ${n}`)
        const plan = Object.values(s.pages as Record<string, AnyState>).find((p) => p.title.startsWith('Launch plan'))!
        s.updatePage(plan.id, { title: `Launch plan ${n}` })
      }, i)
    }
    await page.waitForTimeout(600)
    expect((await stats()).reads).toBe(before.reads)
    // the database the recipe would use, renamed: the lamps read again
    await wsEval(page, (s) => s.updatePage('dbMails', { title: 'Mails (Nordlicht)' }))
    await expect.poll(async () => (await stats()).reads).toBeGreaterThan(before.reads)
  })
})

/* ------------------------------------------------------------------ the agent editor */

test.describe('ui-words · the agent editor holds unsaved changes', () => {
  test('the fuse line says "save or cancel first" and is no link while the draft changed; back as it was → the link again', async ({ page }) => {
    await openApp(page)
    await seedPatchbay(page, mock1())
    await expect(page.getByTestId('patchbay-nav-led')).toContainText('1')
    await page.evaluate(() => (window.location.hash = '#/agents/agInbox'))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.locator('.agx-editor')
    const hint = editor.locator('.pb-hint')
    await expect(hint.getByRole('link')).toHaveText('On fuse F1 — show in the Patchbay')
    const name = editor.locator('input[value="Inbox-Helfer"]')
    await name.fill('Inbox-Helfer 2')
    await expect(hint).toHaveAttribute('data-held', '')
    await expect(hint.getByRole('link')).toHaveCount(0)
    await expect(hint).toHaveText('On fuse F1 — save or cancel first to show it in the Patchbay')
    await expect(hint.locator('[aria-disabled="true"]')).toHaveCount(1)
    // nothing left the editor
    await hint.click()
    await expect(editor).toBeVisible()
    await expect(page).toHaveURL(/#\/agents\/agInbox/)
    // back as it was: the link again
    await editor.locator('input[value="Inbox-Helfer 2"]').fill('Inbox-Helfer')
    await expect(hint.getByRole('link')).toHaveText('On fuse F1 — show in the Patchbay')
    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await editor.locator('input[value="Inbox-Helfer"]').fill('Inbox-Helfer 3')
    await expect(hint).toHaveText('Liegt auf Sicherung F1 — erst speichern oder abbrechen, dann im Schaltplan zeigen')
  })
})

/* ------------------------------------------------------------------ the keyboard */

test.describe('ui-words · the keyboard', () => {
  test('the patch popover: a press on a field outside keeps the keyboard there; a patch’s Undo hands it to its source jack', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.patchbay.patch', '1'))
    await openRack(page, atRest())
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    const jack = (key: string) => page.locator(`.pb-jk[data-jack="${key}"]`)
    const centre = async (key: string) => {
      const b = (await jack(key).locator('.pb-jack').boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const pull = async () => {
      const a = await centre('server:srvTracker.write')
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move(a.x + 30, a.y + 12, { steps: 3 })
      const z = await centre('agent:agTessera.tools')
      await page.mouse.move(z.x, z.y, { steps: 8 })
      await page.mouse.up()
    }
    // a field outside the popover (the sidebar's search stands in for any text field the person presses)
    await page.evaluate(() => {
      const i = document.createElement('input')
      i.id = 'pb-probe-field'
      i.setAttribute('aria-label', 'Probe')
      i.style.cssText = 'position:fixed;left:8px;bottom:8px;width:160px;z-index:5'
      document.body.append(i)
    })
    await pull()
    const ask = page.getByTestId('pb-patch-ask')
    await expect(ask).toBeVisible()
    await page.locator('#pb-probe-field').click()
    await expect(ask).toHaveCount(0)
    await page.waitForTimeout(120)
    await expect(page.locator('#pb-probe-field')).toBeFocused()

    // Plug anyway → the toast's Undo: the keyboard back on the source jack (never the body)
    await pull()
    await ask.getByTestId('pb-patch-go').click()
    await expect.poll(async () => (await wsEval(page, (s) => (s.agents.agTessera as AnyState).mcpTools ?? null)) as unknown).toBeNull()
    const done = page.locator('.toast').filter({ hasText: 'Plugged: tracker → Tessera-Spiegel' }).last()
    await done.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await wsEval(page, (s) => (s.agents.agTessera as AnyState).mcpTools)) as unknown).toEqual({ tracker: ['query_issues', 'get_issue', 'whoami'] })
    await expect.poll(async () => (await focused(page)).tag).not.toBe('BODY')
    await expect.poll(async () => (await focused(page)).jack).toBe('server:srvTracker.write')
  })

  test('Esc: the selection goes first — the recorder deck stays; the next Esc closes the deck', async ({ page }) => {
    await openRack(page)
    await startRecorder(page)
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    await page.keyboard.press('Control+Alt+z')
    const deck = page.locator('section.deck')
    await expect(deck).toBeVisible()
    const inbox = module(page, 'agent:agInbox')
    await inbox.click()
    await expect(inbox).toHaveAttribute('data-selected', 'true')
    await inbox.focus()
    await page.keyboard.press('Escape')
    await expect(inbox).not.toHaveAttribute('data-selected', 'true')
    await expect(deck).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
  })

  test('a stale ?f= link: said, the h1 takes the keyboard; a path almost open now: its grey row is selected and focused', async ({ page }) => {
    await openRack(page, atRest())
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    const f1 = (await fusesOf(page)).find((f) => f.label === 'F1')!.key
    // a link to a fuse this device never had (a path key: 64 hex)
    await page.evaluate((k) => (window.location.hash = `#/patchbay?f=${k}`), 'ab'.repeat(32))
    await expect(live(page)).toContainText('This fuse is not open on this device — it was closed or changed, or it shows only in another member’s browser.', { timeout: 5000 })
    await expect(page.locator('.pb h1').first()).toBeFocused()
    // F1 closed by switching the agent to proposals (key 1's write): the link lands on its near miss
    await wsEval(page, (s) => s.upsertAgent({ ...(s.agents.agInbox as AnyState), write: 'stage' }))
    await expect.poll(async () => (await fusesOf(page)).length).toBe(0)
    await page.evaluate((k) => (window.location.hash = `#/patchbay?f=${k}`), f1)
    await expect(live(page)).toContainText('This path is no longer open: it is almost open now — one condition closes it.', { timeout: 5000 })
    await expect.poll(async () => (await focused(page)).row).toBe(`n:${f1}`)
  })
})

test.describe('ui-words · the setup band keys', () => {
  test('"Show the whole setup" hands the keyboard to the next lamp; ↵ on the fold unfolds and hands on to the line’s key', async ({ page }) => {
    await arrangeSetup(page)
    await dropProfile(page)
    // ↵ on the setup fold (what the profile does not touch)
    const fold = page.locator('[data-testid="pb-fold"][data-why="setup"]').first()
    await expect(fold).toBeVisible()
    await fold.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="pb-fold"][data-why="setup"]')).toHaveCount(0)
    await expect(page.getByTestId('pb-untouched-key')).toBeFocused()
    await expect(page.getByTestId('pb-untouched-key')).toHaveAttribute('aria-expanded', 'true')

    // a reload: the strip; "Show the whole setup" → the band, the keyboard on lamp 04's key
    await reloadApp(page)
    await page.evaluate(() => (window.location.hash = '#/patchbay'))
    const strip = page.getByTestId('pb-setup-strip')
    await expect(strip).toBeVisible()
    await strip.getByTestId('pb-strip-open').click()
    await expect(page.getByTestId('pb-band')).toBeVisible()
    await expect.poll(async () => (await focused(page)).lamp).toBe('4')
    expect((await focused(page)).tag).not.toBe('BODY')
  })

  test('↵ on lamp 04 over the Patchbay: MirrorSetup is the step — "Create database", its note; then the tab asks before it closes', async ({ page }) => {
    await arrangeSetup(page)
    await dropProfile(page)
    await expect(page.locator('[data-pb-lamp="4"][data-pb-profile="in-01"]').first()).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.locator('.agx-mir')
    await expect(dialog.getByTestId('agx-mir-step')).toHaveText('This step makes the database and its report page. The agent comes next (lamp 05) — it is saved only when you save it there.')
    await expect(dialog.getByRole('button', { name: 'Create database', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create database and agent' })).toHaveCount(0)
    const asks = () => page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(await asks()).toBe(false)
    await dialog.getByRole('button', { name: 'Create database', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(asks).toBe(true)
  })
})

/* ------------------------------------------------------------------ the pictures */

test.describe('ui-words · what the rack and the strands say', () => {
  test('a blocked module says why in its window (its sub line), the whole reason in the title; jack titles carry the direction', async ({ page }) => {
    await openRack(page, blockedWorld())
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    const why = module(page, 'agent:agInbox').getByTestId('pb-blocked-why')
    await expect(why).toHaveText('Needs a newer version of One — its AI model comes from a provider this version cannot use')
    await expect(module(page, 'agent:agInbox').locator('.pb-mod__k .led')).not.toHaveClass(/pb-led--ok/)
    // an in-jack's cables come "from"; an out-jack's go "→"
    const title = (key: string) => page.locator(`.pb-jk[data-jack="${key}"]`).first().getAttribute('title')
    expect(await title('outbound:webhook:chat.example:POST.out')).toMatch(/^Webhook · chat\.example · sent by An Team-Chat$/)
    expect(await title('automation:dbMails:autToChat.out')).toMatch(/→ Webhook · chat\.example$/)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(why).toHaveText('Braucht eine neuere Version von One — das KI-Modell kommt von einem Anbieter, den diese Version nicht nutzen kann')
    expect(await title('outbound:webhook:chat.example:POST.out')).toMatch(/· gesendet von An Team-Chat$/)
  })

  test('forced colours: the open plate’s lit lamps are Highlight', async ({ page }) => {
    await openRack(page)
    await expect(page.getByTestId('pb-fplate')).toHaveAttribute('data-state', 'open')
    await page.emulateMedia({ forcedColors: 'active' })
    const colours = await page.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.cssText = 'background: Highlight; forced-color-adjust: none'
      document.body.append(probe)
      const hl = getComputedStyle(probe).backgroundColor
      probe.remove()
      const lit = [...document.querySelectorAll<HTMLElement>('.pb-fplate[data-state="open"] .pb-tri__row[data-on] .pb-tri__lamp')].map((el) => getComputedStyle(el).backgroundColor)
      return { hl, lit }
    })
    expect(colours.lit.length).toBeGreaterThan(0)
    for (const c of colours.lit) expect(c).toBe(colours.hl)
  })

  test('reduced motion: a fuse brought into view jumps (never a smooth scroll)', async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = ((window as unknown as { __pbScrolls: string[] }).__pbScrolls = [])
      const orig = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
        if (arg && typeof arg === 'object') seen.push(arg.behavior ?? 'auto')
        return orig.call(this, arg as ScrollIntoViewOptions)
      }
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openRack(page)
    await expect(page.getByTestId('pb-wires')).toBeVisible()
    await page.evaluate(() => ((window as unknown as { __pbScrolls: string[] }).__pbScrolls.length = 0))
    await page.getByTestId('pb-ro-fuse-val').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pbScrolls: string[] }).__pbScrolls.length)).toBeGreaterThan(0)
    expect(await page.evaluate(() => (window as unknown as { __pbScrolls: string[] }).__pbScrolls)).not.toContain('smooth')
  })
})

test.describe('ui-words · the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a strand card: grey LED and the reason for a blocked module; the pipeline with its worker offline grey too', async ({ page }) => {
    await openRack(page, blockedWorld())
    await expect(page.getByTestId('pb-strands')).toBeVisible()
    const card = page.locator('.pb-strand[data-key="agent:agInbox"]')
    await expect(card.getByTestId('pb-blocked-why')).toHaveText('Needs a newer version of One — its AI model comes from a provider this version cannot use')
    await expect(card.locator('.pb-strand__h .led').first()).not.toHaveClass(/pb-led--ok/)
    await expect(page.locator('.pb-strand[data-key="pipeline:dbCoding"] .pb-strand__h .led').first()).not.toHaveClass(/pb-led--ok/)
  })

  test('touch: the readout’s fuse key, "Copy link" and "more" are at least 40 px', async ({ page }) => {
    await openRack(page, atRest())
    await expect(page.getByTestId('pb-strands')).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true)
    for (const sel of ['.pb-ro__fuse', '.pb-fkeys__copy', '.btn.pb-key--more']) {
      const el = page.locator(sel).first()
      await expect(el, sel).toBeVisible()
      const b = (await el.boundingBox())!
      expect(b.width, sel).toBeGreaterThanOrEqual(39.5)
      expect(b.height, sel).toBeGreaterThanOrEqual(39.5)
    }
  })

  test('the setup card counts in words — "4/7 done" · "4/7 erledigt"; its lamp links and Undo are 40 px to a finger', async ({ page }) => {
    await arrangeSetup(page)
    await dropProfile(page)
    await expect(page.getByTestId('pb-setup-count')).toHaveText('4/7 done')
    const links = page.locator('.pb-lamp__link')
    expect(await links.count()).toBeGreaterThan(0)
    for (const b of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))) {
      expect(b.w).toBeGreaterThanOrEqual(39.5)
      expect(b.h).toBeGreaterThanOrEqual(39.5)
    }
    // the band's Undo keeps its tab look; its hit area grows around it
    const undo = page.locator('.pb-band__undo').first()
    await expect(undo).toBeVisible()
    expect(await undo.evaluate((el) => parseFloat(getComputedStyle(el, '::after').height))).toBeGreaterThanOrEqual(39.5)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByTestId('pb-setup-count')).toHaveText('4/7 erledigt')
  })
})

