/**
 * One Script — language unit tests (pure TypeScript, run in Node by the Playwright runner, no
 * browser): lexer and parser (incl. errors with line:col), interpreter semantics (let, if, for, fn,
 * lambdas, interpolation, durations, `=` in conditions, records, lists), the limits (endless loop,
 * Stop, depth, sizes), the query builder's code ⇄ model round trip and the editor's analysis.
 */
import { test, expect } from '@playwright/test'
import { Interpreter, ScriptError, SDate, SDuration, errorTextEn, inspect, parse, parseExpression, syntaxError, tokenize, toPlain, type Value } from '../../src/app/features/script/lang'
import { fromCode, toCode, type BQuery } from '../../src/app/features/script/builder/model'
import { analyze, completionAt } from '../../src/app/features/script/editor/analyze'

interface Ran {
  value: Value
  printed: string[]
  error: ScriptError | null
}

async function run(code: string, opts: ConstructorParameters<typeof Interpreter>[0] = {}): Promise<Ran> {
  const printed: string[] = []
  const it = new Interpreter({ ...opts, onPrint: (vs) => void printed.push(vs.map((v) => inspect(v)).join(' ')) })
  it.setSource(code)
  try {
    const value = await it.run(parse(code))
    return { value, printed, error: null }
  } catch (e) {
    if (e instanceof ScriptError) return { value: null, printed, error: e }
    throw e
  }
}

const val = async (code: string) => {
  const r = await run(code)
  if (r.error) throw new Error(errorTextEn(r.error))
  return toPlain(r.value)
}

test.describe('lexer', () => {
  test('tokens, durations, refs and comments', () => {
    const toks = tokenize('let x = 3d + 2h # note\n@[Tasks](p:abc123) @Anna `Fällig am` "a{x}b"', { tolerant: true })
    const kinds = toks.map((t) => t.type)
    expect(kinds).toEqual(['kw', 'ident', 'op', 'dur', 'op', 'dur', 'comment', 'nl', 'ref', 'ref', 'ident', 'str', 'eof'])
    expect(toks[3].value).toEqual({ days: 3, ms: 0 })
    expect(toks[5].value).toEqual({ days: 0, ms: 7_200_000 })
    expect(toks[8].value).toEqual({ kind: 'p', id: 'abc123', label: 'Tasks' })
    expect(toks[9].value).toEqual({ kind: 'name', id: null, label: 'Anna' })
    expect(toks[10]).toMatchObject({ value: 'Fällig am', quoted: true })
  })

  test('newlines inside ( ) are whitespace, blocks inside them count again', () => {
    const nl = (src: string) => tokenize(src).filter((t) => t.type === 'nl').length
    expect(nl('f(1,\n2,\n3)')).toBe(0)
    expect(nl('xs.map(fn(v) {\n  let w = v\n  return w\n})')).toBe(3)
  })

  test('errors carry line:col', () => {
    const e = syntaxError('let a = 1\nlet b = "open')
    expect(e?.code).toBe('unterminated_string')
    expect(e?.pos).toMatchObject({ line: 2, col: 9 })
    expect(errorTextEn(e!)).toBe('2:9 This text has no closing quote.')
    expect(syntaxError('let x = 12abc')?.code).toBe('bad_number')
    expect(syntaxError('x = @[Broken](p:')?.code).toBe('bad_ref')
    expect(syntaxError('a ~ b')?.code).toBe('bad_char')
  })
})

test.describe('parser', () => {
  test('statements and precedence', () => {
    const p = parse('let a = 1 + 2 * 3\nif a > 5 and not false { print(a) } else { print(0) }')
    expect(p.body.map((s) => s.type)).toEqual(['Let', 'If'])
    const e = parseExpression('1 + 2 * 3')
    expect(e).toMatchObject({ type: 'Binary', op: '+', right: { type: 'Binary', op: '*' } })
  })

  test('`=` is equality inside conditions, assignment only as a statement', () => {
    const p = parse('x = 1\nlet ok = Status = "Open"\nif Status = "Open" { }')
    expect(p.body[0].type).toBe('Assign')
    expect(p.body[1]).toMatchObject({ type: 'Let', value: { type: 'Binary', op: '=' } })
    expect(p.body[2]).toMatchObject({ type: 'If', test: { type: 'Binary', op: '=' } })
    // a statement whose left side can't take a value compares (the query tester's `count = 3`)
    expect(parse('1 + 2 = 3 and true').body[0]).toMatchObject({ type: 'ExprStmt', expr: { type: 'Logical', op: 'and', left: { type: 'Binary', op: '=' } } })
  })

  test('method chains across lines, named args, sort sugar, lambdas', () => {
    const p = parse('db(@Tasks)\n  .where(Status = "Open")\n  .sort(Due desc, Name)\n  .limit(3)')
    expect(p.body).toHaveLength(1)
    const call = parseExpression('mail.send(to: a, subject: "Hi")')
    expect(call).toMatchObject({ type: 'Call', args: [{ name: 'to' }, { name: 'subject' }] })
    const sort = parseExpression('q.sort(Due desc)')
    expect(sort).toMatchObject({ type: 'Call', args: [{ order: 'desc' }] })
    expect(parseExpression('xs.map(x => x.Name)')).toMatchObject({ args: [{ value: { type: 'Lambda' } }] })
    expect(parseExpression('(a, b) => a + b')).toMatchObject({ type: 'Lambda', params: [{ name: 'a' }, { name: 'b' }] })
    expect(parseExpression('x => {to: x}')).toMatchObject({ type: 'Lambda', body: { type: 'Record' } })
  })

  test('syntax errors point at the place', () => {
    const e = syntaxError('let a = (1 + 2\nprint(a)')
    expect(e).not.toBeNull()
    expect(e!.pos!.line).toBeGreaterThanOrEqual(1)
    const e2 = syntaxError('print("a" "b")')
    expect(e2?.code).toBe('expected')
    expect(e2?.pos).toMatchObject({ line: 1, col: 11 })
    expect(syntaxError('let = 3')).toMatchObject({ code: 'expected', pos: { line: 1, col: 5 } })
  })
})

test.describe('interpreter', () => {
  test('let, assignment, if / else, while, for with index, break / continue', async () => {
    expect(await val('let x = 1\nx = x + 1\nx')).toBe(2)
    expect(await val('let s = 0\nfor i, v in [10, 20, 30] { s = s + i * v }\ns')).toBe(80)
    expect(await val('let n = 0\nwhile n < 10 { n = n + 1\n if n = 5 { break } }\nn')).toBe(5)
    expect(await val('let out = []\nfor v in range(6) { if v % 2 = 0 { continue }\n out.push(v) }\nout')).toEqual([1, 3, 5])
    expect(await val('let r = ""\nif 1 > 2 { r = "a" } else if 2 > 1 { r = "b" } else { r = "c" }\nr')).toBe('b')
  })

  test('functions, defaults, named args, recursion, closures, lambdas', async () => {
    expect(await val('fn add(a, b = 10) { return a + b }\nadd(1) + add(1, b: 2)')).toBe(14)
    expect(await val('fn fib(n) { if n < 2 { return n }\n return fib(n - 1) + fib(n - 2) }\nfib(12)')).toBe(144)
    expect(await val('fn counter() { let n = 0\n return () => { n = n + 1\n return n } }\nlet c = counter()\nc()\nc()\nc()')).toBe(3)
    expect(await val('[3, 1, 2].map(x => x * 2).sort()')).toEqual([2, 4, 6])
    // helpers may be written below their use
    expect(await val('twice(4)\nfn twice(x) { return x * 2 }')).toBe(8)
  })

  test('interpolation, escapes, text helpers', async () => {
    expect(await val('let n = 3\n"{n} tasks, {n * 2} rows"')).toBe('3 tasks, 6 rows')
    expect(await val('"a\\{b\\}\\n"')).toBe('a{b}\n')
    expect(await val("'plain {x}'")).toBe('plain {x}')
    expect(await val('upper("abc") + "abc".upper() + len("äöü")')).toBe('ABCABC3')
    expect(await val('"a, b ,c".split(",").map(x => x.trim()).join("|")')).toBe('a|b|c')
    expect(await val('"Hello".contains("ELL") and "x" in "xyz"')).toBe(true)
    expect(await val('number("1.234,5") + number("2")')).toBe(1236.5)
  })

  test('dates and durations', async () => {
    expect(await val('date("2026-10-05") + 3d')).toBe('2026-10-08')
    expect(await val('date("2026-10-05") - 1w')).toBe('2026-09-28')
    expect(await val('days_between(date("2026-10-01"), date("2026-10-05"))')).toBe(4)
    expect(await val('date("2026-10-05") - date("2026-10-01")')).toBe('4d')
    expect(await val('2h + 30m')).toBe('2h 30m')
    expect(await val('date("2026-10-05") < today() + 100000d')).toBe(true)
    expect(await val('format(date("2026-10-05"), "dd.MM.yyyy")')).toBe('05.10.2026')
    expect(await val('datetime("2026-10-05 14:30").hour')).toBe(14)
    expect(await val('date("2026-10-05") = "2026-10-05"')).toBe(true)
    const r = await run('today()')
    expect(r.value).toBeInstanceOf(SDate)
    expect((await run('3d')).value).toBeInstanceOf(SDuration)
  })

  test('records, lists and the query methods on plain lists', async () => {
    expect(await val('let r = {to: "a@b.c", subject: "Hi"}\nr.subject + r["to"]')).toBe('Hia@b.c')
    expect(await val('let r = {a: 1}\nr.b = 2\nkeys(r)')).toEqual(['a', 'b'])
    const rows = 'let rows = [{Status: "Open", n: 3, Due: date("2026-10-07")}, {Status: "Done", n: 1, Due: date("2026-10-01")}, {Status: "Open", n: 2, Due: null}]\n'
    expect(await val(`${rows}rows.where(Status = "Open").count`)).toBe(2)
    expect(await val(`${rows}rows.where(Status = "Open", n > 2).count`)).toBe(1)
    expect(await val(`${rows}rows.sort(n desc).map(r => r.n)`)).toEqual([3, 2, 1])
    expect(await val(`${rows}rows.sort(Due).map(r => r.n)`)).toEqual([1, 3, 2])
    expect(await val(`${rows}rows.sum(n)`)).toBe(6)
    expect(await val(`${rows}rows.group(Status).map(g => "{g.key}:{g.count}")`)).toEqual(['Open:2', 'Done:1'])
    expect(await val(`${rows}rows.select(Status, double: n * 2).first`)).toEqual({ Status: 'Open', double: 6 })
    expect(await val('[1, 2, 3].find(it > 1)')).toBe(2)
    expect(await val('[1, [2, 3]].flat().reverse()')).toEqual([3, 2, 1])
  })

  test('truth, null and equality rules', async () => {
    expect(await val('null = ""')).toBe(true)
    expect(await val('1 + 2 = 3')).toBe(true)
    expect(await val('[] = null')).toBe(true)
    expect(await val('null < 3')).toBe(false)
    expect(await val('empty("") and empty([]) and not empty(0)')).toBe(true)
    expect(await val('"Open" = "open"')).toBe(false)
    expect(await val('[1, {a: 2}] = [1, {a: 2}]')).toBe(true)
  })

  test('runtime errors carry the place', async () => {
    const r = await run('let a = 1\nlet b = a / 0')
    expect(r.error?.code).toBe('div_zero')
    expect(r.error?.pos).toMatchObject({ line: 2 })
    const u = await run('print(nope)')
    expect(u.error).toMatchObject({ code: 'unknown_name', params: { name: 'nope' } })
    expect(errorTextEn(u.error!)).toBe('1:7 Unknown name nope.')
    expect((await run('[1, 2][5]')).error?.code).toBe('index')
    expect((await run('"a" - 1')).error?.code).toBe('bad_type')
    expect((await run('error("Custom stop")')).error).toMatchObject({ code: 'custom', params: { message: 'Custom stop' } })
    expect((await run('break')).error?.code).toBe('break_outside')
  })

  test('print and the value of the last expression', async () => {
    const r = await run('print("a", 1, [1, "b"])\nlog({x: 1})\n42')
    expect(r.printed).toEqual(['a 1 [1, "b"]', '{x: 1}'])
    expect(r.value).toBe(42)
  })
})

test.describe('limits', () => {
  test('an endless loop stops at the step budget', async () => {
    const r = await run('let n = 0\nwhile true { n = n + 1 }', { limits: { steps: 20_000 } })
    expect(r.error?.code).toBe('steps')
    expect(r.error?.pos?.line).toBe(2)
  })

  test('the wall-clock budget stops a long run (and can be extended once)', async () => {
    let asked = 0
    const r = await run('while true { }', { limits: { ms: 60 }, onTimeout: async () => (asked++, true) })
    expect(r.error?.code).toBe('timeout')
    expect(asked).toBe(1)
  })

  test('Stop ends a run at its next step', async () => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 50)
    const t0 = Date.now()
    const r = await run('while true { let x = 1 }', { signal: ctrl.signal })
    expect(r.error?.code).toBe('stopped')
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  test('recursion depth and list / text sizes are capped', async () => {
    expect((await run('fn f(n) { return f(n + 1) }\nf(0)')).error?.code).toBe('depth')
    expect((await run('range(10000000)', { limits: { list: 1000 } })).error?.code).toBe('too_big')
    expect((await run('let s = "x"\nwhile true { s = s + s }', { limits: { text: 10_000 } })).error?.code).toBe('too_big')
  })

  test('no way out of the sandbox: unknown globals are just unknown', async () => {
    for (const name of ['window', 'document', 'fetch', 'eval', 'Function', 'globalThis', 'localStorage', 'constructor']) {
      expect((await run(`${name}`)).error?.code, name).toBe('unknown_name')
    }
    expect((await run('"x".constructor')).error?.code).toBe('no_member')
    expect((await run('{a: 1}.__proto__')).value).toBeNull()
  })
})

test.describe('query builder model', () => {
  const REF = '@[Aufgaben](p:abc123)'

  test('code → model → code round trip', () => {
    const code = `db(${REF}).where(Status = "Offen", Fällig < today() + 3d).sort(Fällig desc, Name).limit(10).select(Name, Status)`
    const q = fromCode(code)!
    expect(q).not.toBeNull()
    expect(q.db).toMatchObject({ id: 'abc123', label: 'Aufgaben' })
    expect(q.where.items).toEqual([
      { prop: 'Status', op: '=', value: { kind: 'text', v: 'Offen' } },
      { prop: 'Fällig', op: '<', value: { kind: 'today', days: 3 } },
    ])
    expect(q.sort).toEqual([
      { prop: 'Fällig', desc: true },
      { prop: 'Name', desc: false },
    ])
    expect(q.limit).toBe(10)
    expect(q.select).toEqual(['Name', 'Status'])
    expect(fromCode(toCode(q))).toEqual(q)
  })

  test('or groups, contains, empty, people, backticks', () => {
    const code = `db(${REF}).where(Status = "Offen" or (Prio = "Hoch" and not empty(\`Fällig am\`)), Owner.contains(@[Anna](u:p1)))`
    const q = fromCode(code)
    expect(q).toBeNull() // an `or` next to another condition is two levels: not the builder's
    const q2 = fromCode(`db(${REF}).where(Status = "Offen" or (Prio = "Hoch" and not empty(\`Fällig am\`)))`)!
    expect(q2.where.op).toBe('or')
    expect(q2.where.items[1]).toEqual({ op: 'and', items: [{ prop: 'Prio', op: '=', value: { kind: 'text', v: 'Hoch' } }, { prop: 'Fällig am', op: 'not_empty', value: { kind: 'none' } }] })
    expect(toCode(q2)).toContain('`Fällig am`')
    const q3 = fromCode(`db(${REF}).where(Owner.contains(@[Anna](u:p1)), not Tags.contains("x"))`)!
    expect(q3.where.items).toEqual([
      { prop: 'Owner', op: 'contains', value: { kind: 'person', id: 'p1', label: 'Anna' } },
      { prop: 'Tags', op: 'not_contains', value: { kind: 'text', v: 'x' } },
    ])
  })

  test('code the builder cannot show stays text', () => {
    for (const code of ['let x = db(@Tasks)\nx', 'db(@Tasks).where(n * 2 > 3)', 'db(@Tasks).limit(3).where(Status = "Open")', 'db(@Tasks).map(x => x)', 'print(1)', 'db(@Tasks) # trailing comment']) {
      expect(fromCode(code), code).toBeNull()
    }
    expect(fromCode('# my query\ndb(@Tasks)')?.head).toBe('# my query')
  })

  test('the builder writes readable code', () => {
    const q: BQuery = { db: { code: REF, id: 'abc123', label: 'Aufgaben' }, where: { op: 'and', items: [{ prop: 'Status', op: '=', value: { kind: 'text', v: 'Offen' } }] }, sort: [], limit: 5, select: [], head: '' }
    expect(toCode(q)).toBe(`db(${REF}).where(Status = "Offen").limit(5)`)
    const long = { ...q, sort: [{ prop: 'Fällig', desc: false }], select: ['Name', 'Status', 'Fällig'] }
    expect(toCode(long).split('\n')).toHaveLength(5)
  })
})

test.describe('editor analysis', () => {
  test('variables know their database, completion knows the context', () => {
    const code = 'let open = db(@[Tasks](p:t1)).where(Status = "Open")\nfor t in open {\n  t.\n}'
    const a = analyze(code)
    expect(a.vars.get('open')).toMatchObject({ kind: 'query', dbId: 't1' })
    expect(a.vars.get('t')).toMatchObject({ kind: 'row', dbId: 't1' })
    const at = code.indexOf('t.\n') + 2
    expect(completionAt(code, a, at)).toMatchObject({ kind: 'member', on: 'row', dbId: 't1' })
    const typing = 'db(@Ta'
    expect(completionAt(typing, analyze(typing), typing.length)).toMatchObject({ kind: 'ref', query: 'Ta' })
    const inWhere = 'db(@[Tasks](p:t1)).where(St'
    expect(completionAt(inWhere, analyze(inWhere), inWhere.length)).toMatchObject({ kind: 'name', prefix: 'St', propsOf: { dbId: 't1' } })
    const chip = 'db(@[Tasks](p:t1))'
    expect(completionAt(chip, analyze(chip), chip.indexOf(')') )).toBeNull()
  })
})
