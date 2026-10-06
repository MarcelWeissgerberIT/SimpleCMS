/**
 * One Script — adversarial checks of the sandbox (pure TypeScript, run in Node by the Playwright
 * runner, no browser): no member reaches JavaScript's prototype machinery, no built-in turns a small
 * script into a huge allocation or a long freeze without the step budget, and deep nesting is a
 * script error, never a crash of the parser or the interpreter.
 */
import { test, expect } from '@playwright/test'
import { Interpreter, ScriptError, inspect, parse, syntaxError, type Value } from '../../src/app/features/script/lang'

async function run(code: string, opts: ConstructorParameters<typeof Interpreter>[0] = {}): Promise<{ value: Value; error: ScriptError | null; ms: number }> {
  const it = new Interpreter({ ...opts, onPrint: () => undefined })
  it.setSource(code)
  const t0 = Date.now()
  try {
    const value = await it.run(parse(code))
    return { value, error: null, ms: Date.now() - t0 }
  } catch (e) {
    if (e instanceof ScriptError) return { value: null, error: e, ms: Date.now() - t0 }
    throw e
  }
}

test.describe('One Script sandbox', () => {
  test('no member, index or call reaches the JavaScript prototype machinery', async () => {
    const probes = [
      '"x".constructor',
      '"x"["constructor"]',
      '[1].constructor',
      '[1]["__proto__"]',
      '(1).constructor',
      'today().constructor',
      '3d.constructor',
      'upper.constructor',
      'upper.call',
      'upper.apply',
      'upper.bind',
      '(x => x).constructor',
      '"x".toString',
      '"x".valueOf',
      '[1].hasOwnProperty',
      '"x".__defineGetter__',
      'db.constructor',
      'mail.constructor',
      'mail.__proto__',
      'page.constructor',
    ]
    for (const code of probes) {
      const r = await run(code)
      // either "no such member" or nothing — never a JavaScript function or object
      if (r.error) expect(['no_member', 'unknown_name', 'not_callable', 'bad_args', 'bad_type', 'bad_index'], `${code}: ${r.error.code}`).toContain(r.error.code)
      else expect(r.value, code).toBeNull()
    }
    // records: a field named like a prototype member is just a field
    expect(inspect((await run('let r = {constructor: 1, __proto__: 2}\n[r.constructor, r.__proto__, r.toString]')).value)).toBe('[1, 2, null]')
    // calling through a member never runs a JavaScript function
    for (const code of ['"x".constructor("return 1")()', '[].map.constructor("return 1")()', 'upper.constructor("return globalThis")()']) {
      expect((await run(code)).error, code).not.toBeNull()
    }
  })

  test('repeat / replace / join refuse a result over the text limit before building it', async () => {
    const big = await run('let s = "x".repeat(100000)\ns.repeat(100000)')
    expect(big.error?.code).toBe('too_big')
    expect(big.ms).toBeLessThan(2000)
    const blown = await run('let s = "a".repeat(100000)\ns.replace("a", "b".repeat(1000))')
    expect(blown.error?.code).toBe('too_big')
    expect(blown.ms).toBeLessThan(2000)
    // within the limit they still work
    expect((await run('"ab".repeat(3)')).value).toBe('ababab')
    expect((await run('"a-b-c".replace("-", "+")')).value).toBe('a+b+c')
  })

  test('unique on a long list is quick, counts against the step budget and can be stopped', async () => {
    const r = await run('range(100000).unique().count')
    expect(r.value).toBe(100000)
    expect(r.ms).toBeLessThan(3000)
    // mixed values (lists) go through the budget: a low budget stops it
    const capped = await run('range(5000).map(x => [x]).unique().count', { limits: { steps: 20_000 } })
    expect(capped.error?.code).toBe('steps')
    expect(inspect((await run('[1, "1", 1, [2], [2], null, null, "a", "A"].unique()')).value)).toBe('[1, "1", [2], null, "a", "A"]')
  })

  test('lines() is a list like any other: capped at the list limit', async () => {
    const r = await run('"a\\n".repeat(5000).lines().count', { limits: { list: 1000 } })
    expect(r.error?.code).toBe('too_big')
  })

  test('deep nesting is a syntax error, never a JavaScript stack overflow', async () => {
    const deep = '('.repeat(20000) + '1' + ')'.repeat(20000)
    const e = syntaxError(deep)
    expect(e).not.toBeNull()
    expect(e!.code).toBe('too_deep')
    const list = '['.repeat(20000) + ']'.repeat(20000)
    expect(syntaxError(list)?.code).toBe('too_deep')
    const ifs = 'if true {\n'.repeat(5000) + '1\n' + '}\n'.repeat(5000)
    expect(syntaxError(ifs)?.code).toBe('too_deep')
    // ordinary nesting is fine
    expect(syntaxError('((((1 + 2) * 3) - 4) / 5)')).toBeNull()
  })

  test('a very long operator or method chain runs or stops with a script error — never a stack overflow', async () => {
    for (const code of ['1' + ' + 1'.repeat(30000), '"x"' + '.upper()'.repeat(20000), '[1]' + '.first'.repeat(30000)]) {
      const r = await run(code)
      if (r.error) expect(['too_deep', 'steps', 'no_member', 'bad_type'], r.error.code).toContain(r.error.code)
    }
    expect((await run('1' + ' + 1'.repeat(500))).value).toBe(501)
  })
})
