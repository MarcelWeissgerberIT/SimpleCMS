/**
 * The Patchbay's words (plan §1.1, §3.11, §5.2 lens 6 — B18), Node only: every string of the area (messages.ts and its
 * per-batch files), the other areas' strings that lead to it, the help article and the What's new entry.
 *
 *  - German: no "Vertrauen" / "vertrauen" (Vertrauen pro Feld owns it), "Prüfschritt", "abnehmen" / "Abnahme",
 *    "fremd" / "Fremd", "Trigger" (One's DE word is "Auslöser"); "Ausgang" only for the Outbox module
 *    (`module.outbox.*` — the Outbox's product name); "Freigabe" only where approvals are meant, never for an allowed
 *    path; "KI", never "AI";
 *  - the sign-off words are the plan's: "Allow this path" / "Weg zulassen", "Allowed" / "Zugelassen", "Withdraw" /
 *    "Zulassung zurückziehen", "No longer allowed" / "Zulassung erloschen" — and no "trust" anywhere in English (a reader
 *    grepping "trust" lands only in Vertrauen pro Feld);
 *  - the plain words: "from outside" / "von außen", "Row trigger" / "Zeilen-Auslöser", "Switch to proposals" / "Auf
 *    Vorschläge stellen", outbound modules by exit type, setup "Set up · {n} lamps" / "Einrichten · {n} Lampen";
 *  - names: "Claude" only where the route is Claude (the KEY lamp, the TEST lamp's request, the bridge to Claude Desktop /
 *    Code) — never another provider's name; no service named (the source guard's words);
 *  - the same keys in both languages; every `.one` has its plural; placeholders the same on both sides.
 * Reads files and message objects only — no browser, no request.
 */
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { messages as page } from '../../src/app/features/patchbay/messages-page'
import { messages as fuses } from '../../src/app/features/patchbay/messages-fuses'
import { messages as setup } from '../../src/app/features/patchbay/messages-setup'
import { messages as live } from '../../src/app/features/patchbay/messages-live'
import { messages as patch } from '../../src/app/features/patchbay/messages-patch'
import { messages as hint } from '../../src/app/features/patchbay/messages-hint'
import { messages as wires } from '../../src/app/features/patchbay/messages-wires'
import { messages as plate } from '../../src/app/features/patchbay/messages-plate'
import { messages as help } from '../../src/app/help/messages'
import { workspaceMessages } from '../../src/app/shell/workspace/messages'

const P = 'features.patchbay'
const FILES = { page, fuses, setup, live, patch, hint, wires, plate }
/** The area's strings as messages.ts merges them (messages.ts itself loads the app's i18n module — browser only). */
const patchbay = {
  en: Object.assign({}, ...Object.values(FILES).map((m) => m.en)) as Record<string, string>,
  de: Object.assign({}, ...Object.values(FILES).map((m) => m.de)) as Record<string, string>,
}

/** The German words §1.1 bans in the Patchbay. */
const BANNED_DE = /[Vv]ertrauen|Prüfschritt|abnehm|Abnahme|[Ff]remd|Trigger/
/** Other providers and services — the Patchbay names none (ai-names.spec + the integrations source guard cover the rest). */
const OTHER_NAMES = /OpenRouter|OpenAI|ChatGPT|\bGPT\b|Gemini|Mistral|Llama|\bJev\b|\batlas\b|linear\.app/i
/** Where "Claude" may stand: the lamps that need Claude's route (key, test) and the bridge to Claude Desktop / Code. */
const CLAUDE_KEYS = /^features\.patchbay\.(name\.bridge|plain\.bridge\.|setup\.key\.key$|lamp\.key\.|lamp\.test\.)/

/** The placeholders of a string, each once (German repeats a name where English says "it" — plan §6 U31). */
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()

/** The German strings that lead to the Patchbay from other areas. */
const OUTSIDE_DE: Record<string, string> = {
  'shell.ws.auto.asPatchbay': workspaceMessages.de['shell.ws.auto.asPatchbay'],
  'shell.ws.auto.showInPatchbay': workspaceMessages.de['shell.ws.auto.showInPatchbay'],
  'help.news.try.patchbay': help.de['help.news.try.patchbay'],
}

test.describe('Patchbay words (plan §1.1)', () => {
  test('fix (safety-data): a member is said only where "dir" / "einem Mitglied" fit — after "von" in German, never as the subject', () => {
    // plateWords fills {member} / {creator} with the dative words ("dir", "einem Mitglied") when the member is the viewer
    // or unknown — a nominative slot would read "dir hat …" / "einem Mitglied muss …"
    let n = 0
    for (const [k, v] of Object.entries(patchbay.de))
      for (const name of ['member', 'creator'])
        if (v.includes(`{${name}}`)) {
          n++
          expect(v.split(`{${name}}`).slice(0, -1).every((before) => /von $/.test(before)), `${k}: ${v}`).toBe(true)
        }
    expect(n).toBeGreaterThanOrEqual(5)
    expect(patchbay.de[`${P}.plate.you`]).toBe('dir')
    expect(patchbay.de[`${P}.plate.someone`]).toBe('einem Mitglied')
  })

  test('every string in both languages: the same keys, the same placeholders, a plural beside every .one', () => {
    const en = patchbay.en
    const de = patchbay.de
    expect(Object.keys(en).length).toBeGreaterThan(700)
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(en)) {
      expect(k.startsWith(`${P}.`), k).toBe(true)
      expect(vars(de[k]), `${k}: placeholders`).toEqual(vars(en[k]))
      if (k.endsWith('.one')) expect(en[k.slice(0, -4)], `${k}: its plural`).toBeDefined()
    }
    // each batch file is whole on its own (the merge hides nothing)
    for (const [name, m] of Object.entries(FILES)) expect(Object.keys(m.de).sort(), name).toEqual(Object.keys(m.en).sort())
    // no key in two files (a merge would hide one of them)
    const seen = new Map<string, string>()
    for (const [name, m] of Object.entries(FILES)) for (const k of Object.keys(m.en)) {
      expect(seen.get(k), `${k} in ${name} and ${seen.get(k)}`).toBeUndefined()
      seen.set(k, name)
    }
    // messages.ts merges exactly these files
    const merged = readFileSync('src/app/features/patchbay/messages.ts', 'utf8')
    expect(/mergeMessages\(([^)]*)\)/.exec(merged)?.[1]?.split(',').map((x) => x.trim())).toEqual(Object.keys(FILES))
  })

  test('German: no banned word, "Ausgang" only for the Outbox module, "Freigabe" only for approvals, KI never AI', () => {
    const all = { ...patchbay.de, ...OUTSIDE_DE }
    for (const [k, v] of Object.entries(all)) {
      expect(v, k).toBeTruthy()
      expect(v, k).not.toMatch(BANNED_DE)
      if (!k.startsWith(`${P}.module.outbox.`)) expect(v, k).not.toMatch(/Ausgang/)
      // an allowed path is "zugelassen", never "freigegeben": "Freigabe" belongs to the coding approvals alone
      if (/Freigab|freigeb/.test(v)) expect(k, `${k}: "Freigabe" outside approvals`).toMatch(/[Aa]pprov/)
      expect(v, k).not.toMatch(/\bAI\b/)
    }
    // the Outbox module is the Outbox's own name
    expect(patchbay.de[`${P}.module.outbox.kind`]).toBe('Ausgang')
    expect(patchbay.de[`${P}.module.outbox.name`]).toMatch(/^Ausgang · /)
  })

  test('the sign-off words: allow · allowed · withdraw · lapsed — and no "trust" in English', () => {
    const { en, de } = patchbay
    expect(en[`${P}.key.allow`]).toBe('Allow this path')
    expect(de[`${P}.key.allow`]).toBe('Weg zulassen')
    expect(en[`${P}.allowedStamp`]).toBe('Allowed')
    expect(de[`${P}.allowedStamp`]).toBe('Zugelassen')
    expect(en[`${P}.allowed`]).toMatch(/^Allowed by \{name\} · \{date\}$/)
    expect(de[`${P}.allowed`]).toMatch(/^Zugelassen von \{name\} · \{date\}$/)
    expect(en[`${P}.key.withdraw`]).toBe('Withdraw')
    expect(de[`${P}.key.withdraw`]).toBe('Zulassung zurückziehen')
    expect(en[`${P}.lapsed`]).toMatch(/^No longer allowed: /)
    expect(de[`${P}.lapsed`]).toMatch(/^Zulassung erloschen: /)
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/\btrust/i)
    for (const [k, v] of Object.entries(de)) expect(v, k).not.toMatch(/abnehm|Abnahme/)
  })

  test('the plain words of §1.1 / §3.11', () => {
    const { en, de } = patchbay
    expect([en[`${P}.title`], de[`${P}.title`]]).toEqual(['Patchbay', 'Schaltplan'])
    expect([en[`${P}.sub`], de[`${P}.sub`]]).toEqual(['What runs by itself', 'Was von allein läuft'])
    expect([en[`${P}.tag.outside`], de[`${P}.tag.outside`]]).toEqual(['from outside', 'von außen'])
    expect([en[`${P}.fuse.outside`], de[`${P}.fuse.outside`]]).toEqual(['Content from outside', 'Inhalt von außen'])
    expect([en[`${P}.tag.outbound`], de[`${P}.tag.outbound`]]).toEqual(['outbound', 'nach außen'])
    expect([en[`${P}.kind.rowTrigger`], de[`${P}.kind.rowTrigger`]]).toEqual(['Row trigger', 'Zeilen-Auslöser'])
    expect([en[`${P}.key.proposals`], de[`${P}.key.proposals`]]).toEqual(['Switch to proposals', 'Auf Vorschläge stellen'])
    expect(de[`${P}.key.proposalsWhat`]).toBe('{agent}: Direkt anwenden → Vorschläge zur Prüfung')
    expect(en[`${P}.setup.head`]).toBe('Set up · {n} lamps · in this order')
    expect(de[`${P}.setup.head`]).toBe('Einrichten · {n} Lampen · in dieser Reihenfolge')
    // outbound modules carry their exit type, never "Ausgang"
    for (const t of ['webhook', 'git', 'http', 'mail', 'mcp', 'sync']) expect(de[`${P}.exit.${t}`], t).not.toMatch(/Ausgang/)
    expect([en[`${P}.ro.byAI`], de[`${P}.ro.byAI`]]).toEqual(['{n} chosen by the AI', '{n} nach Wahl der KI'])
    expect([en[`${P}.fuse.static`], de[`${P}.fuse.static`]]).toEqual(['read from the settings · no guard while it runs', 'aus den Einstellungen gelesen · schützt nicht während eines Laufs'])
    // the other areas' ways in
    expect(OUTSIDE_DE).toEqual({ 'shell.ws.auto.asPatchbay': 'Als Schaltplan', 'shell.ws.auto.showInPatchbay': 'Im Schaltplan zeigen', 'help.news.try.patchbay': 'Schaltplan öffnen' })
  })

  test('names: "Claude" only where the route is Claude, no other provider, no service', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const [k, v] of Object.entries(patchbay[lang])) {
        expect(v, `${lang} ${k}`).not.toMatch(OTHER_NAMES)
        if (/Claude/.test(v)) expect(k, `${lang} ${k}: "Claude" outside the KEY / TEST lamps and the bridge`).toMatch(CLAUDE_KEYS)
      }
    }
    // the KEY lamp names Claude (browser agents and MCP tests run on its route)
    expect(patchbay.en[`${P}.setup.key.key`]).toBe('Set up Claude')
    expect(patchbay.de[`${P}.setup.key.key`]).toBe('Claude einrichten')
  })

  test('the help article and the What’s new entry: German words, KI, the Outbox as "Ausgang" only, no service', () => {
    const read = (p: string) => readFileSync(p, 'utf8')
    const deDocs = { article: read('src/app/help/articles/de/patchbay.md'), news: read('src/app/help/changelog/de/2026-10-15-patchbay.md') }
    const enDocs = { article: read('src/app/help/articles/en/patchbay.md'), news: read('src/app/help/changelog/en/2026-10-15-patchbay.md') }
    for (const [name, text] of Object.entries(deDocs)) {
      expect(text, name).not.toMatch(BANNED_DE)
      expect(text, name).not.toMatch(/\bAI\b/)
      // "Ausgang" is the Outbox only: never an outbound module's label
      expect(text, name).not.toMatch(/Ausgang\s*·?\s*(Webhook|Git|HTTP|MCP|Sync)/)
      expect(text, name).not.toMatch(/Weg abnehmen|freigegeben/)
      expect(text, name).toMatch(/Weg zulassen/)
      // "Sicherung" is a fuse here: backups are "Backup" (One's German UI — fix ui-words)
      expect(text, name).not.toMatch(/Sicherungen enthalten|aus einer Sicherung|Komplett-Sicherung|gesichert\b/)
    }
    for (const [name, text] of Object.entries({ ...deDocs, ...Object.fromEntries(Object.entries(enDocs).map(([k, v]) => [`en ${k}`, v])) })) {
      // article ids in links (help:ai-jev) are no names
      expect(text.replace(/\(help:[a-z-]+\)|^(help|related): .*$/gm, ''), name).not.toMatch(OTHER_NAMES)
      // hosts in examples are *.example only
      for (const m of text.matchAll(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g)) if (/^(chat|tracker|hook\d*)\./.test(m[0])) expect(m[0], name).toMatch(/\.example$/)
    }
    for (const [name, text] of Object.entries(enDocs)) {
      expect(text, name).toMatch(/Allow this path/)
      expect(text, name).not.toMatch(/\btrust this path|fuse trust/i)
    }
  })
})
