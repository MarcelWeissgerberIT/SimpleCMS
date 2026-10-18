/**
 * Work orders (Prüfaufträge) B14 — the feature's words, Node only (spec §0 header, §5 strings table, §8 B10): every
 * string of the work orders' packs (orders/*Messages.ts + the chain's page words in coding/messages.ts), the other
 * areas' strings that name the feature (Preflight, the flight recorder, the Regler, the Patchbay's planner), the help
 * article and the What's new entry.
 *
 *  - the names: DE "Prüfauftrag / Prüfaufträge", "Kette", "Planer" — EN "Work order / Work orders", "Chain", "Planner";
 *    never the other language's name;
 *  - German words this feature never uses (they mean something else in One): "Intake" (the Import stage), "Einwurf",
 *    "Plan bereit" (the coding Plan stage), "Prüfung" (Jev's Vorprüfung, the trust lamp PRÜFUNG), "danach" (the pipeline
 *    field Then is "Danach" — the chain says "nächster Schritt"), "Aufgabe" for the request (a task is an Aufgabe, the
 *    request an Auftrag), "Freigabe" for anything but the coding approvals (a Patchbay sign-off is "Weg zulassen"); KI,
 *    never AI;
 *  - the strings table of spec §5 as built (the statuses, chips, commands, keys, lines);
 *  - the same keys and placeholders in both languages, no key in two files;
 *  - no service named: the context server is the person's own, only ever by their name for it ({server}); no host;
 *  - the help article (EN + DE twins) and the What's new entry (with its Try key and the Patchbay's chain edges line).
 * The Patchbay's generic fuse sentences ("… ohne Prüfung …" = without review, its proposals' word) belong to the Patchbay
 * and are checked by patchbay-names.spec — only its planner's own strings are checked here.
 * Reads files and message objects only — no browser, no request.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { messages as entry } from '../../src/app/features/coding/orders/entryMessages'
import { messages as planner } from '../../src/app/features/coding/orders/plannerMessages'
import { messages as chain } from '../../src/app/features/coding/orders/chainMessages'
import { messages as plate } from '../../src/app/features/coding/orders/plateMessages'
import { messages as preflightCards } from '../../src/app/features/coding/orders/preflightMessages'
import { messages as auto } from '../../src/app/features/coding/orders/autoMessages'
import { messages as team } from '../../src/app/features/coding/orders/teamMessages'
import { messages as coding } from '../../src/app/features/coding/messages'
import { messages as preflight } from '../../src/app/features/preflight/messages'
import { messages as recorder } from '../../src/app/features/recorder/messages'
import { messages as governor } from '../../src/app/features/governor/messages'
import { messages as pbFuses } from '../../src/app/features/patchbay/messages-fuses'
import { messages as pbPage } from '../../src/app/features/patchbay/messages-page'
import { messages as pbSetup } from '../../src/app/features/patchbay/messages-setup'
import { messages as pbWires } from '../../src/app/features/patchbay/messages-wires'
import { messages as help } from '../../src/app/help/messages'
import { CHANGELOG_TRIES } from '../../src/app/help/changelog/entries'

type Pack = Record<string, string>
type Lang = 'en' | 'de'
const O = 'features.coding.order'

/** The work orders' own packs, as features/messages.ts merges them. */
const FILES = { entry, planner, chain, plate, preflightCards, auto, team }
const own = (lang: Lang): Pack => Object.assign({}, ...Object.values(FILES).map((m) => m[lang])) as Pack

/** The chain's page words and the roles' names, kept in coding/messages.ts (Node-pure for the step page). */
const pick = (pack: { en: Pack; de: Pack }, keep: (k: string, de: string) => boolean): { en: Pack; de: Pack } => {
  const en: Pack = {}
  const de: Pack = {}
  for (const k of Object.keys(pack.en)) if (keep(k, pack.de[k] ?? '')) {
    en[k] = pack.en[k]!
    de[k] = pack.de[k]!
  }
  return { en, de }
}
const codingOrder = pick(coding as { en: Pack; de: Pack }, (k) => k.startsWith(`${O}.`) || k === 'features.coding.prop.order' || k === 'features.coding.prop.step')

/** Other areas' strings that name the feature. */
const PB_KEYS = /planner|chain|\.exec|orders|firstChain|ordersDb|lamp\.context|autoOff|readTools|reach\.linked|private\.linked|readsOrder|role\.next|lamp\.coding\.off|lamp\.worker\.old|wire\.next/
const OUTSIDE = [
  pick(preflight as { en: Pack; de: Pack }, (k) => /\.orders\.|\.(ready|next|halted|interrupted|chainConfirm|request)$/.test(k)),
  pick(recorder as { en: Pack; de: Pack }, (k) => /lane\.order|eject\.order/.test(k)),
  pick(governor as { en: Pack; de: Pack }, (k) => k.endsWith('cons.order')),
  pick(coding as { en: Pack; de: Pack }, (k) => k === 'features.coding.notify.hint'),
  ...[pbFuses, pbPage, pbSetup, pbWires].map((m) => pick(m as { en: Pack; de: Pack }, (k, de) => PB_KEYS.test(k) || /Kette|Prüfauftr|Planer/.test(de))),
]
const outside = (lang: Lang): Pack => Object.assign({}, ...OUTSIDE.map((m) => m[lang])) as Pack
const all = (lang: Lang): Pack => ({ ...own(lang), ...codingOrder[lang], ...outside(lang) })

/** German words the feature never uses (spec header). `Vorprüfung` is Jev's own word and may be named (to tell them apart). */
const BANNED_DE = /\bIntake\b|Einwurf|Plan bereit|(?<![Vv]or)Prüfung\b|\bdanach\b/i
/** Other providers and services — the context server is the person's own; One names none. */
const OTHER_NAMES = /OpenRouter|OpenAI|ChatGPT|\bGPT\b|Gemini|Mistral|Llama|\bJev\b|\batlas\b|linear\.app|Wissensbasis|\bkb_[a-z]/i
/** The help may name Jev (its pre-check is a feature of One, with its own article) — never a service or another provider. */
const ARTICLE_NAMES = /OpenRouter|OpenAI|ChatGPT|\bGPT\b|Gemini|Mistral|Llama|\batlas\b|linear\.app|Wissensbasis|\bkb_[a-z]/i
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
const read = (p: string) => readFileSync(p, 'utf8')

test.describe('Work orders words (spec §0, §5)', () => {
  test('every string in both languages: the same keys, the same placeholders, no key in two files', () => {
    for (const [name, m] of Object.entries(FILES)) {
      expect(Object.keys(m.de).sort(), name).toEqual(Object.keys(m.en).sort())
      for (const k of Object.keys(m.en)) {
        expect(k.startsWith(`${O}.`) || k.startsWith('features.cmd.'), `${name}: ${k}`).toBe(true)
        expect(vars(m.de[k]!), `${name}: ${k} placeholders`).toEqual(vars(m.en[k]!))
      }
    }
    const seen = new Map<string, string>()
    for (const [name, m] of Object.entries({ ...FILES, coding: codingOrder })) for (const k of Object.keys(m.en)) {
      expect(seen.get(k), `${k} in ${name} and ${seen.get(k)}`).toBeUndefined()
      seen.set(k, name)
    }
    expect(seen.size).toBeGreaterThan(450)
    // features/messages.ts merges every pack (a pack left out would show its keys as raw ids)
    const merged = read('src/app/features/messages.ts')
    for (const f of ['entryMessages', 'plannerMessages', 'chainMessages', 'plateMessages', 'preflightMessages', 'autoMessages', 'teamMessages']) expect(merged, f).toContain(`./coding/orders/${f}'`)
  })

  test('the names: Prüfauftrag · Kette · Planer — Work order · Chain · Planner, never the other language’s', () => {
    const en = all('en')
    const de = all('de')
    expect([en[`${O}.db`], en[`${O}.one`], de[`${O}.db`], de[`${O}.one`]]).toEqual(['Work orders', 'Work order', 'Prüfaufträge', 'Prüfauftrag'])
    expect([en[`${O}.plan.title`], de[`${O}.plan.title`]]).toEqual(['Chain', 'Kette'])
    expect([en[`${O}.plate.planner`], de[`${O}.plate.planner`], en[`${O}.lamp.planner`], de[`${O}.lamp.planner`]]).toEqual(['PLANNER', 'PLANER', 'Planner', 'Planer'])
    expect([en[`${O}.plate.title`], de[`${O}.plate.title`]]).toEqual(['WORK ORDER', 'PRÜFAUFTRAG'])
    expect([en['features.coding.prop.order'], en['features.coding.prop.step'], de['features.coding.prop.order'], de['features.coding.prop.step']]).toEqual(['Work order', 'Step', 'Prüfauftrag', 'Schritt'])
    expect([en['features.patchbay.kind.planner'], de['features.patchbay.kind.planner']]).toEqual(['Planner', 'Planer'])
    expect([en['features.preflight.lamp.orders.legend'], de['features.preflight.lamp.orders.legend']]).toEqual(['Work orders', 'Prüfaufträge'])
    expect([en['features.recorder.lane.order'], de['features.recorder.lane.order']]).toEqual(['Work order', 'Prüfauftrag'])
    expect([en['features.governor.cons.order'], de['features.governor.cons.order']]).toEqual(['Work orders · Planner', 'Prüfaufträge · Planer'])
    for (const [k, v] of Object.entries(en)) expect(v, `en ${k}`).not.toMatch(/Prüfauftr|\bKette\b|\bPlaner\b|Grundlage/)
    // English keeps the German names out — except the ⌘K keywords that let a German speaker find the command
    for (const [k, v] of Object.entries(de)) if (!k.endsWith('cmd.keywords')) expect(v, `de ${k}`).not.toMatch(/\bWork orders?\b|\bChain\b|\bPlanner\b/)
  })

  test('German: no word that means something else in One, Freigabe only for approvals, the request is an Auftrag, KI never AI', () => {
    const en = all('en')
    const de = all('de')
    for (const [k, v] of Object.entries(de)) {
      expect(v, k).toBeTruthy()
      expect(v, k).not.toMatch(BANNED_DE)
      expect(v, k).not.toMatch(/\bAI\b/)
      // "Freigabe" belongs to the coding approvals (Plan freigeben, Freigaben); a Patchbay sign-off is "Weg zulassen"
      if (/Freigab|freigeb/.test(v)) expect(en[k], `${k}: "Freigabe" outside approvals`).toMatch(/[Aa]pprov/)
      // the request is an "Auftrag", never an "Aufgabe" (a task is): where English says request, German has no Aufgabe
      if (/\brequest/i.test(en[k] ?? '') && !/\btasks?\b/i.test(en[k] ?? '')) expect(v, `${k}: the request is an Auftrag`).not.toMatch(/Aufgabe/)
    }
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/\bIntake\b/i)
    // the sign-off is the Patchbay's own
    expect([en[`${O}.mode.allow`], de[`${O}.mode.allow`]]).toEqual(['Allow this path', 'Weg zulassen'])
    expect([en[`${O}.plan.next`], de[`${O}.plan.next`]]).toEqual(['next step: {n} {kind} ‹{title}›', 'nächster Schritt: {n} {kind} ‹{title}›'])
    expect(de['features.patchbay.jack.role.next']).toBe('nächster Schritt')
  })

  test('the strings table of spec §5, as built', () => {
    const en = all('en')
    const de = all('de')
    const table: Array<[string, string, string]> = [
      ['status.draft', 'Draft', 'Entwurf'],
      ['status.plan', 'Plan', 'Planen'],
      ['status.ready', 'Chain ready', 'Kette bereit'],
      ['status.running', 'Running', 'Läuft'],
      ['status.halted', 'Halted', 'Angehalten'],
      ['status.done', 'Done', 'Fertig'],
      ['chip.planning', 'planning', 'plant'],
      ['chip.worker', 'waiting for the worker', 'wartet auf Worker'],
      ['chip.regler', 'held by the Regler', 'Regler hält'],
      ['chip.question', 'needs input', 'Rückfrage'],
      ['chip.expired', 'expired — ↵ again', 'abgelaufen — ↵ erneut'],
      ['cmd.send', 'Have it checked', 'Prüfen lassen'],
      ['cmd.sendNote', 'Have it checked …', 'Prüfen lassen …'],
      ['cmd.plan', 'Plan', 'Planen'],
      ['already', 'Already in {id} ({status})', 'Schon in {id} ({status})'],
      ['lamp.context.none', 'without server', 'ohne Server'],
      ['lamp.context.tools', '{server} · read only · {n} tools', '{server} · nur Lesen · {n} Werkzeuge'],
      ['planner.line.read.other', 'Request read · {chars} characters · {n} linked pages', 'Auftrag gelesen · {chars} Zeichen · {n} verlinkte Seiten'],
      ['planner.line.call', '{server} · {tool}({args}) → {size}', '{server} · {tool}({args}) → {size}'],
      ['planner.line.nothing', 'Server returned nothing', 'Server lieferte nichts'],
      ['planner.line.writing', 'Writing the chain …', 'Kette wird geschrieben …'],
      ['plan.understood', 'Understood:', 'Verstanden:'],
      ['plan.context', 'Context · planner’s summary', 'Kontext · Zusammenfassung des Planers'],
      ['plan.goesWith', 'goes along in step {n}', 'geht in Schritt {n} mit'],
      ['plan.stops', 'stops at: {gates}', 'stoppt bei: {gates}'],
      ['plan.branchFrom', 'Branch: from step {n} (shared)', 'Branch: von Schritt {n} (gemeinsam)'],
      ['plan.open', 'Open:', 'Offen:'],
      ['plan.cost.notCapped', 'the Regler does not limit this', 'der Regler begrenzt das nicht'],
      ['budget.label', 'Budget per chain', 'Budget je Kette'],
      ['budget.note', 'halts before the next step, never mid-step', 'hält vor dem nächsten Schritt, nicht mittendrin'],
      ['key.start', 'Start chain', 'Kette starten'],
      ['key.startForeign', 'Start chain · with server content', 'Kette starten · mit Server-Inhalt'],
      ['key.replan', 'Plan again', 'Neu planen'],
      ['key.noServer', 'Plan again without server', 'Ohne Server neu planen'],
      ['key.edit', 'Edit step', 'Schritt bearbeiten'],
      ['key.remove', 'Remove step', 'Schritt entfernen'],
      ['key.discard', 'Discard', 'Verwerfen'],
      ['chain.countdown', 'Step {n} starts in {s} s', 'Schritt {n} startet in {s} s'],
      ['chain.waitsStep', 'Waits for step {n}', 'Wartet auf Schritt {n}'],
      ['chain.basis', 'From step {n} ({kind}):', 'Aus Schritt {n} ({kind}):'],
      ['chain.skipped', 'Step {n} skipped — no basis', 'Schritt {n} übersprungen — keine Grundlage'],
      ['card.checkpoint', 'Analysis done → {n} {kind} ‹{title}›', 'Analyse fertig → {n} {kind} ‹{title}›'],
      ['key.next', 'Go on', 'Weiter'],
      ['key.adjust', 'Adjust', 'Anpassen'],
      ['key.replanHere', 'Plan again from here', 'Ab hier neu planen'],
      ['key.haltAfter', 'Halt after this step', 'Nach diesem Schritt anhalten'],
      ['key.stopNow', 'Stop now', 'Sofort stoppen'],
      ['key.resume', 'Resume', 'Fortsetzen'],
      ['key.haltAll', 'Halt all chains', 'Alle Ketten anhalten'],
      ['why.codingOff', 'Coding is off on this device', 'Coding ist auf diesem Gerät aus'],
      ['why.elsewhere', 'The worker is attached to another device — plan / start there', 'Der Worker hängt an einem anderen Gerät — dort planen / starten'],
      ['why.later', 'Plans when the worker is back (until {time})', 'Plant, sobald der Worker zurück ist (bis {time})'],
      ['why.laterAuto', 'Plans and starts without confirming once the worker is back (until {time})', 'Plant und startet ohne Bestätigung, sobald der Worker zurück ist (bis {time})'],
      ['planner.why.empty', 'The request is empty — write what should be checked', 'Der Auftrag ist leer — schreib, was geprüft werden soll'],
      ['why.doneBy', 'Step {n} was set to done by {writer} — go on?', 'Schritt {n} wurde von {writer} auf Fertig gesetzt — weiter?'],
      ['why.drift', 'Pipeline changed since you confirmed: {what}', 'Pipeline geändert seit Bestätigung: {what}'],
      ['halt.outOfOrder', 'step {n} ran out of order', 'Schritt {n} lief außer der Reihe'],
      ['halt.ejected', 'step {n} ejected', 'Schritt {n} ausgeworfen'],
      ['auto.fallback', 'Not started automatically: {reasons}', 'Nicht automatisch gestartet: {reasons}'],
      ['auto.lapsed', 'Settings changed since you switched it on — switch it on again', 'Einstellungen geändert seit dem Einschalten — erneut einschalten'],
      ['mode.confirm', 'Confirm the chain', 'Kette bestätigen'],
      ['mode.auto', 'Start without confirming', 'Ohne Bestätigung starten'],
      ['mode.fuse', 'Would trip a fuse: {path}', 'Würde eine Sicherung auslösen: {path}'],
      ['mode.needsBudget', 'Set a budget per chain first', 'Erst ein Budget je Kette setzen'],
      ['settings.server', 'Context · MCP server (optional)', 'Kontext · MCP-Server (optional)'],
      ['settings.checkpoint', 'Stop after the analysis', 'Nach der Analyse anhalten'],
      ['settings.rowWins', 'The row’s fields come first', 'Felder der Zeile gehen vor'],
      ['preflight.ready', 'Chain ready', 'Kette bereit'],
      ['preflight.next', 'Go on with step {n}?', 'Weiter mit Schritt {n}?'],
      ['preflight.chainConfirm', 'Confirm chain', 'Kette bestätigen'],
      ['preflight.halted', 'Chain halted', 'Kette angehalten'],
      ['preflight.request', 'Requested on another device', 'Auf anderem Gerät angefordert'],
      ['preflight.interrupted', 'Interrupted', 'Unterbrochen'],
      ['plan.foreign', 'OUTSIDE', 'FREMD'],
    ]
    for (const [k, e, d] of table) expect([en[`${O}.${k}`], de[`${O}.${k}`]], k).toEqual([e, d])
    expect(de[`${O}.halt.budget`]).toMatch(/^Budget der Kette erreicht/)
    expect(de[`${O}.plan.cost.kind`]).toBe('Ø {usd} je {kind}-Aufgabe')
  })

  test('no service, no host: the server only ever by the person’s name for it ({server}); Claude only as Claude Code / Claude’s route', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const [k, v] of Object.entries(all(lang))) {
        expect(v, `${lang} ${k}`).not.toMatch(OTHER_NAMES)
        expect(v, `${lang} ${k}: a host`).not.toMatch(/\b[a-z0-9-]+\.(com|io|ai|org|net|dev|app|example|test)\b/i)
        if (/Claude/.test(v)) expect(v, `${lang} ${k}`).toMatch(/Claude Code|Claude-Code|Claude einrichten|Set up Claude|Claude’s route|Route über Claude/)
      }
    }
  })
})

test.describe('the help article and What’s new (spec §5)', () => {
  const article = { en: 'src/app/help/articles/en/workorders.md', de: 'src/app/help/articles/de/workorders.md' }
  const newsDir = { en: 'src/app/help/changelog/en', de: 'src/app/help/changelog/de' }
  const newsFile = (lang: Lang) => readdirSync(newsDir[lang]).find((f) => f.endsWith('-work-orders.md'))

  test('the article "workorders": EN + DE twins, the names, how it differs from Jev’s pre-check, the pick-up rule, no service', () => {
    for (const lang of ['en', 'de'] as const) expect(existsSync(article[lang]), article[lang]).toBe(true)
    const en = read(article.en)
    const de = read(article.de)
    for (const [lang, text] of Object.entries({ en, de })) {
      expect(text, lang).toMatch(/^id: workorders$/m)
      expect(text, lang).toMatch(/^section: ai$/m)
      for (const id of ['coding-pipeline', 'pipelines', 'patchbay', 'preflight', 'ai-jev', 'mcp-servers', 'governor', 'sync']) expect(text, `${lang}: related ${id}`).toMatch(new RegExp(`^related: .*\\b${id}\\b`, 'm'))
      // article ids in links (help:ai-jev) are no names; hosts only *.example
      const body = text.replace(/\(help:[a-z-]+\)|^(help|related|keywords): .*$/gm, '')
      expect(body, lang).not.toMatch(ARTICLE_NAMES)
      for (const m of body.matchAll(/\b([a-z0-9-]+\.)+(com|io|ai|org|net|dev|app)\b/g)) expect(m[0], lang).toMatch(/\.example$/)
    }
    expect(de).toMatch(/^title: Prüfaufträge/m)
    expect(en).toMatch(/^title: Work orders/m)
    for (const w of ['Prüfauftrag', 'Kette', 'Planer', 'Kette starten', 'Nach der Analyse anhalten', 'Ohne Bestätigung starten', 'Budget je Kette', 'Weg zulassen', 'Vorprüfung', 'nächster Schritt', 'Grundlage']) expect(de, w).toContain(w)
    for (const w of ['Work order', 'Chain', 'Planner', 'Start chain', 'Stop after the analysis', 'Start without confirming', 'Budget per chain', 'Allow this path', 'pre-check', 'next step', 'basis']) expect(en, w).toContain(w)
    // the German words this feature never uses
    const deBody = de.replace(/^keywords: .*$/m, '')
    expect(deBody).not.toMatch(BANNED_DE)
    expect(deBody).not.toMatch(/\bAI\b/)
    expect(deBody).not.toMatch(/freigegeben\b|Weg freigeben/)
    for (const w of ['Work order', 'Chain ready']) expect(deBody, w).not.toContain(w)
    expect(en.replace(/^keywords: .*$/m, '')).not.toMatch(/Prüfauftr|\bKette\b|\bPlaner\b/)
    // the pick-up hardening (B2) and VON HAND are named
    expect(de).toMatch(/Ordner-|GitHub-Sync/)
    expect(en).toMatch(/folder \/ GitHub sync/i)
    expect(de).toContain('VON HAND')
    expect(en).toContain('BY HAND')
    // the HelpLinks lead here: the plate, its settings, the Patchbay's work orders band
    for (const f of ['src/app/features/coding/orders/OrderPlate.tsx', 'src/app/features/coding/orders/OrderSettings.tsx', 'src/app/features/patchbay/ui/OrdersBand.tsx']) expect(read(f), f).toMatch(/<HelpLink id="workorders"/)
    // the coding articles point to it
    for (const lang of ['en', 'de'] as const) for (const id of ['coding-pipeline', 'pipelines', 'sync']) expect(read(`src/app/help/articles/${lang}/${id}.md`), `${lang}/${id}`).toContain('help:workorders')
  })

  test('What’s new: EN + DE twins with the plate’s picture, the Try key, the Patchbay’s chain edges', () => {
    const en = newsFile('en')
    const de = newsFile('de')
    expect(en, 'an English entry *-work-orders.md').toBeTruthy()
    expect(de).toBe(en)
    const enText = read(`${newsDir.en}/${en}`)
    const deText = read(`${newsDir.de}/${de}`)
    for (const [lang, text] of Object.entries({ en: enText, de: deText })) {
      expect(text, lang).toMatch(/^image: assets\/shots\/changelog\/work-orders\.webp$/m)
      expect(text, lang).toMatch(/^try: workorders$/m)
      expect(text, lang).toMatch(/^help: .*\bworkorders\b/m)
      expect(text.replace(/\(help:[a-z-]+\)|^(help|related): .*$/gm, ''), lang).not.toMatch(ARTICLE_NAMES)
    }
    expect(existsSync('public/assets/shots/changelog/work-orders.webp')).toBe(true)
    expect(deText).toMatch(/^title: Prüfaufträge: von der Bitte zur Kette$/m)
    expect(deText).toContain('Weitergaben sind jetzt im Schaltplan sichtbar — neue Sicherungen möglich')
    expect(enText).toMatch(/hand-ons .*Patchbay/i)
    const deBody = deText.replace(/^keywords: .*$/m, '')
    expect(deBody).not.toMatch(BANNED_DE)
    expect(deBody).not.toMatch(/\bAI\b/)
    // the Try key: in the allow-list, worded in both languages
    expect(CHANGELOG_TRIES as readonly string[]).toContain('workorders')
    expect([help.en['help.news.try.workorders'], help.de['help.news.try.workorders']]).toEqual(['Open a sample work order', 'Beispiel-Prüfauftrag öffnen'])
  })
})
