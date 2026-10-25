/**
 * one-worker — exec.ts: how programs start. The Windows rules run on every OS with an injected platform and file
 * system: PATH only (never the working folder — a git.exe / claude.exe / npm.exe planted in a repo never runs),
 * PATHEXT, the shim reader against the shims npm, pnpm / corepack, Node's installer and scoop write, the policies,
 * the cmd.exe escaping against cross-spawn 7.0.6. Then on this OS: never a throw, time limits, the tree kill, the
 * crash safety of the worker, and the source guard (only exec.ts starts programs).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, test } from 'node:test'
import { BY_NAME, cmdLine, commandName, envGet, execFileSafe, execFileSyncSafe, fromCwd, inSystemRoot, isFile, killTree, noCwdLookup, ownEnv, pathAbsolute, pathKey, plantedProgram, programName, programsOnPath, readShim, resolveCommand, spawnForm, spawnSafe, systemRoots, systemTool, type Allow, type ExecCtx, type Resolved } from '../src/worker/exec.ts'
import { pathId, samePath } from '../src/worker/paths.ts'
import { detectClaude, gitBash } from '../src/worker/claude.ts'
import { runAnalysis, runTests } from '../src/worker/testrun.ts'
import { browserCommand } from '../src/worker/opener.ts'
import { pickerCommand } from '../src/worker/picker.ts'
import { listenError } from '../src/worker/link.ts'
import { emptyConfig, type RepoConfig } from '../src/worker/config.ts'
import { Worker } from '../src/worker/worker.ts'
import { WORKER_BUNDLE, cleanupAll, cmdShimV7, fakeBin, pathWith, tempDir } from './worker-helpers.ts'

after(cleanupAll)

/* ------------------------------------------------------------------ fixtures */

const crlf = (lines: string[]) => `${lines.join('\r\n')}\r\n`

// npm's cmd-shim 7.0.0 (npm 10.9.4 / Node 22) — written by cmd-shim itself for a bin with `#!/usr/bin/env node`
// (cmd-shim 6.0.3 of npm 10 / Node 20 writes the same bytes)
const SHIM_V7 = cmdShimV7(String.raw`node_modules\@anthropic-ai\claude-code\cli.js`)
// cmd-shim 7.0.0, a bin with `#!/usr/bin/env node --max-old-space-size=4096`
const SHIM_V7_FLAGS = crlf([
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  String.raw`IF EXIST "%dp0%\node.exe" (`,
  String.raw`  SET "_prog=%dp0%\node.exe"`,
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" --max-old-space-size=4096 "%dp0%\node_modules\flagged\run.js" %*`,
])
// cmd-shim 7.0.0, a bin without a shebang (an .exe)
const SHIM_V7_EXE = crlf(['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', String.raw`"%dp0%\node_modules\tool\bin\tool.exe"   %*`])
// cmd-shim 7.0.0, a bin with `#!/bin/sh` — not Node: the reader does not know it
const SHIM_V7_SH = crlf([
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  String.raw`IF EXIST "%dp0%\/bin/sh.exe" (`,
  String.raw`  SET "_prog=%dp0%\/bin/sh.exe"`,
  ') ELSE (',
  '  SET "_prog=/bin/sh"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\tool\bin\hello.sh" %*`,
])
// cmd-shim 4.0 (npm 7.0 – 7.5), written from its source: the command first, :find_dp0 at the end
const SHIM_V4 = crlf([
  '@ECHO off',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  String.raw`IF EXIST "%dp0%\node.exe" (`,
  String.raw`  SET "_prog=%dp0%\node.exe"`,
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  String.raw`"%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*`,
  'ENDLOCAL',
  'EXIT /b %errorlevel%',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
])
// @zkochan/cmd-shim (pnpm) as corepack ships it (Node 22: corepack/shims/nodewin/npm.cmd)
const SHIM_PNPM = crlf([
  '@SETLOCAL',
  String.raw`@IF EXIST "%~dp0\node.exe" (`,
  String.raw`  "%~dp0\node.exe"  "%~dp0\node_modules\corepack\dist\npm.js" %*`,
  ') ELSE (',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  String.raw`  node  "%~dp0\node_modules\corepack\dist\npm.js" %*`,
  ')',
])
// @zkochan/cmd-shim with a nodePath (pnpm's global bins), written from its source
const SHIM_PNPM_NODE_PATH = crlf([
  '@SETLOCAL',
  '@IF NOT DEFINED NODE_PATH (',
  String.raw`  @SET "NODE_PATH=C:\Users\Max Muster\AppData\Local\pnpm\global\5\node_modules"`,
  ') ELSE (',
  String.raw`  @SET "NODE_PATH=C:\Users\Max Muster\AppData\Local\pnpm\global\5\node_modules;%NODE_PATH%"`,
  ')',
  String.raw`@IF EXIST "%~dp0\node.exe" (`,
  String.raw`  "%~dp0\node.exe"  "%~dp0\global\5\node_modules\eslint\bin\eslint.js" %*`,
  ') ELSE (',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  String.raw`  node  "%~dp0\global\5\node_modules\eslint\bin\eslint.js" %*`,
  ')',
])
// Node's installer: npm.cmd / npx.cmd of npm 10.9.4 (Node 22), verbatim
const NPM_CMD = (cli: 'npm' | 'npx') =>
  crlf([
    ":: Created by npm, please don't edit manually.",
    '@ECHO OFF',
    '',
    'SETLOCAL',
    '',
    String.raw`SET "NODE_EXE=%~dp0\node.exe"`,
    'IF NOT EXIST "%NODE_EXE%" (',
    '  SET "NODE_EXE=node"',
    ')',
    '',
    String.raw`SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"`,
    `SET "${cli.toUpperCase()}_CLI_JS=%~dp0\\node_modules\\npm\\bin\\${cli}-cli.js"`,
    `FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (`,
    `  SET "NPM_PREFIX_${cli.toUpperCase()}_CLI_JS=%%F\\node_modules\\npm\\bin\\${cli}-cli.js"`,
    ')',
    `IF EXIST "%NPM_PREFIX_${cli.toUpperCase()}_CLI_JS%" (`,
    `  SET "${cli.toUpperCase()}_CLI_JS=%NPM_PREFIX_${cli.toUpperCase()}_CLI_JS%"`,
    ')',
    '',
    `"%NODE_EXE%" "%${cli.toUpperCase()}_CLI_JS%" %*`,
  ])
// npm 6 / 7's npm.cmd (Node 14 – 16): the prefix asked with `npm-cli.js prefix -g`
const NPM_CMD_OLD = NPM_CMD('npm')
  .replace(String.raw`SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"` + '\r\n', '')
  .replace(`'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"'`, `'CALL "%NODE_EXE%" "%NPM_CLI_JS%" prefix -g'`)
// scoop's .cmd shim: a forwarder to an absolute program
const SHIM_SCOOP = crlf([String.raw`@rem C:\Users\Max Muster\scoop\apps\gh\current\bin\gh.exe`, String.raw`@"C:\Users\Max Muster\scoop\apps\gh\current\bin\gh.exe" %*`])
const SHIM_PWSH = crlf(['@ECHO off', String.raw`pwsh -NoProfile -File "%~dp0\tool.ps1" %*`])

/** A Windows disk: case-free paths. */
function disk(files: Record<string, string>): Pick<ExecCtx, 'exists' | 'readFile'> {
  const map = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]))
  return { exists: (p) => map.has(p.toLowerCase()), readFile: (p) => map.get(p.toLowerCase()) ?? null }
}

const NODE = String.raw`C:\Program Files\nodejs\node.exe`
const win = (files: Record<string, string>, env: NodeJS.ProcessEnv = {}, cwd = String.raw`C:\repo`): ExecCtx => ({ platform: 'win32', env, cwd, execPath: NODE, ...disk(files) })

const NPM_DIR = String.raw`C:\Users\Max Muster\AppData\Roaming\npm`
const CLAUDE_JS = String.raw`C:\Users\Max Muster\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js`

/* ------------------------------------------------------------------ Windows resolution */

describe('exec — Windows resolution (injected platform)', () => {
  test('a bare name: PATH only, directory by directory, PATHEXT order inside one directory', () => {
    const files = { [String.raw`C:\a\tool.cmd`]: SHIM_V7_EXE, [String.raw`C:\a\node_modules\tool\bin\tool.exe`]: 'MZ', [String.raw`C:\b\tool.exe`]: 'MZ', [String.raw`C:\c\both.exe`]: 'MZ', [String.raw`C:\c\both.cmd`]: SHIM_PWSH, [String.raw`C:\c\only.ps1`]: '' }
    // the first directory wins, whatever extension the next one has
    assert.deepEqual(resolveCommand('tool', ['x'], win(files, { PATH: String.raw`C:\a;C:\b` })), { ok: true, file: String.raw`C:\a\node_modules\tool\bin\tool.exe`, args: ['x'], via: 'direct', verbatim: false })
    assert.equal((resolveCommand('tool', [], win(files, { PATH: String.raw`C:\b;C:\a` })) as { file: string }).file, String.raw`C:\b\tool.exe`)
    // inside one directory: PATHEXT order (default .COM;.EXE;.BAT;.CMD)
    assert.equal((resolveCommand('both', [], win(files, { PATH: String.raw`C:\c` })) as { file: string }).file, String.raw`C:\c\both.exe`)
    const cmdFirst = resolveCommand('both', [], win(files, { PATH: String.raw`C:\c`, PATHEXT: '.CMD;.EXE' }), 'person')
    assert.equal(cmdFirst.ok && cmdFirst.via, 'comspec')
    // .PS1 / .JS in PATHEXT start nothing
    assert.equal(resolveCommand('only', [], win(files, { PATH: String.raw`C:\c`, PATHEXT: '.COM;.EXE;.PS1;.JS' })).ok, false)
    // a name with its extension is looked for as it is
    assert.equal((resolveCommand('tool.exe', [], win(files, { PATH: String.raw`C:\a;C:\b` })) as { file: string }).file, String.raw`C:\b\tool.exe`)
  })

  test('"Path" and PATH: the key Node hands the child; quoted entries; relative entries and the working folder never', () => {
    const files = { [String.raw`C:\right\git.exe`]: 'MZ', [String.raw`C:\wrong\git.exe`]: 'MZ', [String.raw`C:\Program Files\Git\cmd\git.exe`]: 'MZ', [String.raw`C:\repo\git.exe`]: 'MZ', [String.raw`C:\repo\bin\git.exe`]: 'MZ' }
    assert.equal((resolveCommand('git', [], win(files, { Path: String.raw`C:\right` }), 'exe') as { file: string }).file, String.raw`C:\right\git.exe`)
    // both spellings: Node gives the child the first in sorted order ("PATH" < "Path") — the same one is read
    assert.equal(pathKey({ Path: 'x', PATH: 'y' }, 'win32'), 'PATH')
    assert.equal(envGet({ Path: String.raw`C:\wrong`, PATH: String.raw`C:\right` }, 'path', 'win32'), String.raw`C:\right`)
    assert.equal((resolveCommand('git', [], win(files, { Path: String.raw`C:\wrong`, PATH: String.raw`C:\right` }), 'exe') as { file: string }).file, String.raw`C:\right\git.exe`)
    assert.equal(pathKey({}, 'win32'), 'Path')
    assert.equal(pathKey({ Path: 'x' }, 'linux'), 'PATH')
    assert.equal((resolveCommand('git', [], win(files, { PATH: String.raw`"C:\Program Files\Git\cmd"` }), 'exe') as { file: string }).file, String.raw`C:\Program Files\Git\cmd\git.exe`)
    // ".", "bin", a drive-relative "\x": skipped — they would be looked up from the repository
    const rel = resolveCommand('git', [], win(files, { PATH: String.raw`.;bin;\repo;;` }), 'exe')
    assert.deepEqual(rel, { ok: false, code: 127, why: 'missing', error: 'git was not found (PATH only, never the working folder)' })
  })

  test('cwd plant: a git.exe / claude.exe / npm.exe at the root of the repository never runs', () => {
    const repo = String.raw`C:\Users\Max Muster\one-repos\shop`
    const files = { [`${repo}\\git.exe`]: 'MZ', [`${repo}\\claude.exe`]: 'MZ', [`${repo}\\npm.exe`]: 'MZ', [String.raw`C:\Program Files\Git\cmd\git.exe`]: 'MZ' }
    const env = { PATH: String.raw`C:\Program Files\Git\cmd;C:\Users\Max Muster\AppData\Roaming\npm` }
    assert.equal((resolveCommand('git', ['status'], win(files, env, repo), 'exe') as { file: string }).file, String.raw`C:\Program Files\Git\cmd\git.exe`)
    assert.deepEqual(resolveCommand('claude', ['-p'], win(files, env, repo)), { ok: false, code: 127, why: 'missing', error: 'claude was not found (PATH only, never the working folder)' })
    assert.equal(resolveCommand('npm', ['test'], win(files, env, repo), 'person').ok, false)
    // through spawnSafe too: the child's cwd is the repo — the lookup never is
    const s = spawnSafe('claude', ['-p'], { cwd: repo, env, ctx: { platform: 'win32', ...disk(files) }, stdio: 'ignore' })
    assert.deepEqual(s, { ok: false, code: 127, why: 'missing', error: 'claude was not found (PATH only, never the working folder)' })
  })

  test('a name with a folder is the person\'s own path: resolved against the working folder, as written, then PATHEXT', () => {
    const files = { [String.raw`C:\repo\gradlew`]: '#!/bin/sh', [String.raw`C:\repo\gradlew.bat`]: '@echo off\r\nsetlocal enabledelayedexpansion\r\n', [String.raw`C:\tools\x.exe`]: 'MZ', [String.raw`C:\repo\tools\lint.cmd`]: SHIM_PWSH }
    // `.\gradlew test` on Windows: the sh script is skipped, gradlew.bat (unreadable as a shim) runs through cmd.exe — person only
    const g = resolveCommand('./gradlew', ['test'], win(files, { ComSpec: String.raw`C:\Windows\system32\cmd.exe` }), 'person')
    // resolved: the absolute file (what `check` would show); the spawn names it from its own working folder (spawnForm)
    assert.deepEqual(g, { ok: true, file: String.raw`C:\Windows\System32\cmd.exe`, args: ['/d', '/v:off', '/s', '/c', String.raw`"C:\repo\gradlew.bat ^"test^""`], via: 'comspec', verbatim: true, line: { argv: [String.raw`C:\repo\gradlew.bat`, 'test'], double: false } })
    assert.deepEqual(g.ok && spawnForm(g, String.raw`C:\repo`, 'win32'), { file: String.raw`C:\Windows\System32\cmd.exe`, args: ['/d', '/v:off', '/s', '/c', String.raw`".\gradlew.bat ^"test^""`] })
    assert.equal(resolveCommand(String.raw`.\gradlew.bat`, ['test'], win(files), 'shim').ok, false)
    assert.deepEqual(resolveCommand(String.raw`C:\tools\x`, ['-a'], win(files)), { ok: true, file: String.raw`C:\tools\x.exe`, args: ['-a'], via: 'direct', verbatim: false })
    const lint = resolveCommand('tools/lint', [], win(files), 'person')
    assert.equal(lint.ok && spawnForm(lint, String.raw`C:\repo`, 'win32').args[4], String.raw`".\tools\lint.cmd"`)
    // CLAUDE_BIN = Claude Code's cli.js: this Node runs it
    assert.deepEqual(resolveCommand(CLAUDE_JS, ['--version'], win({ [CLAUDE_JS]: '' })), { ok: true, file: NODE, args: [CLAUDE_JS, '--version'], via: 'node-shim', verbatim: false, script: 0 })
    // .ps1 / .vbs / no extension: not a program the worker starts
    assert.equal(resolveCommand(String.raw`C:\tools\run.ps1`, [], win({ [String.raw`C:\tools\run.ps1`]: '' }), 'person').ok, false)
  })

  test('resolution reads the CHILD\'s env (opts.env), never this process\'s', () => {
    const files = { [String.raw`C:\child\tool.exe`]: 'MZ', [String.raw`C:\mine\tool.exe`]: 'MZ' }
    const before = process.env.PATH
    process.env.PATH = String.raw`C:\mine`
    try {
      const s = spawnSafe('tool', [], { env: { PATH: String.raw`C:\child` }, ctx: { platform: 'win32', ...disk(files) }, stdio: 'ignore' })
      assert.ok(s.ok)
      // (on this OS the Windows path cannot start: its 'error' event is the child's)
      s.child.on('error', () => {})
      assert.equal(s.file, String.raw`C:\child\tool.exe`)
      assert.equal(resolveCommand('tool', [], { platform: 'win32', ...disk(files) }).ok, true)
    } finally {
      process.env.PATH = before
    }
  })

  test('npm\'s cmd-shim v4 and v6–v7 → this Node (or node.exe beside the shim) with the script — exact', () => {
    const claude = `${NPM_DIR}\\claude.cmd`
    for (const text of [SHIM_V7, SHIM_V4]) {
      const r = resolveCommand('claude', ['-p', '--model', 'x y'], win({ [claude]: text, [CLAUDE_JS]: '' }, { PATH: NPM_DIR }))
      assert.deepEqual(r, { ok: true, file: NODE, args: [CLAUDE_JS, '-p', '--model', 'x y'], via: 'node-shim', verbatim: false, script: 0 })
    }
    // a node.exe beside the shim is the one it would take
    const near = `${NPM_DIR}\\node.exe`
    assert.equal((resolveCommand('claude', [], win({ [claude]: SHIM_V7, [CLAUDE_JS]: '', [near]: 'MZ' }, { PATH: NPM_DIR })) as { file: string }).file, near)
    // the shebang's flags come along, before the script
    const flagged = `${NPM_DIR}\\flagged.cmd`
    const run = `${NPM_DIR}\\node_modules\\flagged\\run.js`
    assert.deepEqual(resolveCommand('flagged', ['a'], win({ [flagged]: SHIM_V7_FLAGS, [run]: '' }, { PATH: NPM_DIR })), { ok: true, file: NODE, args: ['--max-old-space-size=4096', run, 'a'], via: 'node-shim', verbatim: false, script: 1 })
    // a bin without a shebang: its .exe
    const tool = `${NPM_DIR}\\tool.cmd`
    const exe = `${NPM_DIR}\\node_modules\\tool\\bin\\tool.exe`
    assert.deepEqual(resolveCommand('tool', ['a'], win({ [tool]: SHIM_V7_EXE, [exe]: 'MZ' }, { PATH: NPM_DIR })), { ok: true, file: exe, args: ['a'], via: 'direct', verbatim: false })
    // the script must exist
    assert.equal(resolveCommand('claude', [], win({ [claude]: SHIM_V7 }, { PATH: NPM_DIR })).ok, false)
    // a script without an extension counts with a node shebang only
    const bare = String.raw`C:\b\node_modules\x\bin\x`
    const shim = crlf([...SHIM_V7.split('\r\n').slice(0, 16), String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\x\bin\x" %*`])
    assert.equal(resolveCommand('x', [], win({ [String.raw`C:\b\x.cmd`]: shim, [bare]: '#!/usr/bin/env node\nconsole.log(1)' }, { PATH: String.raw`C:\b` })).ok, true)
    assert.equal(resolveCommand('x', [], win({ [String.raw`C:\b\x.cmd`]: shim, [bare]: '#!/usr/bin/env python3\n' }, { PATH: String.raw`C:\b` })).ok, false)
  })

  test('pnpm / corepack shims → node-shim; NODE_PATH as the shim sets it', () => {
    const dir = String.raw`C:\Program Files\nodejs`
    const npm = `${dir}\\npm.cmd`
    const js = `${dir}\\node_modules\\corepack\\dist\\npm.js`
    assert.deepEqual(resolveCommand('npm', ['test'], win({ [npm]: SHIM_PNPM, [js]: '', [NODE]: 'MZ' }, { PATH: dir })), { ok: true, file: NODE, args: [js, 'test'], via: 'node-shim', verbatim: false, script: 0 })
    const pnpm = String.raw`C:\Users\Max Muster\AppData\Local\pnpm`
    const eslint = `${pnpm}\\global\\5\\node_modules\\eslint\\bin\\eslint.js`
    const np = String.raw`C:\Users\Max Muster\AppData\Local\pnpm\global\5\node_modules`
    const files = { [`${pnpm}\\eslint.cmd`]: SHIM_PNPM_NODE_PATH, [eslint]: '' }
    assert.deepEqual(resolveCommand('eslint', ['.'], win(files, { PATH: pnpm })), { ok: true, file: NODE, args: [eslint, '.'], via: 'node-shim', verbatim: false, script: 0, env: { NODE_PATH: np } })
    assert.deepEqual((resolveCommand('eslint', ['.'], win(files, { PATH: pnpm, Node_Path: String.raw`D:\libs` })) as { env: unknown }).env, { Node_Path: `${np};D:\\libs` })
  })

  test('Node\'s own npm.cmd / npx.cmd → the bundled npm-cli.js / npx-cli.js (the prefix redirect is not followed)', () => {
    const dir = String.raw`C:\Program Files\nodejs`
    for (const [cli, text] of [['npm', NPM_CMD('npm')], ['npx', NPM_CMD('npx')], ['npm', NPM_CMD_OLD]] as const) {
      const js = `${dir}\\node_modules\\npm\\bin\\${cli}-cli.js`
      const r = resolveCommand(cli, ['test'], win({ [`${dir}\\${cli}.cmd`]: text, [js]: '', [NODE]: 'MZ' }, { Path: `C:\\Windows\\system32;${dir}` }), 'person')
      assert.deepEqual(r, { ok: true, file: NODE, args: [js, 'test'], via: 'node-shim', verbatim: false, script: 0 })
    }
    // without node.exe beside it: this Node, never a PATH node
    const js = `${dir}\\node_modules\\npm\\bin\\npm-cli.js`
    const r = resolveCommand('npm', [], { ...win({ [`${dir}\\npm.cmd`]: NPM_CMD('npm'), [js]: '', [String.raw`C:\other\node.exe`]: 'MZ' }, { PATH: `C:\\other;${dir}` }), execPath: String.raw`C:\mine\node.exe` })
    assert.equal((r as { file: string }).file, String.raw`C:\mine\node.exe`)
  })

  test('forwarders (scoop): followed to the program, at most 3 deep', () => {
    const shims = String.raw`C:\Users\Max Muster\scoop\shims`
    const gh = String.raw`C:\Users\Max Muster\scoop\apps\gh\current\bin\gh.exe`
    assert.deepEqual(resolveCommand('gh', ['pr', 'view'], win({ [`${shims}\\gh.cmd`]: SHIM_SCOOP, [gh]: 'MZ' }, { PATH: shims })), { ok: true, file: gh, args: ['pr', 'view'], via: 'direct', verbatim: false })
    const fwd = (to: string) => crlf([`@"${to}" %*`])
    const chain = (n: number) => {
      const files: Record<string, string> = { [String.raw`C:\t\x.exe`]: 'MZ' }
      for (let i = 0; i < n; i++) files[`C:\\t\\s${i}.cmd`] = fwd(i === n - 1 ? String.raw`C:\t\x.exe` : `C:\\t\\s${i + 1}.cmd`)
      return resolveCommand('s0', [], win(files, { PATH: String.raw`C:\t` }))
    }
    assert.equal(chain(3).ok, true)
    assert.equal(chain(4).ok, false)
    // git: an .exe only — never a shim, whatever it forwards to
    const git = resolveCommand('git', [], win({ [`${shims}\\git.cmd`]: SHIM_SCOOP.replaceAll('gh', 'git'), [gh.replaceAll('gh', 'git')]: 'MZ' }, { PATH: shims }), 'exe')
    assert.equal(git.ok, false)
    assert.equal(!git.ok && git.why, 'refused')
  })

  test('shims the reader does not know: refused for Claude Code / gh / glab, cmd.exe only for the person\'s own commands', () => {
    const t = String.raw`C:\t`
    const files = {
      [`${t}\\hello.cmd`]: SHIM_V7_SH,
      [`${t}\\node_modules\\tool\\bin\\hello.sh`]: '',
      [`${t}\\tool.cmd`]: SHIM_PWSH,
      [`${t}\\evil.cmd`]: SHIM_V7.replace('CALL :find_dp0', 'CALL :find_dp0\r\nCALL calc.exe'),
      [`${t}\\tail.cmd`]: SHIM_V7.replace('%*\r\n', '%* & calc.exe\r\n'),
      [`${t}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: '',
      [String.raw`C:\Windows\system32\cmd.exe`]: 'MZ',
    }
    const env = { PATH: t, ComSpec: String.raw`C:\Windows\system32\cmd.exe` }
    for (const name of ['hello', 'tool', 'evil', 'tail']) {
      const r = resolveCommand(name, ['a&b'], win(files, env), 'shim')
      assert.equal(r.ok, false, name)
      assert.equal(!r.ok && r.why, 'refused', name)
      assert.equal(!r.ok && r.error, `${name} is a .cmd file the worker cannot read as a shim — it never starts it through cmd.exe`)
      assert.deepEqual(resolveCommand(name, ['a&b'], win(files, env), 'person'), { ok: true, file: String.raw`C:\Windows\system32\cmd.exe`, args: ['/d', '/v:off', '/s', '/c', `"C:\\t\\${name}.cmd ^"a^&b^""`], via: 'comspec', verbatim: true, line: { argv: [`C:\\t\\${name}.cmd`, 'a&b'], double: false } })
      assert.equal(resolveCommand(name, [], win(files, env), 'exe').ok, false)
    }
    // the reader directly
    const ctx = win(files, env)
    assert.equal(readShim(SHIM_V7_SH, `${t}\\hello.cmd`, ctx), null)
    assert.equal(readShim(SHIM_PWSH, `${t}\\tool.cmd`, ctx), null)
    assert.deepEqual(readShim(SHIM_V7, `${t}\\claude.cmd`, ctx), { kind: 'node', node: NODE, script: `${t}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, pre: [] })
    // a variable or a quote smuggled into the target path
    assert.equal(readShim(SHIM_V7.replace('claude-code', '%USERPROFILE%'), `${t}\\claude.cmd`, ctx), null)
    // a person's command through cmd.exe cannot carry a line break
    const nl = resolveCommand('hello', ['two\nlines'], win(files, env), 'person')
    assert.deepEqual(nl, { ok: false, code: 127, why: 'refused', error: 'hello runs through cmd.exe, which cannot pass an argument with a line break' })
  })

  test('macOS / Linux: every case unchanged (the system looks the program up)', () => {
    const files = { [String.raw`C:\repo\git.exe`]: 'MZ', '/repo/git': '', '/usr/bin/git': '' }
    for (const platform of ['linux', 'darwin'] as const)
      for (const [cmd, args, allow] of [['git', ['status'], 'exe'], ['claude', ['-p'], 'shim'], ['./gradlew', ['test'], 'person'], [CLAUDE_JS, [], 'shim'], ['npm', ['a&b', 'x\ny'], 'person']] as Array<[string, string[], Allow]>)
        assert.deepEqual(resolveCommand(cmd, args, { platform, env: { PATH: '/usr/bin', PATHEXT: '.CMD' }, cwd: '/repo', execPath: '/usr/bin/node', ...disk(files) }, allow), { ok: true, file: cmd, args, via: 'direct', verbatim: false })
  })
})

/* ------------------------------------------------------------------ the working folder (Windows) */

describe('exec — a child never looks in its working folder, and that folder never reaches a command line (Windows)', () => {
  test('noCwdLookup: a Windows child gets NoDefaultCurrentDirectoryInExePath (one of the person\'s, in any case, is kept); elsewhere nothing changes', () => {
    const env: NodeJS.ProcessEnv = { PATH: String.raw`C:\tools` }
    assert.deepEqual(noCwdLookup(env, 'win32'), { PATH: String.raw`C:\tools`, NoDefaultCurrentDirectoryInExePath: '1' })
    assert.equal('NoDefaultCurrentDirectoryInExePath' in env, false, 'the caller\'s object stays as it was')
    const own = { nodefaultcurrentdirectoryinexepath: '0' }
    assert.equal(noCwdLookup(own, 'win32'), own)
    assert.equal(noCwdLookup(env, 'linux'), env)
    assert.equal(noCwdLookup(env, 'darwin'), env)
  })

  test('every program the worker starts by itself carries it on Windows — spawnSafe, execFileSafe, execFileSyncSafe, with or without an env of the caller\'s (none elsewhere); the person\'s own commands never get it', async () => {
    const probe = ['-e', 'process.stdout.write(String(process.env.NoDefaultCurrentDirectoryInExePath))']
    const want = process.platform === 'win32' ? '1' : 'undefined'
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of Object.keys(env)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[k]
    assert.equal((await execFileSafe(process.execPath, probe, { timeoutMs: 20_000, env })).stdout, want)
    assert.equal(execFileSyncSafe(process.execPath, probe, { timeoutMs: 20_000, env }).stdout, want)
    // testCommand / analyzeCommand, ONE_WORKER_BROWSER / _PICKER (allow 'person'): their scripts may call `gradlew` by its
    // bare name in their own folder — their environment as it is, on every OS
    assert.equal((await execFileSafe(process.execPath, probe, { timeoutMs: 20_000, env, allow: 'person' })).stdout, 'undefined')
    assert.equal(execFileSyncSafe(process.execPath, probe, { timeoutMs: 20_000, env, allow: 'person' }).stdout, 'undefined')
    // the test stage (the worker's own environment without the variable, as a person's terminal has it)
    const had = Object.entries(process.env).filter(([k]) => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath')
    for (const [k] of had) delete process.env[k]
    try {
      const tested = await runTests({ testCommand: [process.execPath, ...probe], testTimeoutSec: 20 } as unknown as RepoConfig, tmpdir(), new AbortController().signal)
      assert.equal(tested.output, 'undefined')
    } finally {
      for (const [k, v] of had) process.env[k] = v
    }
    if (!Object.keys(process.env).some((k) => k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath')) assert.equal((await execFileSafe(process.execPath, probe, { timeoutMs: 20_000 })).stdout, want)
    const s = spawnSafe(process.execPath, probe, { env, stdio: ['ignore', 'pipe', 'ignore'] })
    assert.ok(s.ok)
    let out = ''
    s.child.stdout!.on('data', (d: Buffer) => (out += d.toString()))
    await new Promise((r) => s.child.on('close', r))
    assert.equal(out, want)
  })

  test('a file inside the working folder is named from there — at the spawn, from that spawn\'s folder: the folder (a worktree named after a branch) never reaches argv[0], a script argument or a cmd.exe line; what resolves stays absolute', () => {
    // a folder named with everything cmd.exe reads (as a branch from One or a remote could have named a worktree)
    const wt = String.raw`C:\Users\Max\.one-worktrees\shop\fix=1&calc^%x!y,z;(w) q`
    const files = {
      [`${wt}\\gradlew.bat`]: '@echo off\r\nsetlocal enabledelayedexpansion\r\n',
      [`${wt}\\tools\\x.exe`]: 'MZ',
      [`${wt}\\scripts\\test.mjs`]: '',
      [`${wt}\\node_modules\\.bin\\vitest.cmd`]: cmdShimV7(String.raw`..\vitest\vitest.mjs`),
      [`${wt}\\node_modules\\vitest\\vitest.mjs`]: '',
      [String.raw`C:\tools\lint.bat`]: '@echo off\r\nsetlocal\r\n',
    }
    const ctx = win(files, { PATH: String.raw`C:\tools` }, wt)
    type Ok = Extract<Resolved, { ok: true }>
    const at = (r: Resolved, cwd = wt) => {
      assert.ok(r.ok, JSON.stringify(r))
      return spawnForm(r as Ok, cwd, 'win32')
    }
    const bat = resolveCommand(String.raw`.\gradlew.bat`, ['test'], ctx, 'person')
    assert.deepEqual(at(bat), { file: String.raw`C:\Windows\System32\cmd.exe`, args: ['/d', '/v:off', '/s', '/c', String.raw`".\gradlew.bat ^"test^""`] })
    assert.deepEqual(at(resolveCommand('tools/x', ['-a'], ctx, 'person')), { file: String.raw`.\tools\x.exe`, args: ['-a'] })
    assert.deepEqual(at(resolveCommand(String.raw`.\scripts\test.mjs`, ['--ci'], ctx, 'person')), { file: NODE, args: [String.raw`.\scripts\test.mjs`, '--ci'] })
    assert.deepEqual(at(resolveCommand(String.raw`.\node_modules\.bin\vitest.cmd`, ['run'], ctx, 'person')), { file: NODE, args: [String.raw`.\node_modules\vitest\vitest.mjs`, 'run'] })
    // only the script is named from the folder: an ARGUMENT that happens to be a path inside it stays as given
    assert.deepEqual(at(resolveCommand(String.raw`.\scripts\test.mjs`, [`${wt}\\x`], ctx, 'person')).args, [String.raw`.\scripts\test.mjs`, `${wt}\\x`])
    // outside the folder: as found — the person's PATH, this Node
    const lint = resolveCommand('lint', ['x'], ctx, 'person')
    assert.equal(at(lint).args[4], String.raw`"C:\tools\lint.bat ^"x^""`)
    for (const r of [bat, lint, resolveCommand('tools/x', [], ctx), resolveCommand(String.raw`.\scripts\test.mjs`, [], ctx), resolveCommand(String.raw`.\node_modules\.bin\vitest.cmd`, [], ctx)]) {
      const run = at(r)
      const line = [run.file, ...run.args].join(' ')
      for (const part of ['.one-worktrees', 'shop', 'fix', 'calc', 'Max']) assert.ok(!line.includes(part), `${part} in ${line}`)
    }
    // what resolves stays absolute — a file resolved for one folder and started from ANOTHER (Claude Code: found at the
    // worker's start, run in a task's worktree) is named from that other folder, or by its path
    const js = String.raw`C:\Users\Max\one-worker\tools\claude\cli.js`
    const r = resolveCommand(js, ['-p'], { ...win({ [js]: '' }), cwd: String.raw`C:\Users\Max\one-worker` }) as Ok
    assert.deepEqual(r.args, [js, '-p'])
    assert.deepEqual(spawnForm(r, String.raw`C:\Users\Max\.one-worktrees\shop\t1`, 'win32').args, [js, '-p'])
    assert.deepEqual(spawnForm(r, String.raw`C:\Users\Max\one-worker`, 'win32').args, [String.raw`.\tools\claude\cli.js`, '-p'])
    // macOS / Linux: as resolved
    assert.deepEqual(spawnForm({ ok: true, file: 'git', args: ['status'], via: 'direct', verbatim: false }, '/repo', 'linux'), { file: 'git', args: ['status'] })
    assert.equal(fromCwd(String.raw`C:\a\b\c.exe`, String.raw`c:\A`), String.raw`.\b\c.exe`)
    assert.equal(fromCwd(String.raw`C:\a\c.exe`, String.raw`C:\a\b`), String.raw`C:\a\c.exe`)
    assert.equal(fromCwd(String.raw`D:\a\c.exe`, String.raw`C:\a`), String.raw`D:\a\c.exe`)
  })

  test('plantedProgram (Windows): a program a lookup by name could take at the top of a folder — its name only; build scripts, folders and other systems never', () => {
    const at = (names: string[], env: NodeJS.ProcessEnv = {}, more: string[] = []) => plantedProgram(String.raw`C:\repo`, { platform: 'win32', env, list: () => names, names: more })
    assert.equal(at(['README.md', 'gradlew', 'gradlew.bat', 'build.cmd', 'mvnw.cmd', 'make.bat', 'setup.py', 'env.js', 'index.js', 'gitk.exe', '.git']), null)
    assert.equal(at(['src', 'git.exe']), 'git.exe')
    assert.equal(at(['CLAUDE.EXE']), 'CLAUDE.EXE')
    assert.equal(at(['npm.cmd']), 'npm.cmd')
    // cross-spawn runs a .js it found through cmd.exe: the Windows Script Host would start it
    assert.equal(at(['node.js']), 'node.js')
    // PowerShell scripts count too
    assert.equal(at(['git.ps1']), 'git.ps1')
    // Windows drops a trailing dot or space
    assert.equal(at(['git.exe.']), 'git.exe.')
    // the person's PATHEXT counts too
    assert.equal(at(['python.py']), null)
    assert.equal(at(['python.py'], { PATHEXT: '.COM;.EXE;.BAT;.CMD;.PY' }), 'python.py')
    // the usual MCP launchers, whatever is installed (D1 (c))
    for (const n of ['uvx.cmd', 'uv.exe', 'docker.bat', 'bunx.cmd', 'deno.exe', 'podman.exe', 'pipx.cmd', 'java.exe', 'dotnet.exe']) assert.equal(at([n]), n, n)
    for (const n of ['uvx', 'docker', 'deno', 'dotnet', 'java', 'pipx', 'podman', 'bunx', 'uv']) assert.ok(BY_NAME.includes(n), n)
    // the launchers of the person's own MCP servers (run.ts reads them from Claude Code's config)
    assert.equal(at(['kb-server.cmd']), null)
    assert.equal(at(['KB-Server.cmd'], {}, ['kb-server']), 'KB-Server.cmd')
    // the same name every time (sorted)
    assert.equal(at(['git.exe', 'claude.exe']), 'claude.exe')
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'linux', list: () => ['git.exe'] }), null)
    assert.equal(plantedProgram('/repo', { platform: 'darwin', list: () => ['git'] }), null)
    // on the disk: files count, a folder of that name does not; a folder that is not there holds nothing
    const dir = tempDir('plant')
    mkdirSync(join(dir, 'git.exe'))
    writeFileSync(join(dir, 'README.md'), '')
    assert.equal(plantedProgram(dir, { platform: 'win32', env: {} }), null)
    writeFileSync(join(dir, 'Npx.CMD'), '')
    assert.equal(plantedProgram(dir, { platform: 'win32', env: {} }), 'Npx.CMD')
    assert.equal(plantedProgram(join(dir, 'gone'), { platform: 'win32', env: {} }), null)
  })

  test('plantedProgram (Windows): any program on PATH counts — gradlew.bat / build.cmd stay allowed until such a program is installed; PATH\'s folders read once', () => {
    const top = ['gradlew.bat', 'build.cmd', 'mvnw.cmd', 'tree.js', 'notes.txt']
    const pathFolders: Record<string, string[]> = {
      [String.raw`c:\windows\system32`]: ['cmd.exe', 'tree.com', 'find.exe', 'notes.txt'],
      [String.raw`c:\tools`]: ['Build.EXE', 'readme.md'],
    }
    const reads: string[] = []
    const list = (d: string) => {
      reads.push(d)
      return d === String.raw`C:\repo` ? top : (pathFolders[d.toLowerCase()] ?? [])
    }
    const env = { Path: String.raw`C:\Windows\System32;C:\Tools\;relative;C:\tools` }
    // tree.com is in System32 — Windows' own folders do not count (Fix3 N5): a top-level tree.js stays allowed
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env: { Path: String.raw`C:\Windows\System32` }, list }), null)
    reads.length = 0
    // C:\tools has build.exe now: build.cmd would be taken
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env, list: (d) => (d === String.raw`C:\repo` ? ['gradlew.bat', 'build.cmd', 'mvnw.cmd'] : list(d)) }), 'build.cmd')
    // C:\Tools\ and C:\tools are one folder: read once; a relative entry never, Windows' own folders never
    assert.deepEqual(reads.map((d) => d.toLowerCase()).sort(), [String.raw`c:\tools`])
    // nothing on PATH named so: the build scripts stay allowed
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env: {}, list: (d) => (d === String.raw`C:\repo` ? ['gradlew.bat', 'build.cmd', 'mvnw.cmd'] : []) }), null)
    // PATH's folders are read only for a file with a runnable extension
    reads.length = 0
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env, list: (d) => (d === String.raw`C:\repo` ? ['notes.txt', 'README.md'] : list(d)) }), null)
    assert.deepEqual(reads, [])
    // the programs on PATH (PATHEXT of the env, else Windows' own) — outside Windows' own folders
    assert.deepEqual([...programsOnPath(env, (d) => pathFolders[d.toLowerCase()] ?? [])].sort(), ['build'])
    const tools: Record<string, string[]> = { [String.raw`c:\tools`]: ['Build.EXE', 'tree.com', 'readme.md'] }
    assert.deepEqual([...programsOnPath({ ...env, PATHEXT: '.EXE' }, (d) => tools[d.toLowerCase()] ?? [])].sort(), ['build'])
    assert.deepEqual([...programsOnPath(env, (d) => tools[d.toLowerCase()] ?? [])].sort(), ['build', 'tree'])
    // a launcher's program name: folder, quotes and a runnable extension off
    assert.equal(programName(String.raw`"C:\Program Files\Docker\docker.exe"`), 'docker')
    assert.equal(programName('uvx'), 'uvx')
    assert.equal(programName('mcp-server.v2'), 'mcp-server.v2')
    assert.equal(programName('/usr/local/bin/deno'), 'deno')
  })
})

/* ------------------------------------------------------------------ cmd.exe escaping */

// Generated once with cross-spawn 7.0.6's own lib/util/escape.js (mcp/node_modules, a dependency of the MCP SDK):
// [escape.command(argv[0]), ...argv.slice(1).map((a) => escape.argument(a, double))].join(' ')
const ORACLE: Array<[string[], boolean, string]> = [
  [['C:\\t\\run.bat', 'a&b'], false, 'C:\\t\\run.bat ^"a^&b^"'],
  [['C:\\t\\run.bat', 'x|y', '<in>', 'a^b', '100%', '!bang!'], false, 'C:\\t\\run.bat ^"x^|y^" ^"^<in^>^" ^"a^^b^" ^"100^%^" ^"^!bang^!^"'],
  [['C:\\t\\run.bat', 'say "hi"', '(p)', 'a,b;c', 'two words', 'back`tick', 'st*r?'], false, 'C:\\t\\run.bat ^"say^ \\^"hi\\^"^" ^"^(p^)^" ^"a^,b^;c^" ^"two^ words^" ^"back^`tick^" ^"st^*r^?^"'],
  [['C:\\t\\run.bat', 'C:\\dir\\', 'a\\"b', ''], false, 'C:\\t\\run.bat ^"C:\\dir\\\\^" ^"a\\\\\\^"b^" ^"^"'],
  [['C:\\t\\run.bat', 'Übung ä', '%PATH%'], false, 'C:\\t\\run.bat ^"Übung^ ä^" ^"^%PATH^%^"'],
  [['C:\\Program Files\\x (86)\\y.cmd', '--flag=1', '[a]'], false, 'C:\\Program^ Files\\x^ ^(86^)\\y.cmd ^"--flag=1^" ^"^[a^]^"'],
  [['C:\\r\\node_modules\\.bin\\jest.cmd', '--grep', 'a&b %PATH%', 'say "hi"'], true, 'C:\\r\\node_modules\\.bin\\jest.cmd ^^^"--grep^^^" ^^^"a^^^&b^^^ ^^^%PATH^^^%^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^"'],
  [['C:\\r\\node_modules\\.bin\\jest.cmd', 'C:\\dir\\', '!x!'], true, 'C:\\r\\node_modules\\.bin\\jest.cmd ^^^"C:\\dir\\\\^^^" ^^^"^^^!x^^^!^^^"'],
]
// Two or more backslashes before a quote or at the end: cross-spawn 7.0.6 (its ReDoS fix `(?=(\\+?)?)\1"` keeps ONE
// backslash of the run) writes 4 / 3 — the C runtime then reads a closing quote. One doubles the whole run (qntm.org/cmd).
const BACKSLASH_RUNS: Array<[string, string, string]> = [
  // [argument, One, cross-spawn 7.0.6]
  ['a\\\\"b', '^"a\\\\\\\\\\^"b^"', '^"a\\\\\\\\^"b^"'],
  ['x\\\\', '^"x\\\\\\\\^"', '^"x\\\\\\^"'],
]

/** cmd.exe for `/s /c "<line>"`: %var% expansion (only defined names), then every ^x → x (no quote mode: all quotes are escaped). */
const cmdPass = (s: string, expand: boolean) => (expand ? s.replace(/%([^%]*)%/g, (m, n: string) => (n.toUpperCase() === 'PATH' ? 'EXPANDED' : m)) : s).replace(/\^([\s\S])/g, '$1')

/** The C runtime's argv rules (what node.exe and most programs read). */
function crtArgv(s: string): string[] {
  const args: string[] = []
  let i = 0
  for (;;) {
    while (s[i] === ' ' || s[i] === '\t') i++
    if (i >= s.length) return args
    let arg = ''
    let quoted = false
    while (i < s.length && (quoted || (s[i] !== ' ' && s[i] !== '\t'))) {
      let run = 0
      while (s[i] === '\\') {
        run++
        i++
      }
      if (s[i] === '"') {
        arg += '\\'.repeat(run >> 1)
        if (run % 2) arg += '"'
        else if (quoted && s[i + 1] === '"') {
          arg += '"'
          i++
        } else quoted = !quoted
        i++
        continue
      }
      arg += '\\'.repeat(run)
      if (i < s.length && (quoted || (s[i] !== ' ' && s[i] !== '\t'))) arg += s[i++]
    }
    args.push(arg)
  }
}

/** What the program behind `cmd /d /v:off /s /c "<line>"` reads (a .bin shim: one more pass through %*). */
function roundTrip(args: string[], double: boolean): string[] {
  const line = cmdLine(['run.cmd', ...args], double)!
  let s = cmdPass(line, true)
  if (double) s = cmdPass(s, false)
  assert.ok(s.startsWith('run.cmd '), s)
  return crtArgv(s.slice('run.cmd '.length))
}

describe('exec — cmd.exe escaping (the person\'s own .cmd / .bat only)', () => {
  test('cmdLine equals cross-spawn 7.0.6 on every generated row (command, arguments, the .bin double escape)', () => {
    for (const [argv, double, line] of ORACLE) assert.equal(cmdLine(argv, double), line, JSON.stringify(argv))
  })

  test('runs of backslashes before a quote / at the end: doubled whole (cross-spawn 7.0.6 keeps one)', () => {
    for (const [arg, ours, theirs] of BACKSLASH_RUNS) {
      assert.equal(cmdLine(['x', arg], false), `x ${ours}`)
      assert.notEqual(ours, theirs)
      assert.deepEqual(roundTrip([arg], false), [arg])
    }
  })

  test('round trip: cmd.exe then the C runtime give back every argument — no variable expands, no caret stays', () => {
    const hard = ['a&b', 'x|y', '<in>', 'a^b', '100%', '%PATH%', '%path%x%PATH%', '!bang!', 'say "hi"', '"', '\\', '\\"', 'a\\\\"b', 'x\\\\', '\\\\server\\share\\', '', ' ', 'tab\there', 'Übung ä', 'a"b"c', '^^^', '(p)', 'a,b;c', '&&', '--grep=a b', '\\\\\\"']
    for (const double of [false, true]) {
      assert.deepEqual(roundTrip(hard, double), hard)
      for (const [argv, d] of ORACLE) if (d === double) assert.deepEqual(roundTrip(argv.slice(1), double), argv.slice(1))
    }
  })

  test('NUL, CR, LF: no cmd.exe line can carry them — refused', () => {
    for (const bad of ['a\0b', 'a\rb', 'a\nb']) {
      assert.equal(cmdLine(['C:\\t\\run.bat', 'ok', bad], false), null)
      assert.equal(cmdLine([`C:\\t\\${bad}.bat`], false), null)
    }
  })
})

/* ------------------------------------------------------------------ this OS */

/** Alive (a zombie whose parent is gone counts as ended). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  try {
    return !/^\d+ \(.*\) [ZX]/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return false
  }
}

describe('exec — on this OS', () => {
  test('a spawn that throws (a NUL in the program name) is code 127 — never a throw, never a rejection', async () => {
    const s = spawnSafe('bad\0name', ['x'], { stdio: 'ignore' })
    assert.equal(s.ok, false)
    assert.equal(!s.ok && s.code, 127)
    assert.ok(!s.ok && !s.error.includes(tmpdir()))
    const r = await execFileSafe('bad\0name', [], { timeoutMs: 5000 })
    assert.equal(r.code, 127)
    assert.equal(execFileSyncSafe('bad\0name', [], { timeoutMs: 5000 }).code, 127)
    // an argument a child cannot get (NUL): the same
    assert.equal((await execFileSafe(process.execPath, ['-e', '1', 'a\0b'], { timeoutMs: 5000 })).code, 127)
  })

  test('execFileSafe / execFileSyncSafe: missing → 127 "missing", time limit → 124, stdin, output, exit codes', async () => {
    const missing = await execFileSafe('one-no-such-tool-x9', ['a'], { timeoutMs: 5000 })
    assert.equal(missing.code, 127)
    assert.equal(missing.why, 'missing')
    assert.match(missing.error!, /^one-no-such-tool-x9 /)
    const deep = await execFileSafe(join(tempDir('nope'), 'sub', 'tool'), [], { timeoutMs: 5000 })
    assert.equal(deep.why, 'missing')
    assert.ok(!deep.error!.includes(tmpdir()), deep.error)
    const t0 = Date.now()
    const slow = await execFileSafe(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 300 })
    assert.equal(slow.code, 124)
    assert.equal(slow.timedOut, true)
    assert.ok(Date.now() - t0 < 6000)
    const echo = await execFileSafe(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { timeoutMs: 10_000, input: 'hällo\n' })
    assert.deepEqual([echo.code, echo.stdout], [0, 'hällo\n'])
    const fail = await execFileSafe(process.execPath, ['-e', 'console.error("no"); process.exit(3)'], { timeoutMs: 10_000 })
    assert.deepEqual([fail.code, fail.stderr.trim()], [3, 'no'])
    const big = await execFileSafe(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { timeoutMs: 10_000, maxBuffer: 1000 })
    assert.notEqual(big.code, 0)
    assert.ok(big.stdout.length <= 1000)
    assert.deepEqual(execFileSyncSafe('one-no-such-tool-x9', [], { timeoutMs: 5000 }), { code: 127, stdout: '', stderr: '', why: 'missing' })
    const sync = execFileSyncSafe(process.execPath, ['-e', 'console.log(process.argv[1])', 'a b'], { timeoutMs: 10_000 })
    assert.deepEqual([sync.code, sync.stdout.trim()], [0, 'a b'])
    const syncSlow = execFileSyncSafe(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 300 })
    assert.equal(syncSlow.code, 124)
  })

  test('killTree ends the child and the child it started within 5 s', async () => {
    const script = "const g = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(g.pid); setInterval(() => {}, 1000)"
    const s = spawnSafe(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' })
    assert.ok(s.ok)
    const grandchild = await new Promise<number>((resolve) => s.child.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim()))))
    assert.ok(alive(grandchild))
    const t0 = Date.now()
    await killTree(s.child)
    assert.ok(Date.now() - t0 < 5500)
    const until = Date.now() + 5000
    while ((alive(grandchild) || s.child.exitCode === null && s.child.signalCode === null) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    assert.equal(alive(grandchild), false)
    assert.ok(s.child.exitCode !== null || s.child.signalCode !== null)
    // an ended child: at once
    await killTree(s.child)
  })

  test('a fakeBin program (npm\'s shim on Windows, sh elsewhere) runs through spawnSafe({ allow: "shim" })', async () => {
    const dir = fakeBin(tempDir('bin'), 'one-fake-tool', 'console.log("fake:" + process.argv.slice(2).join("|"))\n')
    const env = { ...process.env, ...pathWith(dir) }
    const r = await execFileSafe('one-fake-tool', ['a b', 'c&d', '"q"'], { env, timeoutMs: 10_000, allow: 'shim' })
    assert.deepEqual([r.code, r.stdout.trim()], [0, 'fake:a b|c&d|"q"'])
    assert.equal(envGet(env, 'PATH')!.split(process.platform === 'win32' ? ';' : ':')[0], dir)
  })

  test('systemTool: by its absolute path on Windows (ComSpec only when it is a real cmd.exe), the bare name elsewhere', () => {
    assert.equal(systemTool('cmd', { SystemRoot: String.raw`D:\Win` }, 'win32', () => false), String.raw`D:\Win\System32\cmd.exe`)
    assert.equal(systemTool('cmd', { ComSpec: String.raw`C:\Windows\system32\cmd.exe` }, 'win32', () => true), String.raw`C:\Windows\system32\cmd.exe`)
    assert.equal(systemTool('cmd', { ComSpec: String.raw`C:\tools\tcc.exe`, windir: String.raw`C:\Windows` }, 'win32', () => true), String.raw`C:\Windows\System32\cmd.exe`)
    assert.equal(systemTool('cmd', { ComSpec: 'cmd.exe', SystemRoot: 'relative' }, 'win32', () => true), String.raw`C:\Windows\System32\cmd.exe`)
    assert.equal(systemTool('taskkill', {}, 'win32'), String.raw`C:\Windows\System32\taskkill.exe`)
    assert.equal(systemTool('powershell', { SYSTEMROOT: String.raw`C:\Windows` }, 'win32'), String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    assert.equal(systemTool('taskkill', {}, 'linux'), 'taskkill')
    assert.equal(commandName(String.raw`C:\Users\Max Muster\bin\claude.cmd`, 'win32'), 'claude.cmd')
    assert.equal(commandName('/home/max/bin/claude', 'linux'), 'claude')
  })

  test('samePath / pathId: case-free on Windows and macOS only, trailing separators off', () => {
    assert.equal(samePath(String.raw`C:\Code\Shop`, String.raw`c:\code\shop\\`, 'win32'), true)
    assert.equal(samePath('C:/Code/Shop', String.raw`C:\code\SHOP`, 'win32'), true)
    assert.equal(samePath('/Users/max/Code', '/users/max/code/', 'darwin'), true)
    assert.equal(samePath('/home/max/Code', '/home/max/code', 'linux'), false)
    assert.equal(samePath('/home/max/code/', '/home/max/code', 'linux'), true)
    assert.equal(pathId(String.raw`C:\\`, 'win32'), 'c:\\')
    assert.equal(pathId('/', 'linux'), '/')
  })
})

/* ------------------------------------------------------------------ crash safety + the exec layer in use */

describe('exec in use — crash safety', () => {
  test('detectClaude never rejects: not found / a .cmd it cannot read → found false with the reason', async () => {
    const none = await detectClaude(join(tempDir('noclaude'), 'nope', 'claude'))
    assert.deepEqual(none, { found: false, version: null, budget: false, modes: [], settingSources: false, missing: 'not-found' })
    const bin = String.raw`C:\Users\Max Muster\AppData\Roaming\npm\claude.cmd`
    const refused = await detectClaude(bin, { platform: 'win32', ...disk({ [bin]: SHIM_PWSH }) })
    assert.equal(refused.found, false)
    assert.equal(refused.missing, 'cmd-refused')
    const gone = await detectClaude('claude', { platform: 'win32', ...disk({}) })
    assert.equal(gone.missing, 'not-found')
  })

  test('`check` with a missing CLAUDE_BIN: NOT FOUND with how to install it, exit 1, no stack trace', () => {
    const dir = tempDir('check')
    const config = join(dir, 'worker.json')
    writeFileSync(config, JSON.stringify({ workspace: 'local:test-ws-1', repos: [] }))
    const r = spawnSync(process.execPath, [WORKER_BUNDLE, 'check', '--config', config], { env: { ...process.env, HOME: dir, USERPROFILE: dir, CLAUDE_BIN: join(dir, 'nope', 'claude') }, encoding: 'utf8', timeout: 30_000 })
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stdout, /claude {5}NOT FOUND \(".*claude"\) — Install Claude Code/)
    assert.match(r.stdout, /node {7}\d+\./)
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /\n\s+at /)
  })

  test('Worker.start survives a missing Claude Code: it listens, says so, and stops cleanly', async () => {
    const dir = tempDir('nostart')
    const logs: string[] = []
    const worker = new Worker({ config: { ...emptyConfig(join(dir, 'worker.json'), {}), port: 0 }, version: 'test', bin: join(dir, 'nope', 'claude'), self: WORKER_BUNDLE, log: (m) => logs.push(m) })
    assert.equal(await worker.start(), 'listening')
    await worker.stop()
    assert.ok(logs.some((l) => /Claude Code/.test(l) && /not found|install/i.test(l)), logs.join('\n'))
  })

  test('Windows dialogs: PowerShell by its path, UTF-8 out, in front (TopMost) · the browser through cmd.exe by its path', () => {
    const env = { SystemRoot: String.raw`C:\Windows` }
    const pick = pickerCommand(env, 'win32')!
    assert.equal(pick.cmd, String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    assert.equal(pick.allow, 'exe')
    const script = pick.args.at(-1)!
    assert.ok(script.startsWith('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;'), script)
    assert.match(script, /TopMost = \$true/)
    assert.match(script, /ShowDialog\(\$o\)/)
    assert.doesNotMatch(script, /"/)
    assert.deepEqual(pickerCommand({ ONE_WORKER_PICKER: 'my-picker' }, 'win32'), { cmd: 'my-picker', args: [], allow: 'person' })
    const url = `http://127.0.0.1:47400/setup#k=${'A'.repeat(43)}`
    const open = browserCommand(url, env, 'win32')!
    assert.equal(open.cmd, String.raw`C:\Windows\System32\cmd.exe`)
    assert.deepEqual(open.args, ['/d', '/c', 'start', '""', url])
    assert.equal(browserCommand(url, { ONE_WORKER_BROWSER: 'firefox' }, 'win32')!.allow, 'person')
    // a path typed with its quotes (Explorer's "Copy as path")
    assert.equal(browserCommand(url, { ONE_WORKER_BROWSER: String.raw`"C:\Program Files\Mozilla Firefox\firefox.exe"` }, 'win32')!.cmd, String.raw`C:\Program Files\Mozilla Firefox\firefox.exe`)
    assert.equal(pickerCommand({ ONE_WORKER_PICKER: '"C:\\tools\\pick folder.exe"' }, 'win32')!.cmd, 'C:\\tools\\pick folder.exe')
  })

  test('test commands: CRLF lines arrive without \\r; a program not in PATH → notStarted "missing" (never a throw)', async () => {
    const cwd = tempDir('crlf')
    const repo = (argv: string[]) => ({ testCommand: argv, testTimeoutSec: 30, analyzeCommand: argv, analyzeTimeoutSec: 30 }) as unknown as RepoConfig
    const lines: string[] = []
    const ok = await runTests(repo([process.execPath, '-e', 'process.stdout.write("one\\r\\ntwo\\r\\n")']), cwd, new AbortController().signal, (l) => lines.push(l))
    assert.deepEqual(lines, ['one', 'two'])
    assert.equal(ok.ok, true)
    for (const run of [runTests, runAnalysis]) {
      const missing = await run(repo(['one-no-such-test-runner', '--all']), cwd, new AbortController().signal)
      assert.deepEqual(missing, { ok: false, output: '', ms: 0, code: -1, notStarted: 'missing' })
    }
    const timed = await runTests({ ...repo([process.execPath, '-e', 'setInterval(() => {}, 1000)']), testTimeoutSec: 1 } as RepoConfig, cwd, new AbortController().signal)
    assert.equal(timed.ok, false)
    assert.match(timed.output, /ran longer than 1 s/)
  })

  test('test output: a line cut between two pieces arrives whole, a character cut between them stays one (no U+FFFD) — the scrubber sees whole paths', async () => {
    const cwd = tempDir('pieces')
    // "/home/J" + the first byte of "ü" · its second byte + "rgen/x\n" · a last line without an end
    const script = "const w = (b) => new Promise((r) => process.stdout.write(Buffer.from(b), () => setTimeout(r, 80))); (async () => { await w([0x2f, 0x68, 0x6f, 0x6d, 0x65, 0x2f, 0x4a, 0xc3]); await w([0xbc, 0x72, 0x67, 0x65, 0x6e, 0x2f, 0x78, 0x0a]); await w('tail without end') })()"
    const lines: string[] = []
    const r = await runTests({ testCommand: [process.execPath, '-e', script], testTimeoutSec: 30 } as unknown as RepoConfig, cwd, new AbortController().signal, (l) => lines.push(l))
    assert.equal(r.ok, true, r.output)
    assert.deepEqual(lines, ['/home/Jürgen/x', 'tail without end'])
    assert.equal(r.output, '/home/Jürgen/x\ntail without end')
  })

  test('listen errors: "another worker" only for a port in use; Windows\' excluded ports are named with the netsh line', () => {
    const exclusion = listenError('EACCES', 'listen EACCES: permission denied 127.0.0.1:47400', 47400, false, 'win32')
    assert.equal(exclusion.result, 'refused')
    assert.match(exclusion.line, /^cannot listen on 127\.0\.0\.1:47400: Windows keeps port 47400 for itself — `netsh int ipv4 show excludedportrange protocol=tcp` lists the ranges; start with ONE_WORKER_PORT=<free port> and set the same port in One$/)
    assert.doesNotMatch(listenError('EACCES', 'x', 47400, true, 'win32').line, /in One/)
    assert.deepEqual(listenError('EACCES', 'listen EACCES: permission denied 127.0.0.1:80', 80, false, 'linux'), { result: 'refused', line: 'cannot listen on 127.0.0.1:80: listen EACCES: permission denied 127.0.0.1:80' })
    const inUse = listenError('EADDRINUSE', 'x', 47393, true, 'win32')
    assert.equal(inUse.result, 'in-use')
    assert.match(inUse.line, /^port 47393 is in use — another one-worker runs on this computer/)
  })

  test('the Git Bash Claude Code needs on Windows: CLAUDE_CODE_GIT_BASH_PATH, else beside the git.exe PATH names', () => {
    const gitDir = String.raw`C:\Program Files\Git`
    const files = { [`${gitDir}\\cmd\\git.exe`]: 'MZ', [`${gitDir}\\bin\\bash.exe`]: 'MZ', [String.raw`D:\portable\bin\bash.exe`]: 'MZ', [String.raw`D:\portable\mingw64\bin\git.exe`]: 'MZ' }
    assert.deepEqual(gitBash({ PATH: `${gitDir}\\cmd` }, disk(files)), { path: `${gitDir}\\bin\\bash.exe`, from: 'git' })
    assert.deepEqual(gitBash({ PATH: String.raw`D:\portable\mingw64\bin` }, disk(files)), { path: String.raw`D:\portable\bin\bash.exe`, from: 'git' })
    assert.deepEqual(gitBash({ PATH: `${gitDir}\\cmd`, CLAUDE_CODE_GIT_BASH_PATH: String.raw`D:\portable\bin\bash.exe` }, disk(files)), { path: String.raw`D:\portable\bin\bash.exe`, from: 'env' })
    assert.deepEqual(gitBash({ PATH: String.raw`C:\none` }, disk(files)), { path: null, from: null })
  })
})

/* ------------------------------------------------------------------ the source guard */

/** Files that still start programs themselves — each one leaves this list when it moves to exec.ts (B's four). */
const NOT_YET: string[] = []

describe('exec — source guard', () => {
  test('only exec.ts imports node:child_process (type imports aside); no `shell:` option; cmd.exe only for the person\'s own commands', () => {
    const dir = fileURLToPath(new URL('../src/worker/', import.meta.url))
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    assert.ok(files.includes('exec.ts') && files.length > 20)
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      const valueImport = [...src.matchAll(/(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"](?:node:)?child_process['"]/g)].some((m) => !m[1] && !/^\{\s*(?:type\s+\w+\s*,?\s*)+\}$/.test(m[2]!.trim()))
      const dynamic = /(?:require|import)\(\s*['"](?:node:)?child_process['"]\s*\)/.test(src)
      if (f !== 'exec.ts' && (valueImport || dynamic)) offenders.push(f)
      // `shell: false` in exec.ts overrides a caller's; nowhere else a shell option at all
      const shells = [...src.matchAll(/\bshell\s*:\s*([^,}\s]+)/g)].map((m) => m[1])
      assert.ok(f === 'exec.ts' ? shells.every((v) => v === 'false') : shells.length === 0, `${f}: shell option`)
      // what may run through cmd.exe: the person's own commands (tests / analysis, ONE_WORKER_BROWSER / _PICKER) only
      if (/'person'/.test(src)) assert.ok(['exec.ts', 'testrun.ts', 'opener.ts', 'picker.ts'].includes(f), `${f} uses allow 'person'`)
    }
    assert.deepEqual(offenders.sort(), [...NOT_YET].sort(), 'a file in NOT_YET that no longer starts programs leaves the list; a new one uses exec.ts')
  })
  /**
   * The invariant "nothing One sends and nothing from a repository reaches argv[0] or a cmd.exe line", by construction:
   * every call that starts a program, with where its program comes from. A new call site fails here until it is added
   * with its source (One's data and a repository's content are never one).
   */
  test('INVARIANT: every program the worker starts is a fixed name, the person\'s own setting or this Node — never text from One or a repository', () => {
    const dir = fileURLToPath(new URL('../src/worker/', import.meta.url))
    const calls: string[] = []
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'exec.ts')) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\b(spawnSafe|execFileSafe|execFileSyncSafe)\(\s*([^,]+?)\s*,/g)) calls.push(`${f}: ${m[2]}`)
    }
    assert.deepEqual(calls.sort(), [
      'claude.ts: bin', // findClaude(): CLAUDE_BIN (resolved once, at the start — never in a worktree) or `claude` / the native install
      'claude.ts: r.bin', // the same (StageContext.bin = WorkerOptions.bin)
      "clone.ts: 'git'",
      'clone.ts: cmd', // runCli: 'git' (an .exe only) · 'gh' · 'glab'
      'codex.ts: bin', // findCodex(): person's CODEX_BIN, trusted app install or PATH; help probe
      'codex.ts: bin', // the same selected CLI; task content travels over stdin
      "config.ts: 'git'",
      'copilot.ts: findCopilot(env)', // person's COPILOT_BIN or trusted PATH/install, version probe in tmpdir
      'copilot.ts: findCopilot(env)', // same host-selected CLI, isolated cwd; prompt travels over SDK stdin
      'demo-compare.ts: command', // opt-in synthetic exercise: this Node, host CXX/compiler, or its fixed temporary test binary
      "git.ts: 'git'",
      "git.ts: 'ssh'", // sshHostName(): `ssh -G <host>` — a host name (SSH_HOST: never an option) the remote's address names
      'git.ts: cmd', // run(): 'gh' | 'glab'
      "gitenv.ts: 'git'",
      'harness-eval.ts: process.execPath', // opt-in evaluation: this Node and a host-written checker outside the disposable worktree; never a model-selected program
      'local-benchmark.ts: process.execPath', // opt-in benchmark: this Node, fixed check.mjs in a disposable fixture
      'local-benchmark.ts: process.execPath', // syntax-check the fixed benchmark fixture before invoking the model
      'managed.ts: join(system', // fixed System32/whoami.exe: discover the installing Windows account SID
      'managed.ts: join(system', // fixed System32/icacls.exe: protect the installation for that SID
      'managed.ts: process.execPath', // syntax-check a pinned, checksummed release; no model-selected executable
      'managed.ts: process.execPath', // launch the validated installed release with IPC, through spawnSafe
      'opener.ts: how.cmd', // cmd.exe from System32, or ONE_WORKER_BROWSER (the person's)
      'picker.ts: how.cmd', // powershell.exe from System32, or ONE_WORKER_PICKER (the person's)
      "proctree.ts: 'ps'", // macOS / Linux without /proc: the system's ps — what Claude Code left running (worker 1.11.0)
      "proctree.ts: 'ps'", // macOS: the command lines of the leftovers (a server the person's tools share is never ended)
      "proctree.ts: 'ps'", // macOS: `ps -E` for the run's environment mark
      "proctree.ts: systemTool('powershell')", // Windows: powershell.exe from System32 (Win32_Process)
      "proctree.ts: systemTool('powershell')", // Windows: the leftovers' command lines (one-shot, when the run's session failed)
      "proctree.ts: systemTool('powershell')", // Windows: the run's one PowerShell session (fixed scripts on its stdin)
      'setup.ts: cmd', // installed(): 'gh' | 'glab'
      'testrun.ts: argv[0]!', // worker.json testCommand / analyzeCommand — the person's, or a fixed guess (scan.ts: bare names)
    ])
    // their arguments: run()'s and runCli's tool names are typed as the fixed ones
    const git = readFileSync(join(dir, 'git.ts'), 'utf8')
    assert.match(git, /async function run\(cmd: 'gh' \| 'glab'/)
    assert.match(readFileSync(join(dir, 'setup.ts'), 'utf8'), /async function installed\(cmd: 'gh' \| 'glab'\)/)
    // what a file in a working folder reaches the line as: named from the spawn's own folder, never its path (see the
    // Windows tests) — and nothing spawns a resolved command but through spawnForm
    const exec = readFileSync(join(dir, 'exec.ts'), 'utf8')
    assert.match(readFileSync(join(dir, 'managed.ts'), 'utf8'), /starterText\(process\.execPath, ctx\.dir\)/, 'The generated starter pins the installing Node; never task text')
    assert.match(exec, /const line = cmdLine\(\[fromCwd\(r\.line\.argv\[0\]!, cwd\), \.\.\.r\.line\.argv\.slice\(1\)\]/)
    assert.deepEqual([...exec.matchAll(/\bspawn(?:Sync)?\(([^,]+),/g)].map((m) => m[1]).sort(), ['${JSON.stringify(node)}', 'run.file', 'run.file', 'systemTool(\'taskkill\')'])
    // The MCP SDK owns stdio spawning: resolve the person's named server outside the worktree,
    // with the same PATH cleanup and shim rules; model arguments never select a program.
    const localMcp = readFileSync(join(dir, 'local-mcp.ts'), 'utf8')
    assert.match(localMcp, /resolveCommand\(expand\(entry.command, env\)/)
    assert.match(localMcp, /cwd: homedir\(\)/)
    assert.match(localMcp, /const childEnv = ownEnv\(/)
  })
})


/* ------------------------------------------------------------------ Fix3 */

describe('Fix3: PATH of absolute folders for the worker\'s own programs (every OS); Windows\' own folders and the disk\'s case table in plantedProgram', () => {
  test('pathAbsolute: an empty entry, "." and a relative folder dropped (Windows: every spelling of the key, quoted folders kept); nothing left → no PATH; all absolute → the same object', () => {
    assert.deepEqual(pathAbsolute({ PATH: ':/usr/bin:.:bin:/opt/x::', HOME: '/h' }, 'linux'), { PATH: '/usr/bin:/opt/x', HOME: '/h' })
    assert.deepEqual(pathAbsolute({ PATH: '/usr/bin:./node_modules/.bin' }, 'darwin'), { PATH: '/usr/bin' })
    const clean = { PATH: '/usr/bin:/bin' }
    assert.equal(pathAbsolute(clean, 'linux'), clean)
    assert.deepEqual(pathAbsolute({ PATH: ':.', X: '1' }, 'linux'), { X: '1' })
    // macOS / Linux: only "PATH" is PATH
    assert.deepEqual(pathAbsolute({ Path: ':.' }, 'linux'), { Path: ':.' })
    const win = pathAbsolute({ Path: String.raw`;C:\Git\cmd;.;tools;"C:\Program Files\x";\\srv\share\bin;%USERPROFILE%\bin;\rooted`, PATH: '.;D:\\y' }, 'win32')
    assert.deepEqual(win, { Path: String.raw`C:\Git\cmd;"C:\Program Files\x";\\srv\share\bin`, PATH: 'D:\\y' })
    const before = { PATH: ':/usr/bin' }
    pathAbsolute(before, 'linux')
    assert.deepEqual(before, { PATH: ':/usr/bin' }, 'the caller\'s object stays as it was')
    assert.deepEqual(ownEnv({ Path: String.raw`.;C:\t` }, 'win32'), { Path: String.raw`C:\t`, NoDefaultCurrentDirectoryInExePath: '1' })
    assert.deepEqual(ownEnv({ PATH: '.:/usr/bin' }, 'linux'), { PATH: '/usr/bin' })
  })

  test('macOS / Linux: PATH=":"+PATH and an executable git in the working folder — git, a program the worker starts and what IT starts by name all take the real git; the person\'s own command keeps PATH as it is', { skip: process.platform === 'win32' && 'Windows resolves every name itself, PATH only (see above) — the relative-entry case is the pure test' }, async () => {
    const dir = tempDir('planted-path')
    writeFileSync(join(dir, 'git'), '#!/bin/sh\necho PLANTED-GIT\n')
    chmodSync(join(dir, 'git'), 0o755)
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${delimiter}${process.env.PATH}` }
    const real = /^git version /
    // git (allow 'exe'), all three ways in
    const a = await execFileSafe('git', ['--version'], { cwd: dir, env, timeoutMs: 20_000, allow: 'exe' })
    assert.match(a.stdout, real, a.stdout)
    const b = execFileSyncSafe('git', ['--version'], { cwd: dir, env, timeoutMs: 20_000, allow: 'exe' })
    assert.match(b.stdout, real, b.stdout)
    const s = spawnSafe('git', ['--version'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'], allow: 'exe' })
    assert.ok(s.ok)
    let out = ''
    s.child.stdout!.on('data', (d: Buffer) => (out += d.toString()))
    await new Promise((r) => s.child.on('close', r))
    assert.match(out, real, out)
    // a program the worker starts by itself (Claude Code, gh, glab: allow 'shim') — and the git IT starts by name
    const inner = await execFileSafe('sh', ['-c', 'printf "%s|" "$PATH"; git --version'], { cwd: dir, env, timeoutMs: 20_000, allow: 'shim' })
    assert.match(inner.stdout, /\|git version /, inner.stdout)
    assert.ok(!inner.stdout.split('|')[0]!.split(':').some((d) => !d.startsWith('/')), inner.stdout)
    // the person's own command (allow 'person'): PATH exactly as given
    const person = await execFileSafe('sh', ['-c', 'printf "%s" "$PATH"'], { cwd: dir, env, timeoutMs: 20_000, allow: 'person' })
    assert.equal(person.stdout, env.PATH)
    const tested = await runTests({ testCommand: ['sh', '-c', 'printf "%s" "$PATH"'], testTimeoutSec: 20 } as unknown as RepoConfig, dir, new AbortController().signal)
    assert.equal(tested.output, process.env.PATH, 'the test stage: the worker\'s own environment, as it is')
  })

  test('plantedProgram rule (a): PATH folders under %SystemRoot% / %windir% (C:\\Windows when neither is set) do not count — find.js, sort.js, format.js, route.js, a Python convert.py stay allowed; BY_NAME (cmd, where, ssh …) and other folders still count', () => {
    const disk: Record<string, string[]> = {
      [String.raw`c:\windows\system32`]: ['find.exe', 'sort.exe', 'format.com', 'route.exe', 'convert.exe', 'tree.com', 'help.exe', 'where.exe', 'cmd.exe', 'taskkill.exe', 'reg.exe', 'rundll32.exe'],
      [String.raw`c:\windows`]: ['notepad.exe', 'write.exe', 'explorer.exe'],
      [String.raw`c:\windows\system32\openssh`]: ['ssh.exe', 'scp.exe'],
      [String.raw`d:\win\system32`]: ['find.exe'],
      [String.raw`c:\users\max\appdata\roaming\npm`]: ['ng.cmd', 'tsc.cmd'],
      [String.raw`c:\program files\dotnet`]: ['dotnet.exe'],
    }
    const top = (files: string[]) => (d: string) => (d === String.raw`C:\repo` ? files : (disk[d.toLowerCase().replace(/\\+$/, '')] ?? []))
    const Path = ['C:\\WINDOWS\\system32\\', String.raw`C:\Windows`, String.raw`C:/Windows/System32/OpenSSH`, String.raw`C:\Users\max\AppData\Roaming\npm`, String.raw`C:\Program Files\dotnet`].join(';')
    const at = (files: string[], env: NodeJS.ProcessEnv) => plantedProgram(String.raw`C:\repo`, { platform: 'win32', env, list: top(files), exists: () => false })
    const PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PY;.PYW'
    for (const env of [{ Path, PATHEXT, SystemRoot: String.raw`C:\Windows` }, { Path, PATHEXT, windir: String.raw`c:\windows` }, { Path, PATHEXT }]) {
      // the flat Node library, color-convert, a Python project with .PY in PATHEXT, notepad.js / write.js beside C:\Windows'
      for (const files of [['index.js', 'find.js', 'format.js', 'sort.js'], ['route.js', 'conversions.js'], ['convert.py', 'tree.py', 'help.py'], ['notepad.js', 'write.vbs'], ['scp.js']]) assert.equal(at(files, env), null, `${files.join(' ')} ${JSON.stringify(env).slice(0, 80)}`)
      // still refused: BY_NAME (cmd, where, taskkill, ssh, node, dotnet — and reg, rundll32, explorer, which Claude Code
      // itself starts by name), a program on PATH outside Windows' folders (ng)
      for (const f of ['cmd.js', 'where.bat', 'taskkill.cmd', 'ssh.exe', 'node.js', 'dotnet.cmd', 'ng.js', 'reg.js', 'Rundll32.cmd', 'explorer.js', 'REG.exe']) assert.equal(at([f], env), f, f)
    }
    // another Windows folder (D:\Win): its own System32 is Windows', C:\Windows is not special then
    assert.equal(at(['find.js'], { Path: String.raw`D:\Win\System32`, SystemRoot: String.raw`D:\Win` }), null)
    assert.equal(at(['find.js'], { Path: String.raw`D:\Win\System32` }), 'find.js')
    // inside, never beside
    assert.equal(inSystemRoot(String.raw`C:\Windows.old\System32`, {}), false)
    assert.equal(inSystemRoot(String.raw`C:\Windows\..\Tools`, {}), false)
    assert.equal(inSystemRoot('c:\\windows\\SysWOW64\\', {}), true)
    assert.deepEqual(systemRoots({ SystemRoot: 'C:\\Windows\\', windir: String.raw`C:\WINDOWS` }), [String.raw`c:\windows`])
    assert.deepEqual(systemRoots({ SystemRoot: '%x%' }), [String.raw`c:\windows`])
  })

  test('plantedProgram: ı, ſ and the Kelvin sign count as the disk\'s own case table has it — asked of the disk, never folded by guess', () => {
    const at = (files: string[], exists: (p: string) => boolean) => plantedProgram(String.raw`C:\repo`, { platform: 'win32', env: {}, list: (d) => (d === String.raw`C:\repo` ? files : []), exists })
    // a disk that folds them (its lookup of git.exe opens gıt.exe) — and one that does not
    const asked: string[] = []
    const folding = (p: string) => (asked.push(p.replace(/^.*[\\/]/, '')), true)
    // docker.ſh: ".sh" is no extension a lookup runs · kubectl: no program the check knows here
    for (const f of ['gıt.exe', 'ſsh.exe', 'docker.ſh', 'node.jſ', '\u212aubectl.cmd']) {
      const want = f === 'docker.ſh' || f === '\u212aubectl.cmd' ? null : f
      assert.equal(at([f], folding), want, f)
    }
    assert.deepEqual(asked, ['git.exe', 'ssh.exe', 'node.js'], 'only the ASCII name it may fold to is asked for — a name that is no program is never asked')
    for (const f of ['gıt.exe', 'ſsh.exe', 'node.jſ']) assert.equal(at([f], () => false), null, f)
    // the Kelvin sign is not folded by JavaScript's lower case any more: "\u212aubectl" is no "kubectl" until the disk says so
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env: {}, list: (d) => (d === String.raw`C:\repo` ? ['\u212aube.exe'] : []), names: ['kube'], exists: () => false }), null)
    assert.equal(plantedProgram(String.raw`C:\repo`, { platform: 'win32', env: {}, list: (d) => (d === String.raw`C:\repo` ? ['\u212aube.exe'] : []), names: ['kube'], exists: () => true }), '\u212aube.exe')
  })

  test('plantedProgram on this disk: "gıt.exe" / "ſsh.exe" at the top of a folder count exactly when the disk opens them as git.exe / ssh.exe (NTFS on the Windows runner — documented here)', (t) => {
    for (const [file, ascii] of [['gıt.exe', 'git.exe'], ['ſsh.exe', 'ssh.exe'], ['\u212aubectl.exe', 'kubectl.exe']] as const) {
      const dir = tempDir('fold')
      writeFileSync(join(dir, file), 'MZ')
      const folds = isFile(join(dir, ascii))
      t.diagnostic(`${process.platform}: ${file} ${folds ? 'opens' : 'does not open'} as ${ascii}`)
      // kubectl is no program the check knows here (not BY_NAME, no PATH given): never counted
      const want = folds && ascii !== 'kubectl.exe' ? file : null
      assert.equal(plantedProgram(dir, { platform: 'win32', env: {} }), want, `${file} (the disk folds: ${folds})`)
    }
  })
})

/* ------------------------------------------------------------------ Fix4 */

describe('Fix4: "~" in PATH on macOS / Linux', () => {
  test('pathAbsolute: "~" and "~/…" become the home folder (the child\'s HOME, else this user\'s); dropped when that is no absolute folder; "~user" and Windows as before', () => {
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:/usr/bin:~:~/.local/bin', HOME: '/home/me' }, 'linux'), { PATH: '/home/me/bin:/usr/bin:/home/me:/home/me/.local/bin', HOME: '/home/me' })
    // no HOME in the child's environment: this user's
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:/usr/bin' }, 'darwin', () => '/Users/me'), { PATH: '/Users/me/bin:/usr/bin' })
    // never relative: a HOME that is relative, empty, holds the separator, or none the system can name
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:~:/usr/bin', HOME: 'rel' }, 'linux'), { PATH: '/usr/bin', HOME: 'rel' })
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:~:/usr/bin', HOME: '' }, 'linux'), { PATH: '/usr/bin', HOME: '' })
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:/usr/bin', HOME: '/a:b' }, 'linux'), { PATH: '/usr/bin', HOME: '/a:b' })
    const none = () => {
      throw new Error('no home')
    }
    assert.deepEqual(pathAbsolute({ PATH: '~/bin:/usr/bin' }, 'linux', none), { PATH: '/usr/bin' })
    // another user's home, "~x", "./~/bin": dropped as before
    assert.deepEqual(pathAbsolute({ PATH: '~root/bin:~x:./~/bin:/usr/bin', HOME: '/h' }, 'linux'), { PATH: '/usr/bin', HOME: '/h' })
    // Windows: no "~" there — unchanged
    assert.deepEqual(pathAbsolute({ Path: String.raw`~;~\bin;~/bin;C:\x`, HOME: String.raw`C:\Users\me` }, 'win32', () => String.raw`C:\Users\me`), { Path: String.raw`C:\x`, HOME: String.raw`C:\Users\me` })
    assert.deepEqual(ownEnv({ PATH: '~/bin:.:/usr/bin', HOME: '/h' }, 'linux'), { PATH: '/h/bin:/usr/bin', HOME: '/h' })
  })

  test('macOS / Linux: a program reachable only through "~/bin" in PATH — bash started by a program the worker starts finds it (Claude Code\'s Bash tool), and so does a start by name; a "~" folder in the working folder never runs', { skip: process.platform === 'win32' && 'Windows has no "~" PATH entries — the pure test above' }, async () => {
    const home = tempDir('fix4-home')
    const dir = tempDir('fix4-cwd')
    mkdirSync(join(home, 'bin'))
    mkdirSync(join(dir, '~', 'bin'), { recursive: true })
    for (const [at, say] of [[join(home, 'bin'), 'HOME-TOOL'], [join(dir, '~', 'bin'), 'PLANTED']] as const) {
      writeFileSync(join(at, 'one-fix4-tool'), `#!/bin/sh\necho ${say}\n`)
      chmodSync(join(at, 'one-fix4-tool'), 0o755)
    }
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `~/bin${delimiter}${process.env.PATH}` }
    const viaBash = await execFileSafe('bash', ['-c', 'one-fix4-tool; printf "%s" "$PATH"'], { cwd: dir, env, timeoutMs: 20_000, allow: 'shim' })
    assert.equal(viaBash.code, 0, viaBash.stderr)
    const [said, path] = viaBash.stdout.split('\n')
    assert.equal(said, 'HOME-TOOL')
    assert.equal(path!.split(delimiter)[0], join(home, 'bin'))
    assert.ok(path!.split(delimiter).every((d) => d.startsWith('/')), path)
    const direct = await execFileSafe('one-fix4-tool', [], { cwd: dir, env, timeoutMs: 20_000, allow: 'shim' })
    assert.equal(direct.stdout, 'HOME-TOOL\n', `${direct.code} ${direct.error ?? ''}`)
    // the person's own command: PATH exactly as given
    const person = await execFileSafe('sh', ['-c', 'printf "%s" "$PATH"'], { cwd: dir, env, timeoutMs: 20_000, allow: 'person' })
    assert.equal(person.stdout, env.PATH)
  })
})
