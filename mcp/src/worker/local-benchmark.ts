/** Opt-in local smoke benchmark. No cloud calls, downloads, git changes or project files. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocal } from './local-agent.ts'
import { miniMaxInference } from './minimax-inference.ts'
import { readMiniMax, MINIMAX_MODEL } from './minimax-config.ts'
import { execFileSafe } from './exec.ts'

const cases = [
  ['sum', 'Return the sum of finite numeric array entries, ignoring strings, null, NaN and Infinity.', `export function solve(values) { return 0 }`, `assert.equal(solve([1,2,'3',null,NaN,Infinity,-1]),2); assert.equal(solve([]),0)`],
  ['slug', 'Make a page slug: trim, lowercase, normalize accents (NFD), replace runs of non-ASCII-alphanumeric characters with one hyphen, remove edge hyphens.', `export function solve(value) { return value }`, `assert.equal(solve('  Café & One CMS! '),'cafe-one-cms'); assert.equal(solve('---'),''); assert.equal(solve('A__B'),'a-b')`],
  ['csv', 'Encode one CSV row: join with commas; quote fields containing a comma, double quote or newline; escape each double quote by doubling it. Convert null/undefined to empty strings.', `export function solve(row) { return row.join(',') }`, String.raw`assert.equal(solve(['a,b','x"y',null]),'"a,b","x""y",'); assert.equal(solve(['a','b']),'a,b'); assert.equal(solve(['a\nb']),'"a\nb"')`],
  ['unique', 'Deduplicate records by id, keeping the first record and original order. Do not mutate the input.', `export function solve(rows) { return rows }`, `const rows=[{id:'a',v:1},{id:'b',v:2},{id:'a',v:3}]; assert.deepEqual(solve(rows),rows.slice(0,2)); assert.equal(rows.length,3)`],
  ['pagination', 'Return {items,total,pages,page} for an array and 1-based page and positive size. Clamp page to [1,max(1,pages)]. Empty array has pages=0 and page=1. Do not mutate the array.', `export function solve(rows,page,size) { return {} }`, `assert.deepEqual(solve([1,2,3,4,5],99,2),{items:[5],total:5,pages:3,page:3}); assert.deepEqual(solve([],0,2),{items:[],total:0,pages:0,page:1})`],
  ['paths', 'Accept only nonempty relative slash-separated file paths. Normalize backslashes to slashes. Reject absolute paths, drive paths, empty segments, dot and dot-dot segments, and null bytes by returning null.', `export function solve(path) { return path }`, `assert.equal(solve('src/a.ts'),'src/a.ts'); for(const p of ['/etc/passwd','../x','a/../b','C:/x','a//b','./a','']) assert.equal(solve(p),null)`],
  ['defaults', 'Merge plain settings defaults and overrides shallowly into a new object. Ignore undefined override values, preserve false, null and zero. Do not mutate either input.', `export function solve(defaults,overrides) { return defaults }`, `const d={a:1,b:true,c:2}; const o={a:undefined,b:false,c:0,d:null}; assert.deepEqual(solve(d,o),{a:1,b:false,c:0,d:null}); assert.equal(d.b,true); assert.equal(o.a,undefined)`],
  ['json', 'Parse a JSON string and return the parsed value, including null, false and zero. Return the provided fallback only when JSON parsing throws.', `export function solve(text,fallback) { return JSON.parse(text) || fallback }`, `assert.equal(solve('false',true),false); assert.equal(solve('null','x'),null); assert.equal(solve('0',9),0); assert.deepEqual(solve('{',{x:1}),{x:1})`],
  ['group', 'Group records by their status string into a null-prototype object. Missing status uses "unknown". Handle the status "__proto__" safely. Preserve order.', `export function solve(rows) { return {} }`, `const rows=[{status:'open',id:1},{status:'__proto__',id:2},{id:3}]; const g=solve(rows); assert.equal(Object.getPrototypeOf(g),null); assert.deepEqual(g.open,[rows[0]]); assert.deepEqual(g.__proto__,[rows[1]]); assert.deepEqual(g.unknown,[rows[2]])`],
  ['references', 'Collect unique referenced page ids in traversal order from nested nodes: a node of type pageMention has attrs.pageId; recurse through content arrays; ignore missing ids. Accept a null root.', `export function solve(root) { return [] }`, `assert.deepEqual(solve({content:[{type:'pageMention',attrs:{pageId:'a'}},{content:[{type:'pageMention',attrs:{pageId:'b'}},{type:'pageMention',attrs:{pageId:'a'}}]}]}),['a','b']); assert.deepEqual(solve(null),[])`],
] as const

export async function localBenchmark(limit = 10, options?: { agent: 'local' | 'minimax'; configFile: string; budgetUsd: number }) {
  const minimax = options?.agent === 'minimax' ? readMiniMax(options.configFile) : null
  let cost = 0
  const results: Array<{ task: string; ok: boolean; ms: number; steps: number; cost?: number; error?: string }> = []
  for (const [name, task, source, tests] of cases.slice(0, limit)) {
    const root = await mkdtemp(join(tmpdir(), 'one-local-benchmark-'))
    const start = Date.now()
    try {
      await writeFile(join(root, 'solution.mjs'), source)
      await writeFile(join(root, 'check.mjs'), `import assert from 'node:assert/strict'; import {solve} from './solution.mjs';\n${tests}\nconsole.log('PASS');`)
      await writeFile(join(root, 'README.md'), 'Benchmark fixture: change only solution.mjs. check.mjs is the fixed acceptance test. Keep its contents unchanged. No dependencies.\n')
      const checkBefore = await readFile(join(root, 'check.mjs'), 'utf8')
      const syntax = await execFileSafe(process.execPath, ['--check', 'check.mjs'], { cwd: root, timeoutMs: 10000, maxBuffer: 20000 })
      if (syntax.code !== 0) throw new Error(`Invalid benchmark fixture ${name}: ${syntax.stderr}`)
      const result = await runLocal({ agent: minimax ? 'minimax' : 'local', cwd: root,
        ...(minimax ? { inference: miniMaxInference(minimax, Math.max(0, options!.budgetUsd - cost)), model: MINIMAX_MODEL, outputTokens: 16384, context: { tokens: minimax.contextTokens, inputLimit: minimax.contextTokens - 32768, chars: (minimax.contextTokens - 32768) * 1.5 } } : {}), prompt: `Implement this task in solution.mjs: ${task}\nKeep the exported solve function. Change only solution.mjs. Use the configured checks to verify.`, readOnly: false, maxSteps: 20, signal: AbortSignal.timeout(180000), taskMcp: null, log: () => {},
        verify: async signal => {
          if (await readFile(join(root, 'check.mjs'), 'utf8') !== checkBefore) return { ok: false, output: 'Acceptance tests were modified.', unavailable: true }
          signal.throwIfAborted()
          const checked = await execFileSafe(process.execPath, ['check.mjs'], { cwd: root, timeoutMs: 10000, maxBuffer: 20000 })
          return { ok: checked.code === 0, output: checked.stdout + checked.stderr }
        },
      })
      cost += result.cost ?? 0
      results.push({ task: name, cost: result.cost ?? 0, ok: result.ok, ms: Date.now() - start, steps: result.steps, ...(result.error ? { error: result.error } : {}) })
      process.stderr.write(`${name}: ${result.ok ? 'PASS' : 'FAIL'} (${Math.round((Date.now() - start) / 1000)}s)\n`)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  return { model: minimax ? MINIMAX_MODEL : process.env.ONE_CODER_MODEL || 'marcel-coder:latest', costEstimateUsd: cost, kind: `${limit} synthetic CMS-related programming tasks; not a frontier-model comparison`, passed: results.filter(r => r.ok).length, total: results.length, results }
}

if (process.argv[1]?.endsWith('local-benchmark.ts') && process.argv.includes('--run')) {
  const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Use --limit=1 through --limit=10')
  const report = await localBenchmark(limit)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}
