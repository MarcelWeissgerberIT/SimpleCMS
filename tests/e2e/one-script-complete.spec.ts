/**
 * One Script — the editor's completion engine (pure TypeScript, run in Node by the Playwright runner,
 * no browser): type inference through chains, variables, loops and lambdas; members per kind of value
 * (and not the wrong ones); a database's properties inside where / set / add; option values after
 * `Status = ` (also inside a text being typed); snippets and their tab stops; signature help; docs.
 */
import { test, expect } from '@playwright/test'
import { analyze } from '../../src/app/features/script/editor/analyze'
import { activeParam, callAt, candidatesFor, completionAt, docAt } from '../../src/app/features/script/editor/complete'
import { diffEdit, expandSnippet, shiftSession } from '../../src/app/features/script/editor/snippets'
import type { DbInfo, WsInfo } from '../../src/app/features/script/editor/types'

const TASKS: DbInfo = {
  id: 't1',
  name: 'Tasks',
  props: [
    { name: 'Name', type: 'title', options: [], target: null },
    { name: 'Status', type: 'status', options: ['Open', 'In progress', 'Done'], target: null },
    { name: 'Due', type: 'date', options: [], target: null },
    { name: 'Owner', type: 'person', options: [], target: null },
    { name: 'Project', type: 'relation', options: [], target: 'p1' },
    { name: 'Archived', type: 'checkbox', options: [], target: null },
    { name: 'Due date', type: 'date', options: [], target: null },
    { name: 'Budget', type: 'number', options: [], target: null },
  ],
}
const PROJECTS: DbInfo = { id: 'p1', name: 'Projects', props: [{ name: 'Project', type: 'title', options: [], target: null }, { name: 'Phase', type: 'select', options: ['Plan', 'Build'], target: null }] }

const WS: WsInfo = {
  db: (id, name) => [TASKS, PROJECTS].find((d) => d.id === id || (!!name && d.name.toLowerCase() === name.toLowerCase())) ?? null,
  ref: (id) => (id === 't1' || id === 'p1' ? { kind: 'database', dbId: id } : id === 'r1' ? { kind: 'row', dbId: 't1' } : { kind: 'page', dbId: null }),
  people: () => ['Ada', 'Grace'],
  titles: (dbId) => (dbId === 'p1' ? ['Website', 'Launch'] : []),
}

const DB = 'db(@[Tasks](p:t1))'

/** Candidates at the end of `code` (or at "|"). */
function at(code: string, forced = false) {
  const i = code.indexOf('|')
  const src = i >= 0 ? code.slice(0, i) + code.slice(i + 1) : code
  const off = i >= 0 ? i : code.length
  const ctx = completionAt(src, analyze(src), off, WS, forced)
  return { ctx, labels: ctx ? candidatesFor(ctx, WS).map((c) => c.label) : [], cands: ctx ? candidatesFor(ctx, WS) : [] }
}

test.describe('members after "."', () => {
  test('a database: query methods, not row or text methods', () => {
    const { ctx, labels } = at(`${DB}.`)
    expect(ctx).toMatchObject({ kind: 'member', on: 'query', dbId: 't1' })
    for (const m of ['where', 'sort', 'limit', 'rows', 'count', 'first', 'add', 'group', 'sum', 'schema']) expect(labels).toContain(m)
    for (const m of ['set', 'markdown', 'upper', 'push', 'Status', 'year']) expect(labels).not.toContain(m)
  })

  test('a query keeps its database; add() only on the database itself', () => {
    const { ctx, labels } = at(`${DB}.where(Status = "Open").sort(Due).`)
    expect(ctx).toMatchObject({ kind: 'member', on: 'query', dbId: 't1' })
    expect(labels).toContain('limit')
    expect(labels).not.toContain('add')
  })

  test('rows are a list of rows: list methods', () => {
    const { ctx, labels } = at(`${DB}.rows.`)
    expect(ctx).toMatchObject({ kind: 'member', on: 'list', dbId: 't1' })
    for (const m of ['map', 'join', 'first', 'count', 'where', 'push']) expect(labels).toContain(m)
    for (const m of ['add', 'schema', 'set', 'Status']) expect(labels).not.toContain(m)
  })

  test('a row: its properties first, then the row members — through let, first and loops', () => {
    for (const code of [`let t = ${DB}.first\nt.`, `for t in ${DB}.where(Status = "Open") {\n  t.`, `let open = ${DB}.where(Status != "Done")\nfor t in open.rows {\n  t.`, '@[Fix bug](p:r1).']) {
      const { ctx, labels } = at(code)
      expect(ctx, code).toMatchObject({ kind: 'member', on: 'row', dbId: 't1' })
      expect(labels.slice(0, 3), code).toEqual(['Name', 'Status', 'Due'])
      for (const m of ['set', 'markdown', 'append', 'url', 'trash']) expect(labels, code).toContain(m)
      for (const m of ['where', 'add', 'upper', 'rows']) expect(labels, code).not.toContain(m)
    }
  })

  test('a chain over several lines keeps its database', () => {
    expect(at(`${DB}\n  .where(Status = "Open")\n  .`).ctx).toMatchObject({ on: 'query', dbId: 't1' })
    expect(at(`${DB}\n  .where(Status = `).labels).toContain('"Open"')
    expect(at(`let q = ${DB}\n  .where(Status = "Open")\n  .sort(Due)\nfor t in q {\n  t.`).ctx).toMatchObject({ on: 'row', dbId: 't1' })
  })

  test('a property with spaces completes in backticks', () => {
    const { cands } = at(`let t = ${DB}.first\nt.Due`)
    expect(cands.find((c) => c.label === 'Due date')?.insert).toBe('`Due date`')
  })

  test('a page, a text, a date, people, related rows', () => {
    const page = at('page(@[Wiki](p:w1)).').labels
    expect(page).toEqual(expect.arrayContaining(['children', 'append', 'markdown', 'set']))
    expect(page).not.toContain('where')
    expect(page).not.toContain('Status')
    const text = at('"Hello".').labels
    expect(text).toEqual(expect.arrayContaining(['upper', 'split', 'length']))
    expect(text).not.toContain('where')
    expect(at('today().').labels).toEqual(expect.arrayContaining(['year', 'month', 'format']))
    expect(at(`let t = ${DB}.first\nt.Due.`).labels).toContain('year')
    expect(at(`let t = ${DB}.first\nt.Owner.`).ctx).toMatchObject({ on: 'list' })
    expect(at(`let t = ${DB}.first\nt.Project.first.`).ctx).toMatchObject({ on: 'row', dbId: 'p1' })
    expect(at(`let t = ${DB}.first\nt.Project.first.`).labels).toContain('Phase')
    expect(at('let n = 3 * 4\nn.').labels).toContain('round')
    expect(at('mail.').labels).toEqual(['send'])
    expect(at('me().').labels).toEqual(expect.arrayContaining(['name', 'id']))
  })

  test('lambdas, `it`, groups and selected records know their items', () => {
    expect(at(`${DB}.rows.map(x => x.`).ctx).toMatchObject({ on: 'row', dbId: 't1' })
    expect(at(`${DB}.where(it.`).ctx).toMatchObject({ on: 'row', dbId: 't1' })
    expect(at(`${DB}.rows.find(fn(r) { return r.`).ctx).toMatchObject({ on: 'row', dbId: 't1' })
    const groups = at(`for g in ${DB}.group(Status) {\n  g.`)
    expect(groups.labels).toEqual(expect.arrayContaining(['key', 'rows', 'count']))
    expect(at(`for g in ${DB}.group(Status) {\n  g.rows.first.`).ctx).toMatchObject({ on: 'row', dbId: 't1' })
    const recs = at(`for r in ${DB}.select(Name, Due, Total: 1) {\n  r.`)
    expect(recs.labels).toEqual(expect.arrayContaining(['Name', 'Due', 'Total']))
    expect(at(`for r in ${DB}.select(Name, Due) {\n  r.Due.`).labels).toContain('year')
    expect(at('let rec = {to: "a", n: 1}\nrec.').labels).toEqual(expect.arrayContaining(['to', 'n', 'keys']))
  })
})

test.describe('names', () => {
  test('inside where / sort / group: the database properties', () => {
    const open = at(`${DB}.where(`)
    expect(open.ctx).toMatchObject({ kind: 'name', propsOf: { dbId: 't1' } })
    expect(open.labels.slice(0, 4)).toEqual(['Name', 'Status', 'Due', 'Owner'])
    expect(open.labels).not.toContain('today')
    const typed = at(`${DB}.where(Status = "Open", Du`)
    expect(typed.labels.slice(0, 2)).toEqual(['Due', 'Due date'])
    expect(typed.cands.find((c) => c.label === 'Due date')?.insert).toBe('`Due date`')
    expect(at(`${DB}.sort(St`).labels[0]).toBe('Status')
    expect(at(`${DB}.where(contains(Ow`).labels[0]).toBe('Owner')
  })

  test('set / add: `Property: ` at the start of an argument', () => {
    const set = at(`let t = ${DB}.first\nt.set(`)
    expect(set.labels).toEqual(expect.arrayContaining(['Status:', 'Due:', 'Owner:']))
    expect(set.cands.find((c) => c.label === 'Due date:')?.insert).toBe('`Due date`: ')
    expect(at(`let t = ${DB}.first\nt.set(St`).labels[0]).toBe('Status:')
    expect(at(`${DB}.add("Write", `).labels).toContain('Status:')
    expect(at('mail.send(').labels).toEqual(expect.arrayContaining(['to:', 'subject:', 'body:']))
    expect(at('mail.send(to: "a@b.c", su').labels[0]).toBe('subject:')
  })

  test('variables, functions, keywords and snippets by prefix', () => {
    const { labels, cands } = at('let total = 1\nlet title = "x"\nprint(to')
    expect(labels).toContain('total')
    expect(labels).toContain('today')
    expect(cands.find((c) => c.label === 'today')?.insert).toBe('today(')
    const stmt = at('fo')
    expect(stmt.cands[0]).toMatchObject({ kind: 'snip', label: 'for' })
    expect(at('let x = fo').cands.some((c) => c.kind === 'snip')).toBe(false)
    expect(at('', true).labels).toEqual(expect.arrayContaining(['for', 'if', 'query', 'db', 'today']))
    // nothing typed, not forced: no list
    expect(at('let x = ').ctx).toBeNull()
    expect(at('# a comment wh').ctx).toBeNull()
    expect(at('print("wh').ctx).toBeNull()
  })
})

test.describe('values', () => {
  test('after `Status = `: the options as texts; inside a text being typed too', () => {
    const v = at(`${DB}.where(Status = `)
    expect(v.ctx).toMatchObject({ kind: 'value', quoted: false })
    expect(v.cands.map((c) => c.insert)).toEqual(['"Open"', '"In progress"', '"Done"'])
    const ne = at(`${DB}.where(Status != "In`)
    expect(ne.ctx).toMatchObject({ kind: 'value', quoted: true, prefix: 'In' })
    expect(ne.cands.map((c) => c.insert)).toEqual(['"In progress"'])
    // a closed text: the whole text is replaced
    const closed = at(`${DB}.where(Status = "O|pen")`)
    expect(closed.ctx).toMatchObject({ kind: 'value', from: `${DB}.where(Status = `.length, to: `${DB}.where(Status = "Open"`.length })
    const row = at(`for t in ${DB} {\n  if t.Status = `)
    expect(row.labels).toContain('"Done"')
  })

  test('set(Status: …), checkboxes, dates, people, relations', () => {
    expect(at(`let t = ${DB}.first\nt.set(Status: `).cands.map((c) => c.insert)).toEqual(['"Open"', '"In progress"', '"Done"'])
    expect(at(`${DB}.where(Archived = `).labels).toEqual(['true', 'false'])
    expect(at(`${DB}.where(Due < `).labels).toEqual(expect.arrayContaining(['today()', 'today() + 7d']))
    expect(at(`let t = ${DB}.first\nt.set(Owner: `).labels).toEqual(['me()', '"Ada"', '"Grace"'])
    expect(at(`${DB}.add("x", Project: `).labels).toEqual(['"Website"', '"Launch"'])
  })

  test('no options where nothing is compared with a property', () => {
    expect(at('let Status = ').ctx).toBeNull()
    expect(at(`${DB}.where(Budget > `).ctx).toBeNull()
    expect(at('let s = "Op').ctx).toBeNull()
  })
})

test.describe('snippets, signature help, docs', () => {
  test('a snippet expands with its tab stops and indentation', () => {
    const ex = expandSnippet('for ${1:t} in ${2:list} {\n\t$0\n}', '  ')
    expect(ex.text).toBe('for t in list {\n    \n  }')
    expect(ex.stops).toEqual([
      { n: 1, start: 4, end: 5 },
      { n: 2, start: 9, end: 13 },
    ])
    expect(ex.end).toBe(20)
    // typing into the first place moves the others
    const s = { stops: ex.stops, end: ex.end, at: 0 }
    const d = diffEdit(ex.text, `for task in list {\n    \n  }`)
    expect(shiftSession(s, d.from, d.to, d.len)).toMatchObject({ stops: [{ start: 4, end: 8 }, { start: 12, end: 16 }], end: 23 })
  })

  test('the call around the caret and its argument', () => {
    const code = 'mail.send(to: "a@b.c", subject: "Hi", '
    const c = callAt(code, analyze(code), code.length, WS)
    expect(c).toMatchObject({ name: 'send', index: 2, named: null })
    expect(activeParam(c!.sig, c!.index, c!.named)).toBe(2)
    const named = 'mail.send(subject: "x'
    const n = callAt(named, analyze(named), named.length, WS)
    expect(activeParam(n!.sig, n!.index, n!.named)).toBe(1)
    const where = `${DB}.where(Status = "Open", Due < today() + 3d, `
    const w = callAt(where, analyze(where), where.length, WS)
    expect(w).toMatchObject({ name: 'where', index: 2 })
    expect(activeParam(w!.sig, w!.index, null)).toBe(0)
  })

  test('the doc of a name: a method, a property, a variable', () => {
    const code = `let open = ${DB}.where(Status = "Open")\nopen.count`
    expect(docAt(code, analyze(code), code.indexOf('where') + 2, WS)).toMatchObject({ label: 'where', sig: '.where(condition, …)' })
    expect(docAt(code, analyze(code), code.indexOf('Status') + 1, WS)?.prop).toMatchObject({ name: 'Status', options: ['Open', 'In progress', 'Done'] })
    expect(docAt(code, analyze(code), code.lastIndexOf('open') + 1, WS)).toMatchObject({ variable: true, ty: { k: 'db', db: { id: 't1' } } })
  })
})
