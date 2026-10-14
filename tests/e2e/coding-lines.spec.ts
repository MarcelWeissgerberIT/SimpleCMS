/**
 * Coding worker 1.9.0, the app's side (Node only, no browser): the start / download lines per computer
 * (features/coding/startLines.ts — Windows: PowerShell + Command Prompt, quoted; macOS · Linux as before) and the
 * worker's log codes — every code in LOG_CODES has its EN and DE line, and the 1.9.0 codes render in both
 * languages with their values (nothing left in braces).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { detectOs, downloadLines, startLines } from '../../src/app/features/coding/startLines'
import { WORKER_WIN_SAFE, workerOldOnWindows } from '../../src/app/features/coding/winWorker'
import { messages } from '../../src/app/features/coding/messages'

const LINES_TS = fileURLToPath(new URL('../../src/app/features/coding/lines.ts', import.meta.url))

test('Windows gets a PowerShell and a Command Prompt line, the file quoted, both from USERPROFILE (never PowerShell 5.1\'s $HOME: HOMEDRIVE + HOMEPATH); macOS · Linux keep the sh line', () => {
  expect(startLines('one-worker.mjs', { os: 'windows' })).toEqual([
    { shell: 'powershell', line: 'node "$env:USERPROFILE\\Downloads\\one-worker.mjs"' },
    { shell: 'cmd', line: 'node "%USERPROFILE%\\Downloads\\one-worker.mjs"' },
  ])
  expect(startLines('one-worker.mjs', { os: 'posix' })).toEqual([{ shell: 'sh', line: 'node ~/Downloads/one-worker.mjs' }])
  // the manual setup: the home folder, fixed verbs, a port of its own
  expect(startLines('one-worker.mjs', { os: 'windows', dir: 'home', args: ['init', '--workspace', 'local:abc123'] }).map((l) => l.line)).toEqual([
    'node "$env:USERPROFILE\\one-worker.mjs" init --workspace local:abc123',
    'node "%USERPROFILE%\\one-worker.mjs" init --workspace local:abc123',
  ])
  expect(startLines('one-worker.mjs', { os: 'windows', dir: 'home', port: 47400 }).map((l) => l.line)).toEqual([
    "$env:ONE_WORKER_PORT = '47400'; node \"$env:USERPROFILE\\one-worker.mjs\"",
    'set "ONE_WORKER_PORT=47400" && node "%USERPROFILE%\\one-worker.mjs"',
  ])
  expect(startLines('one-worker.mjs', { os: 'posix', dir: 'home', port: 47400 })).toEqual([{ shell: 'sh', line: 'ONE_WORKER_PORT=47400 node ~/one-worker.mjs' }])
  // no port (or a nonsense one): no prefix
  expect(startLines('one-worker.mjs', { os: 'posix', dir: 'home', port: null })[0]!.line).toBe('node ~/one-worker.mjs')
  expect(startLines('one-worker.mjs', { os: 'posix', dir: 'home', port: 70000 })[0]!.line).toBe('node ~/one-worker.mjs')
  // PowerShell's $HOME is never used: 5.1 builds it from HOMEDRIVE + HOMEPATH (a network home on many company PCs)
  for (const os of ['windows', 'posix'] as const)
    for (const dir of ['downloads', 'home'] as const) for (const l of startLines('one-worker.mjs', { os, dir, port: 47400 })) expect(l.line).not.toContain('$HOME')
  for (const l of downloadLines('https://one.example.invalid/mcp/one-worker.mjs', 'one-worker.mjs', 'windows')) expect(l.line).not.toContain('$HOME')
  // nothing that a shell would read as more than a word ever goes into a line
  for (const bad of ['a b', 'x"y', '$HOME', '%PATH%', 'a&b', 'a;b', 'a|b', '`x`', "it's", 'a\nb'])
    expect(() => startLines('one-worker.mjs', { os: 'windows', args: ['init', '--workspace', bad] }), bad).toThrow()
  expect(() => startLines('one worker.mjs', { os: 'posix' })).toThrow()
})

test('the download lines: Invoke-WebRequest in PowerShell (its curl is an alias), curl.exe in cmd, curl in sh', () => {
  const url = 'https://one.example.invalid/mcp/one-worker.mjs'
  expect(downloadLines(url, 'one-worker.mjs', 'windows')).toEqual([
    { shell: 'powershell', line: `Invoke-WebRequest -UseBasicParsing "${url}" -OutFile "$env:USERPROFILE\\one-worker.mjs"` },
    { shell: 'cmd', line: `curl.exe -fsSL "${url}" -o "%USERPROFILE%\\one-worker.mjs"` },
  ])
  expect(downloadLines(url, 'one-worker.mjs', 'posix')).toEqual([{ shell: 'sh', line: `curl -fsSL ${url} -o ~/one-worker.mjs` }])
  for (const bad of ['ftp://x/y', 'https://x/a b', 'https://x/"y', 'https://x/$(y)', 'https://x/%PATH%']) expect(() => downloadLines(bad, 'one-worker.mjs', 'windows'), bad).toThrow()
})

test('the computer: the platform hint first, else the user agent', () => {
  expect(detectOs('Windows', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('windows')
  expect(detectOs('macOS', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('posix')
  expect(detectOs('Linux', '')).toBe('posix')
  expect(detectOs(undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
  expect(detectOs('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('posix')
})

test('a worker older than 1.9.0 is flagged only on Windows over a Local link — never macOS / Linux, never Cloud, never a version One cannot read', () => {
  expect(WORKER_WIN_SAFE).toBe('1.9.0')
  for (const v of ['1.8.1', '1.8.0', '1.1.0', '0.9.0', 'v1.8.1', ' 1.8.1 ', '1.8', '1.9.0-rc.1', '1.8.1+build.7', '1.8.99']) expect(workerOldOnWindows(v, 'local', 'windows'), v).toBe(true)
  for (const v of ['1.9.0', '1.9.1', '1.10.0', '2.0.0', '1.9.0+build.2', 'v1.9']) expect(workerOldOnWindows(v, 'local', 'windows'), v).toBe(false)
  for (const v of [null, undefined, '', 'dev', 'garbage', '1.x.0', '1'.repeat(65)]) expect(workerOldOnWindows(v, 'local', 'windows'), String(v)).toBe(false)
  // macOS · Linux never searched the working folder; a cloud worker runs on another computer whose system One does not know
  expect(workerOldOnWindows('1.8.1', 'local', 'posix')).toBe(false)
  expect(workerOldOnWindows('1.8.1', 'cloud', 'windows')).toBe(false)
  expect(workerOldOnWindows('1.1.0', 'cloud', 'posix')).toBe(false)
})

/** The codes of LOG_CODES as lines.ts lists them (it imports the app's runtime, so it is read, not imported). */
function logCodes(): string[] {
  const src = readFileSync(LINES_TS, 'utf8')
  const set = /export const LOG_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(src)![1]!
  return [...set.matchAll(/'([A-Za-z.]+)'/g)].map((m) => m[1]!)
}

/** The 1.9.0 codes with the values the worker sends (docs/CODING.md § Log codes). */
const WIN_CODES: Record<string, Record<string, string>> = {
  onedrive: { repo: 'shop' },
  cloudStorage: { repo: 'shop' },
  longpaths: {},
  sshHostKey: { remote: 'origin' },
  sshKey: { remote: 'origin' },
  gitSignIn: { remote: 'origin' },
  dubiousOwnership: { repo: 'shop' },
  gitLock: { repo: 'shop' },
  folderBusy: {},
  claudeMissing: {},
  claudeCmdRefused: {},
  commandMissing: { cmd: 'gradlew' },
  commandRefused: { cmd: 'run-tests.bat' },
}

test('every worker log code has its EN and DE line; the 1.9.0 codes render in both with their values', () => {
  const codes = logCodes()
  expect(codes.length).toBeGreaterThan(40)
  for (const code of Object.keys(WIN_CODES)) expect(codes, code).toContain(code)
  for (const code of codes) {
    expect(messages.en[`features.coding.log.c.${code}`], `en ${code}`).toBeTruthy()
    expect(messages.de[`features.coding.log.c.${code}`], `de ${code}`).toBeTruthy()
  }
  // the app's interpolate() (src/shared/i18n.ts — not importable under Node: brand.ts, which it imports, reads import.meta.env)
  const tr = (lang: 'en' | 'de') => (key: string, v: Record<string, string>) => messages[lang][key]!.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k]! : m))
  const en = tr('en')
  const de = tr('de')
  for (const [code, v] of Object.entries(WIN_CODES)) {
    const lines = [en(`features.coding.log.c.${code}`, v), de(`features.coding.log.c.${code}`, v)]
    for (const line of lines) {
      expect(line, code).not.toMatch(/\{\w+\}/)
      for (const value of Object.values(v)) expect(line, code).toContain(value)
    }
    expect(lines[0], code).not.toBe(lines[1])
  }
  // Windows' backslashes reach the line as one
  expect(en('features.coding.log.c.commandMissing', WIN_CODES.commandMissing!)).toContain('`.\\gradlew.bat`')
  expect(de('features.coding.log.c.onedrive', WIN_CODES.onedrive!)).toContain('C:\\code')
})
