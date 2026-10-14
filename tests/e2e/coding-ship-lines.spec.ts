/**
 * The ship log (worker 1.10.0), the app's side — Node only, no browser: features/coding/ship.ts (pure). A worker's
 * ShipRecord is checked as it arrives (cleanShip: hostile addresses, credentials, a fragment, another host, a short sha
 * are dropped), its line in EN and DE with links only to what is on the remote, the note's date, the PR / Commit field
 * after it (a request's address is never replaced by a commit link), the shared URL helpers of protocol.ts, the
 * pipeline editor's warnings for push / requests off, and the new worker log codes with their values.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { cleanShip, gitStageWarnings, isCommitUrl, prFieldNext, shipInline, shipNote, shipShows, shipText, shipWhen } from '../../src/app/features/coding/ship'
import { branchUrl, cleanWeb, commitUrl, requestNumber, type ShipRecord } from '../../src/app/features/coding/protocol'
import { messages } from '../../src/app/features/coding/messages'
import { logValues } from '../../src/app/features/coding/logValues'
import { approvalsAt, readApprovalsHistory } from '../../src/app/features/coding/state'

/** The app's interpolate() (src/shared/i18n.ts is not importable under Node). */
const tr = (lang: 'en' | 'de') => (key: string, v: Record<string, string | number> = {}) => {
  const s = messages[lang][key]
  if (s === undefined) throw new Error(`no ${lang} string ${key}`)
  return s.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in v ? String(v[k]) : m))
}
const en = tr('en')
const de = tr('de')

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const SHA2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890'
const GL = { base: 'https://gitlab.example.test/nordlicht/website', forge: 'gitlab' as const }
const GH = { base: 'https://github.example.com/tessera/app', forge: 'github' as const }
const MR = `${GL.base}/-/merge_requests/42`
const BRANCH = 'one/fix-the-login-form-ab12cd'

/** A record as the worker sends it for a stage that committed, pushed and opened an MR on GitLab. */
const shipped = (over: Partial<ShipRecord> = {}): ShipRecord => ({
  action: 'pr',
  from: 'stage',
  at: Date.now(),
  branch: BRANCH,
  commit: { sha: SHA },
  head: SHA,
  pushed: { remote: 'origin' },
  request: { url: MR, how: 'opened' },
  web: GL,
  ...over,
})

/** The line's links: [text, href] of every linked text node. */
const links = (nodes: JSONContent[]) => nodes.filter((n) => n.marks?.some((m) => m.type === 'link')).map((n) => [n.text, n.marks![0]!.attrs!.href as string])

test('cleanShip: every field is checked; a request must live on the record\'s own repository', () => {
  const good = cleanShip(shipped())
  expect(good).toEqual(shipped({ at: good!.at }))
  // unknown action / from, a bad branch: nothing usable
  for (const bad of [{ action: 'rebase' }, { from: 'tab' }, { branch: '-x' }, { branch: 'a/../b' }, { branch: 'a b' }, { branch: '.hidden/x' }, { branch: '' }, { branch: 'x.lock' }, { branch: 'a~1' }, { branch: 'a@{1}' }, { branch: 'a:b' }, { branch: 'fix/\u202eevil' }, { branch: 'x/' }, { branch: 'x.' }, { branch: 'b'.repeat(201) }])
    expect(cleanShip({ ...shipped(), ...bad }), JSON.stringify(bad)).toBeNull()
  // any branch git takes is kept — umlauts, "+", "@" — written as text, its link encoded per part
  for (const branch of ['fix/ümlaute', 'feature+x', 'team@nordlicht/x', 'release/1.2'])
    expect(cleanShip({ ...shipped(), branch })!.branch, branch).toBe(branch)
  const uml = cleanShip({ ...shipped(), branch: 'fix/ümlaute' })!
  expect(links(shipInline(uml, en))).toContainEqual(['fix/ümlaute', `${GL.base}/-/tree/fix/%C3%BCmlaute`])
  for (const raw of [null, 'x', 42, [], undefined]) expect(cleanShip(raw)).toBeNull()
  // a 39-char sha, an upper-case one: no commit / head
  const short = cleanShip({ ...shipped(), commit: { sha: SHA.slice(1) }, head: SHA.toUpperCase() })!
  expect(short.commit).toBeNull()
  expect(short.head).toBeNull()
  // a sha-256 object id is fine
  expect(cleanShip({ ...shipped(), commit: { sha: `${SHA}${'c'.repeat(24)}` } })!.commit).toEqual({ sha: `${SHA}${'c'.repeat(24)}` })
  // pushed: a remote name only; force only as true
  expect(cleanShip({ ...shipped(), pushed: { remote: '../x' } })!.pushed).toBeNull()
  expect(cleanShip({ ...shipped(), pushed: { remote: 'origin', force: 'yes' } })!.pushed).toEqual({ remote: 'origin' })
  expect(cleanShip({ ...shipped(), pushed: { remote: 'origin', force: true } })!.pushed).toEqual({ remote: 'origin', force: true })
  // pushOff / failed only as the contract says
  expect(cleanShip({ ...shipped(), pushOff: 'true' })!.pushOff).toBeUndefined()
  expect(cleanShip({ ...shipped(), failed: { step: 'push', code: 'other' } })!.failed).toEqual({ step: 'push' })
  expect(cleanShip({ ...shipped(), failed: { step: 'deploy' } })!.failed).toBeUndefined()
  expect(cleanShip({ ...shipped(), failed: { step: 'push', code: 'pushRejected' } })!.failed).toEqual({ step: 'push', code: 'pushRejected' })
  // a clock that is no number: now
  expect(cleanShip({ ...shipped(), at: 'soon' })!.at).toBeGreaterThan(Date.now() - 5000)
  // hostile requests are dropped (the rest of the record stays)
  const hostile = [
    'https://evil.example.com/nordlicht/website/-/merge_requests/42',
    'https://user:pw@gitlab.example.test/nordlicht/website/-/merge_requests/42',
    `${MR}#/p/abc`,
    `${GL.base}-other/-/merge_requests/1`,
    `${GL.base}/../../admin`,
    'javascript:alert(1)',
    `${MR} x`,
    `${GL.base}/${'x'.repeat(2000)}`,
  ]
  for (const url of hostile) {
    const r = cleanShip({ ...shipped(), request: { url, how: 'opened' } })!
    expect(r.request, url).toBeNull()
    expect(r.commit, url).not.toBeNull()
  }
  expect(cleanShip({ ...shipped(), request: { url: MR, how: 'closed' } })!.request).toBeNull()
  // the address as a URL writes it: a host in capitals or the default port named is the same address — kept in that form
  const self = { base: 'https://git.nordlicht.example.test/team/web', forge: 'gitlab' as const }
  for (const url of ['https://Git.Nordlicht.example.test/team/web/-/merge_requests/5', 'https://git.nordlicht.example.test:443/team/web/-/merge_requests/5'])
    expect(cleanShip({ ...shipped(), web: self, request: { url, how: 'opened' } })!.request, url).toEqual({ url: `${self.base}/-/merge_requests/5`, how: 'opened' })
  // no web address: no request (and no links)
  expect(cleanShip({ ...shipped(), web: null })!.request).toBeNull()
  // a web address cleanWeb refuses: none
  for (const web of [{ base: 'javascript:alert(1)//x/y', forge: 'gitlab' }, { base: 'https://user:pw@gitlab.example.test/a/b', forge: 'gitlab' }, { base: 'https://gitlab.example.test/a/../b', forge: 'gitlab' }, { base: 'https://gitlab.example.test/a/b', forge: 'bitbucket' }, { base: '/home/me/website', forge: 'gitlab' }])
    expect(cleanShip({ ...shipped(), web })!.web, JSON.stringify(web)).toBeNull()
})

test('the shared URL helpers: commit / branch links per forge, the request number, the web address rule', () => {
  expect(commitUrl(GL, SHA)).toBe(`${GL.base}/-/commit/${SHA}`)
  expect(commitUrl(GH, SHA)).toBe(`${GH.base}/commit/${SHA}`)
  expect(branchUrl(GL, 'one/fix login#1')).toBe(`${GL.base}/-/tree/one/fix%20login%231`)
  expect(branchUrl(GH, 'one/x')).toBe(`${GH.base}/tree/one/x`)
  expect(requestNumber(MR)).toEqual({ kind: 'mr', n: 42 })
  expect(requestNumber(`${GH.base}/pull/7`)).toEqual({ kind: 'pr', n: 7 })
  expect(requestNumber(`${GH.base}/compare/main...one/x?expand=1`)).toBeNull()
  expect(requestNumber(`${GL.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=one%2Fx`)).toBeNull()
  expect(cleanWeb({ base: 'https://gitlab.example.test:8443/a/b/c', forge: 'gitlab' })).toEqual({ base: 'https://gitlab.example.test:8443/a/b/c', forge: 'gitlab' })
  expect(cleanWeb({ base: 'https://gitlab.example.test/a', forge: 'gitlab' })).toBeNull()
  expect(cleanWeb({ base: 'https://gitlab.example.test/a/b/', forge: 'gitlab' })).toBeNull()
  expect(cleanWeb({ base: 'https://Gitlab.example.test/a/b', forge: 'gitlab' })).toBeNull()
})

test('the line in EN and DE: Commit · Branch · MR · pushed, linked only where it is on the remote', () => {
  const s = shipped()
  const e = shipInline(s, en)
  expect(shipText(s, en)).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · MR !42 · pushed to origin/${BRANCH}`)
  expect(shipText(s, de)).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · MR !42 · nach origin/${BRANCH} gepusht`)
  expect(links(e)).toEqual([
    [SHA.slice(0, 7), `${GL.base}/-/commit/${SHA}`],
    [BRANCH, `${GL.base}/-/tree/${BRANCH}`],
    ['MR !42', MR],
  ])
  // plain text runs are one node each (no empty ones)
  for (const n of e) expect(n.text).toBeTruthy()
  // the note: the grey callout, a bold label with the date, then the line
  const note = shipNote('Ship', s, en, 'en', s.at)
  expect(note.type).toBe('callout')
  expect(note.attrs).toEqual({ icon: 'asset:publish', color: 'gray' })
  expect(note.content![0]!.content![0]).toEqual({ type: 'text', text: `Ship · ${shipWhen(s.at, 'en')}`, marks: [{ type: 'bold' }] })
  expect(note.content![1]!.content).toEqual(e)
})

test('each request, push and failure reads right — and a commit only on this computer is not linked', () => {
  const say = (over: Partial<ShipRecord>, lang: 'en' | 'de' = 'en') => shipText(shipped(over), lang === 'en' ? en : de)
  const linksOf = (over: Partial<ShipRecord>) => links(shipInline(shipped(over), en)).map(([, h]) => h)
  // an MR already open
  expect(say({ request: { url: MR, how: 'existing' } })).toContain('MR !42 (already open)')
  expect(say({ request: { url: MR, how: 'existing' } }, 'de')).toContain('MR !42 (schon offen)')
  // a link to create one: the whole text linked
  const link = `${GL.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=one%2Fx`
  expect(say({ request: { url: link, how: 'link' } })).toContain('create the MR')
  expect(say({ request: { url: link, how: 'link' } }, 'de')).toContain('MR anlegen')
  expect(links(shipInline(shipped({ request: { url: link, how: 'link' } }), en))).toContainEqual(['create the MR', link])
  // GitHub: PR #7, "create the PR"
  const pr = `${GH.base}/pull/7`
  expect(say({ web: GH, request: { url: pr, how: 'opened' } })).toContain('PR #7')
  expect(say({ web: GH, request: { url: `${GH.base}/compare/main...x?expand=1`, how: 'link' } })).toContain('create the PR')
  // a review posted, a request merged (no commit part)
  expect(say({ action: 'comment', commit: null, pushed: null, request: { url: MR, how: 'commented' } })).toBe(`Branch ${BRANCH} · review posted to MR !42`)
  expect(say({ action: 'merge', commit: null, pushed: null, request: { url: MR, how: 'merged' } }, 'de')).toBe(`Branch ${BRANCH} · MR !42 gemergt`)
  // pushing off: the commit is only here — no links at all
  const off = { action: 'push' as const, pushed: null, pushOff: true as const, request: null }
  expect(say(off)).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · not pushed — pushing is off in the worker`)
  expect(say(off, 'de')).toContain('nicht gepusht – Pushen ist im Worker aus')
  expect(linksOf(off)).toEqual([])
  // push rejected / failed: the commit recorded, nothing linked
  const rejected = { pushed: null, request: null, failed: { step: 'push' as const, code: 'pushRejected' as const } }
  expect(say(rejected)).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · push rejected — the branch there has newer commits`)
  expect(say(rejected, 'de')).toContain('Push abgelehnt – der Branch dort hat neuere Commits')
  expect(linksOf(rejected)).toEqual([])
  expect(say({ pushed: null, request: null, failed: { step: 'push' } }, 'de')).toContain('Push fehlgeschlagen')
  // the request failed after the push: the push stays, the commit is linked
  const reqFailed = { request: null, failed: { step: 'request' as const } }
  expect(say(reqFailed)).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH} · MR could not be opened · pushed to origin/${BRANCH}`)
  expect(say({ ...reqFailed, web: GH }, 'de')).toContain('PR konnte nicht geöffnet werden')
  expect(linksOf(reqFailed)).toEqual([`${GL.base}/-/commit/${SHA}`, `${GL.base}/-/tree/${BRANCH}`])
  // nothing new to commit, pushed: the head is named and linked
  expect(say({ commit: null, head: SHA2 })).toBe(`Nothing new to commit · at ${SHA2.slice(0, 7)} · Branch ${BRANCH} · MR !42 · pushed to origin/${BRANCH}`)
  expect(say({ commit: null, head: SHA2 }, 'de')).toContain(`Nichts Neues zu committen · Stand ${SHA2.slice(0, 7)}`)
  // the Push key: only the head (the line starts with a capital); force-push with lease
  expect(say({ action: 'push', from: 'key', commit: null, head: SHA2, request: null })).toBe(`At ${SHA2.slice(0, 7)} · Branch ${BRANCH} · pushed to origin/${BRANCH}`)
  expect(say({ action: 'force-push', from: 'key', commit: null, head: SHA2, request: null, pushed: { remote: 'origin', force: true } })).toBe(`At ${SHA2.slice(0, 7)} · Branch ${BRANCH} · force-pushed with lease to origin/${BRANCH}`)
  expect(say({ action: 'force-push', from: 'key', commit: null, head: SHA2, request: null, pushed: { remote: 'origin', force: true } }, 'de')).toContain(`mit Force (with lease) nach origin/${BRANCH} gepusht`)
  // the Commit key: its commit, not pushed — no link
  expect(say({ action: 'commit', from: 'key', head: SHA, pushed: null, request: null })).toBe(`Commit ${SHA.slice(0, 7)} · Branch ${BRANCH}`)
  expect(linksOf({ action: 'commit', from: 'key', head: SHA, pushed: null, request: null })).toEqual([])
  // no web address (an unknown host): the same words, no links
  expect(linksOf({ web: null, request: null })).toEqual([])
  // an English line has no braces left, neither has a German one
  for (const over of [{}, off, rejected, reqFailed, { commit: null, head: SHA2 }])
    for (const lang of ['en', 'de'] as const) expect(say(over, lang)).not.toMatch(/[{}]/)
  // worth a note: a commit, a push (off / failed too) or a request — not a comment without an address
  expect(shipShows(shipped())).toBe(true)
  expect(shipShows(shipped({ commit: null, pushed: null, request: null, pushOff: true }))).toBe(true)
  expect(shipShows(shipped({ action: 'comment', commit: null, pushed: null, request: null }))).toBe(false)
})

test('the note\'s date: "14.10. 14:32" (de) · "14 Oct 14:32" (en); a late record keeps its time, a time ahead of now is now', () => {
  const at = new Date(2026, 9, 14, 14, 32).getTime()
  expect(shipWhen(at, 'de', at + 60_000)).toBe('14.10. 14:32')
  expect(shipWhen(at, 'en', at + 60_000)).toBe('14 Oct 14:32')
  // Friday's Ship delivered on Monday: Friday's time
  const friday = new Date(2026, 9, 16, 18, 1).getTime()
  const monday = new Date(2026, 9, 19, 9, 0).getTime()
  expect(shipWhen(friday, 'de', monday)).toBe('16.10. 18:01')
  expect(shipWhen(friday, 'en', monday)).toBe('16 Oct 18:01')
  // another year: with the year
  const lastYear = new Date(2025, 11, 30, 17, 45).getTime()
  expect(shipWhen(lastYear, 'de', monday)).toBe('30.12.2025 17:45')
  expect(shipWhen(lastYear, 'en', monday)).toBe('30 Dec 2025 17:45')
  // a worker clock a little ahead: now; far ahead, or no time at all: now
  expect(shipWhen(monday + 2 * 60_000, 'de', monday)).toBe('19.10. 09:00')
  expect(shipWhen(monday + 3 * 86_400_000, 'de', monday)).toBe('19.10. 09:00')
  expect(shipWhen(Number.NaN, 'en', monday)).toBe('19 Oct 09:00')
})

test('PR / Commit: the request\'s address wins; a commit link only into an empty field or over an older commit link', () => {
  const commitLink = `${GL.base}/-/commit/${SHA}`
  // an opened request: its address, unless the field holds it already
  expect(prFieldNext('', shipped())).toBe(MR)
  expect(prFieldNext(MR, shipped())).toBeNull()
  expect(prFieldNext(commitLink, shipped())).toBe(MR)
  // the field holds an MR; a later record pushed with no request: unchanged
  expect(prFieldNext(MR, shipped({ request: null }))).toBeNull()
  // empty field + a pushed record: the commit link
  expect(prFieldNext('', shipped({ request: null }))).toBe(commitLink)
  expect(prFieldNext(null, shipped({ request: null }))).toBe(commitLink)
  // an older commit link of the repo + a newer pushed record: the new commit link
  expect(prFieldNext(`${GL.base}/-/commit/${SHA2}`, shipped({ request: null }))).toBe(commitLink)
  expect(prFieldNext(`${GH.base}/commit/${SHA2}`, shipped({ web: GH, request: null }))).toBe(`${GH.base}/commit/${SHA}`)
  // something else the person put there: kept
  expect(prFieldNext('https://example.com/ticket/9', shipped({ request: null }))).toBeNull()
  // a record 'link' while the field holds an MR address: unchanged; over a commit link: the link
  const link = `${GL.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=x`
  expect(prFieldNext(MR, shipped({ request: { url: link, how: 'link' } }))).toBeNull()
  expect(prFieldNext(commitLink, shipped({ request: { url: link, how: 'link' } }))).toBe(link)
  // not pushed (push off, push failed): nothing — the commit is only on this computer
  expect(prFieldNext('', shipped({ request: null, pushed: null, pushOff: true }))).toBeNull()
  expect(prFieldNext('', shipped({ request: null, pushed: null, failed: { step: 'push' } }))).toBeNull()
  // the request failed after the push: the pushed commit
  expect(prFieldNext('', shipped({ request: null, failed: { step: 'request' } }))).toBe(commitLink)
  // nothing new to commit: the head
  expect(prFieldNext('', shipped({ request: null, commit: null, head: SHA2 }))).toBe(`${GL.base}/-/commit/${SHA2}`)
  // no web address: nothing
  expect(prFieldNext('', shipped({ request: null, web: null }))).toBeNull()
})

test('the pipeline editor\'s warning: only an explicit push false / pr none counts', () => {
  const repos = [
    { name: 'website', push: false, pr: 'none' },
    { name: 'tessera', push: true, pr: 'none' },
    { name: 'launch-plan', push: true, pr: 'gh' },
    { name: 'old', push: undefined, pr: undefined },
  ]
  expect(gitStageWarnings('pr', repos)).toEqual({ pushOff: ['website'], prOff: ['tessera'], prFails: false })
  expect(gitStageWarnings('push', repos)).toEqual({ pushOff: ['website'], prOff: [], prFails: false })
  // posting a review / merging: push off fails there too (nothing pushed, no request) — each repo named once
  expect(gitStageWarnings('comment', repos)).toEqual({ pushOff: ['website'], prOff: ['tessera'], prFails: true })
  expect(gitStageWarnings('merge', repos)).toEqual({ pushOff: ['website'], prOff: ['tessera'], prFails: true })
  expect(gitStageWarnings('merge', [{ name: 'tessera', push: false, pr: 'gh' }])).toEqual({ pushOff: ['tessera'], prOff: [], prFails: true })
  for (const a of ['commit', 'update-base', null, undefined] as const) expect(gitStageWarnings(a, repos)).toEqual({ pushOff: [], prOff: [], prFails: false })
  // an older worker names neither: no warning
  expect(gitStageWarnings('pr', [{ name: 'website' }])).toEqual({ pushOff: [], prOff: [], prFails: false })
})

test('a commit page (what PR / Commit holds without a request) is no merge request', () => {
  expect(isCommitUrl(`${GL.base}/-/commit/${SHA}`)).toBe(true)
  expect(isCommitUrl(`${GH.base}/commit/${SHA}`)).toBe(true)
  for (const url of [MR, `${GH.base}/pull/7`, `${GL.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=x`, `${GL.base}/-/commit/${SHA}?view=parallel`, 'https://example.com/ticket/9', ''])
    expect(isCommitUrl(url), url).toBe(false)
})

/** The codes of LOG_CODES as lines.ts lists them (it imports the app's runtime, so it is read, not imported). */
function logCodes(): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../src/app/features/coding/lines.ts', import.meta.url)), 'utf8')
  return [.../export const LOG_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(src)![1]!.matchAll(/'([A-Za-z.]+)'/g)].map((m) => m[1]!)
}

test('the worker 1.10.0 log codes: each in EN and DE with its values, the request named by its kind', () => {
  const SHIP_CODES: Record<string, Record<string, string>> = {
    requestOpened: { kind: 'mr', url: MR },
    requestExisting: { kind: 'mr', url: MR },
    requestLink: { kind: 'pr', url: `${GH.base}/compare/main...x?expand=1` },
    requestNone: { remote: 'origin' },
    pushOff: { repo: 'website' },
    pushRejected: { remote: 'origin' },
    forcePushed: { branch: BRANCH, remote: 'origin' },
    remoteMerged: { remote: 'origin', branch: BRANCH },
  }
  const codes = logCodes()
  for (const [code, v] of Object.entries(SHIP_CODES)) {
    expect(codes, code).toContain(code)
    const lines = (['en', 'de'] as const).map((lang) => tr(lang)(`features.coding.log.c.${code}`, logValues(code, v, (k) => tr(lang)(k))))
    for (const l of lines) {
      expect(l, code).not.toMatch(/\{\w+\}/)
      for (const [k, value] of Object.entries(v)) if (k !== 'kind') expect(l, code).toContain(value)
    }
    expect(lines[0], code).not.toBe(lines[1])
  }
  const say = (lang: 'en' | 'de', code: string, kind: string) => tr(lang)(`features.coding.log.c.${code}`, logValues(code, { kind, url: MR }, (k) => tr(lang)(k)))
  expect(say('en', 'requestOpened', 'mr')).toBe(`Merge request opened: ${MR}`)
  expect(say('en', 'requestOpened', 'pr')).toBe(`Pull request opened: ${MR}`)
  expect(say('de', 'requestExisting', 'mr')).toBe(`Merge Request ist schon offen: ${MR}`)
  expect(say('en', 'requestLink', 'mr')).toBe(`No merge request opened — create it from the link: ${MR}`)
  // an unknown kind reads as a merge request
  expect(say('en', 'requestOpened', 'x')).toBe(`Merge request opened: ${MR}`)
  // the push-rejected hint names the Git tab's own keys, never a force
  for (const lang of ['en', 'de'] as const) {
    const l = tr(lang)('features.coding.log.c.pushRejected', { remote: 'origin' })
    expect(l).toContain(messages[lang]['features.coding.git.updateBase']!)
    expect(l).toContain(messages[lang]['features.coding.act.retry']!)
  }
})

test('Approvals history: kept in the order written (a clock set back reorders nothing), the default in effect at a creation time', () => {
  // written in this order; the second change's clock was set back an hour — it stays second, lifted past the first
  const list = readApprovalsHistory(JSON.stringify([{ l: 'none', u: 10_000 }, { l: 'all', u: 6_400 }, { l: 'x', u: 1 }, null, { l: 'review', u: Number.NaN }, { l: 'review', u: 20_000 }]))
  expect(list).toEqual([
    { l: 'none', u: 10_000 },
    { l: 'all', u: 10_001 },
    { l: 'review', u: 20_000 },
  ])
  expect(approvalsAt(5_000, list, 'all')).toBe('none')
  expect(approvalsAt(10_000, list, 'all')).toBe('all')
  expect(approvalsAt(15_000, list, 'none')).toBe('review')
  // after the last change, or ahead of it (another clock): today's — tasks.ts freezes it once resolved, setDefaultApprovals stamps those ahead
  expect(approvalsAt(25_000, list, 'none')).toBe('none')
  expect(approvalsAt(null, list, 'review')).toBe('review')
  expect(readApprovalsHistory('{')).toEqual([])
  expect(readApprovalsHistory(null)).toEqual([])
})
