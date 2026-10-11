/**
 * Per-field trust — the key grammar and what may ever be direct (store/autonomy.ts), the ONE reason key map of the run
 * review and Preflight (features/agents/trust/reasons.ts) and the keys a staged change writes (trust/keys.ts). Pure:
 * run in Node by the Playwright runner (no browser). Test data is fictional (the Nordlicht story).
 */
import { test, expect } from '@playwright/test'
import { DIRECT_KINDS, DIRECT_TYPES, TRUST_KEY_RE, notDirect, parseTrustKey, propTrustKey, rowTrustKey } from '../../src/app/store/autonomy'
import { REASONS, reasonKeys, reasonOfKey, wrongLetter } from '../../src/app/features/agents/trust/reasons'
import { keyLabel, keysOfChange } from '../../src/app/features/agents/trust/keys'
import { messages } from '../../src/app/features/agents/trust/messages'
import type { StagedChange } from '../../src/app/features/ai/agent/types'
import type { Database, Page, PropertyDef } from '../../src/app/store/types'

function page(over: Partial<Page> = {}): Page {
  return {
    id: 'p-1',
    kind: 'page',
    title: 'Nordlicht Übergabe',
    icon: null,
    cover: null,
    parentId: null,
    databaseId: null,
    properties: {},
    content: null,
    contentRev: 0,
    contentOrigin: null,
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    order: 1,
    settings: { fullWidth: false, smallText: false, font: 'sans', locked: false },
    ...over,
  }
}

const props: PropertyDef[] = [
  { id: 'title', name: 'Name', type: 'title' },
  { id: 'nr', name: 'Nummer', type: 'text', key: true },
  { id: 'klar', name: 'Klarheit', type: 'select', options: [{ id: 'o-klar', name: 'Klar', color: 'green' }] },
  { id: 'warum', name: 'Warum', type: 'text' },
  { id: 'neu', name: 'Neuer Kommentar', type: 'checkbox' },
  { id: 'hand', name: 'Notiz', type: 'text', agentReadOnly: true },
  { id: 'wer', name: 'Zuständig', type: 'person' },
  { id: 'eigen', name: 'Ampel', type: 'select', custom: 'pt-ampel' },
  { id: 'formel', name: 'Score', type: 'formula', formula: '1' },
  { id: 'stern', name: 'Wichtig', type: 'rating' },
]

function workspace() {
  const db: Database = { id: 'db-nl', properties: props, views: [], nextUniqueId: 1 }
  const gone: Database = { id: 'db-old', properties: [{ id: 'x', name: 'X', type: 'text' }], views: [], nextUniqueId: 1 }
  const deep: Database = { id: 'db-deep', properties: [{ id: 'y', name: 'Y', type: 'text' }], views: [], nextUniqueId: 1 }
  const pages: Record<string, Page> = {
    'db-nl': page({ id: 'db-nl', kind: 'database', title: 'Nordlicht-Spiegel' }),
    'db-old': page({ id: 'db-old', kind: 'database', title: 'Alt', trashed: true, trashedAt: 5 }),
    folder: page({ id: 'folder', title: 'Archiv', trashed: true, trashedAt: 5 }),
    'db-deep': page({ id: 'db-deep', kind: 'database', title: 'Tief', parentId: 'folder' }),
    'nl-201': page({ id: 'nl-201', title: 'NL-201 Übergabe prüfen', parentId: 'db-nl', databaseId: 'db-nl' }),
    report: page({ id: 'report', title: 'Bericht' }),
  }
  return { pages, databases: { 'db-nl': db, 'db-old': gone, 'db-deep': deep } }
}

/** A translator over the trust strings (shared/i18n reads Vite's env, so Node builds its own). */
const tr = (lang: 'en' | 'de') => (key: string, vars?: Record<string, string | number>) => (messages[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m))

test.describe('trust key grammar', () => {
  test('valid keys parse, invalid and reserved ones do not', () => {
    for (const k of ['prop:db-nl:klar', 'row:db-nl', 'append:report', 'rename:db-nl', 'edit:report', 'page:report', 'page:-', `prop:${'a'.repeat(64)}:${'b'.repeat(64)}`]) {
      expect(TRUST_KEY_RE.test(k), k).toBe(true)
      expect(parseTrustKey(k), k).not.toBeNull()
    }
    for (const k of ['', 'prop:db-nl', 'prop::klar', 'prop:db-nl:', 'row:', 'row:db|nl', 'trust|local:local|ag', 'prop:db nl:klar', 'send:db-nl', 'memory:x', `row:${'a'.repeat(65)}`, 'prop:db-nl:klar:x', 'PAGE:report', 'page:', 'append:a:b']) {
      expect(TRUST_KEY_RE.test(k), k).toBe(false)
      expect(parseTrustKey(k), k).toBeNull()
    }
    expect(parseTrustKey('prop:db-nl:klar')).toEqual({ kind: 'prop', db: 'db-nl', prop: 'klar' })
    expect(parseTrustKey('row:db-nl')).toEqual({ kind: 'row', db: 'db-nl' })
    expect(parseTrustKey('append:report')).toEqual({ kind: 'append', target: 'report' })
    expect(parseTrustKey('page:-')).toEqual({ kind: 'page', parent: null })
    expect(parseTrustKey('page:report')).toEqual({ kind: 'page', parent: 'report' })
    expect(propTrustKey('db-nl', 'klar')).toBe('prop:db-nl:klar')
    expect(rowTrustKey('db-nl')).toBe('row:db-nl')
  })

  test('only prop keys may be direct in S1; the direct types', () => {
    expect([...DIRECT_KINDS]).toEqual(['prop'])
    expect([...DIRECT_TYPES].sort()).toEqual(['checkbox', 'date', 'email', 'multi_select', 'number', 'phone', 'select', 'status', 'text', 'url'])
  })

  test('notDirect names every reason', () => {
    const s = workspace()
    expect(notDirect('prop:db-nl:klar', s)).toBeNull()
    expect(notDirect('prop:db-nl:warum', s)).toBeNull()
    expect(notDirect('prop:db-nl:neu', s)).toBeNull()
    // a kind that is never direct (row: before S4), or a key that does not parse
    expect(notDirect('row:db-nl', s)).toBe('kind')
    expect(notDirect('append:report', s)).toBe('kind')
    expect(notDirect('page:-', s)).toBe('kind')
    expect(notDirect('nonsense', s)).toBe('kind')
    // gone: the database, the property, the computed Type column (never a stored property)
    expect(notDirect('prop:db-none:klar', s)).toBe('gone')
    expect(notDirect('prop:db-nl:none', s)).toBe('gone')
    expect(notDirect('prop:db-nl:__type__', s)).toBe('gone')
    // trashed: the database itself, or a page above it
    expect(notDirect('prop:db-old:x', s)).toBe('trashed')
    expect(notDirect('prop:db-deep:y', s)).toBe('trashed')
    // only by hand · the key property · an own type · a type outside the direct ones
    expect(notDirect('prop:db-nl:hand', s)).toBe('hand')
    expect(notDirect('prop:db-nl:nr', s)).toBe('key')
    expect(notDirect('prop:db-nl:eigen', s)).toBe('custom')
    expect(notDirect('prop:db-nl:wer', s)).toBe('type')
    expect(notDirect('prop:db-nl:formel', s)).toBe('type')
    expect(notDirect('prop:db-nl:stern', s)).toBe('type')
    expect(notDirect('prop:db-nl:title', s)).toBe('type')
  })
})

test.describe('reason keys (one map for the run review and Preflight)', () => {
  test('1–4 and the language letter for wrong', () => {
    expect(REASONS).toEqual(['wrong', 'notNow', 'duplicate', 'done'])
    expect(wrongLetter('de')).toBe('f')
    expect(wrongLetter('en')).toBe('w')
    expect(reasonKeys('de')).toEqual({ wrong: ['1', 'f'], notNow: ['2'], duplicate: ['3'], done: ['4'] })
    expect(reasonKeys('en')).toEqual({ wrong: ['1', 'w'], notNow: ['2'], duplicate: ['3'], done: ['4'] })
    for (const lang of ['de', 'en'] as const) {
      expect(reasonOfKey('1', lang)).toBe('wrong')
      expect(reasonOfKey('2', lang)).toBe('notNow')
      expect(reasonOfKey('3', lang)).toBe('duplicate')
      expect(reasonOfKey('4', lang)).toBe('done')
      for (const k of ['5', '0', 'e', 'E', 'h', 'H', 'n', 'N', 'd', 'D', 'a', 'z', '', '11', 'Enter']) expect(reasonOfKey(k, lang), `${lang} ${k}`).toBeNull()
    }
    expect(reasonOfKey('f', 'de')).toBe('wrong')
    expect(reasonOfKey('F', 'de')).toBe('wrong')
    expect(reasonOfKey('w', 'en')).toBe('wrong')
    expect(reasonOfKey('W', 'en')).toBe('wrong')
    // only the UI language's letter: a key never does what its cap does not show
    expect(reasonOfKey('w', 'de')).toBeNull()
    expect(reasonOfKey('f', 'en')).toBeNull()
  })

  test('no reason letter is one of Preflight’s other letters', () => {
    const preflight = new Set(['a', 'j', 'k', 'd', 'e', 'o', 'r', 'n', 'x', 'z'])
    for (const lang of ['de', 'en'] as const) for (const keys of Object.values(reasonKeys(lang))) for (const k of keys) expect(preflight.has(k), `${lang} ${k}`).toBe(false)
  })
})

test.describe('keys of a staged change', () => {
  const change = (over: Partial<StagedChange>): StagedChange => ({ id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId: 'nl-201', ...over })
  const same = (id: string) => id
  const prop = (propId: string) => ({ propId, name: propId, type: 'text' as const, before: '', after: 'x', intent: { kind: 'value' as const, value: 'x' } })

  test('a vector per kind', () => {
    const { pages } = workspace()
    expect(keysOfChange(change({ databaseId: 'db-nl', props: [prop('klar'), prop('warum'), prop('klar')] }), same, pages)).toEqual(['prop:db-nl:klar', 'prop:db-nl:warum'])
    expect(keysOfChange(change({ kind: 'create_row', pageId: 'r-new', databaseId: 'db-nl', title: 'NL-209' }), same, pages)).toEqual(['row:db-nl'])
    expect(keysOfChange(change({ kind: 'append', pageId: 'nl-201', markdown: 'x' }), same, pages)).toEqual(['append:db-nl'])
    expect(keysOfChange(change({ kind: 'append', pageId: 'report', markdown: 'x' }), same, pages)).toEqual(['append:report'])
    expect(keysOfChange(change({ kind: 'rename', pageId: 'nl-201', title: 'NL-201 neu' }), same, pages)).toEqual(['rename:db-nl'])
    expect(keysOfChange(change({ kind: 'edit', pageId: 'report' }), same, pages)).toEqual(['edit:report'])
    expect(keysOfChange(change({ kind: 'create_page', pageId: 'p-new', parentId: 'report', title: 'Tessera' }), same, pages)).toEqual(['page:report'])
    expect(keysOfChange(change({ kind: 'create_page', pageId: 'p-new', parentId: null, title: 'Tessera' }), same, pages)).toEqual(['page:-'])
    for (const kind of ['create_database', 'add_property', 'memory', 'script', 'media', 'coding', 'send'] as const) expect(keysOfChange(change({ kind }), same, pages), kind).toEqual([])
    // an update without its database falls back to the row's
    expect(keysOfChange(change({ props: [prop('warum')] }), same, pages)).toEqual(['prop:db-nl:warum'])
    // no database anywhere: none
    expect(keysOfChange(change({ pageId: 'report', props: [prop('warum')] }), same, pages)).toEqual([])
  })

  test('staged rows and pages resolve to the real ids', () => {
    const { pages } = workspace()
    const rowIds: Record<string, string> = { 'r-staged': 'nl-201', 'p-staged': 'report' }
    const resolve = (id: string) => rowIds[id] ?? id
    expect(keysOfChange(change({ pageId: 'r-staged', props: [prop('klar')] }), resolve, pages)).toEqual(['prop:db-nl:klar'])
    expect(keysOfChange(change({ kind: 'append', pageId: 'r-staged' }), resolve, pages)).toEqual(['append:db-nl'])
    expect(keysOfChange(change({ kind: 'create_page', pageId: 'p-new', parentId: 'p-staged' }), resolve, pages)).toEqual(['page:report'])
    // ids that do not fit the grammar are left out
    expect(keysOfChange(change({ kind: 'append', pageId: 'bad id' }), same, pages)).toEqual([])
  })

  test('labels read the workspace', () => {
    const s = workspace()
    const de = tr('de')
    const en = tr('en')
    expect(keyLabel('prop:db-nl:neu', s, de)).toEqual({ name: 'Neuer Kommentar', kind: 'Haken', db: 'Nordlicht-Spiegel' })
    expect(keyLabel('prop:db-nl:klar', s, en)).toEqual({ name: 'Klarheit', kind: 'Select', db: 'Nordlicht-Spiegel' })
    expect(keyLabel('row:db-nl', s, de)).toEqual({ name: 'Neue Zeile', kind: 'Anlegen', db: 'Nordlicht-Spiegel' })
    expect(keyLabel('append:report', s, de).name).toBe('Anhängen · Bericht')
    expect(keyLabel('page:-', s, en).name).toBe('New page · top level')
    expect(keyLabel('prop:db-nl:none', s, en).name).toBe('Deleted property')
  })
})
