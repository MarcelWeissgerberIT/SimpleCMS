/**
 * Spreadsheet engine unit tests (pure TypeScript, run in Node by the Playwright runner — no
 * browser): the parser, the built-in library, datasets DS(…), the dependency graph, reference
 * adjustment, input parsing / formats and the safety limits.
 */
import { test, expect } from '@playwright/test'
import {
  Workbook,
  parseA1,
  callFunction,
  evaluateExpr,
  setCustomFunctions,
  getFunction,
  listFunctions,
  shiftFormula,
  adjustFormula,
  adjustRect,
  renameSheetRefs,
  dropSheetRefs,
  canonicalInput,
  literal,
  formatValue,
  formatWithCode,
  paintFormula,
  callAt,
  wordAt,
  canPoint,
  datasetOf,
  isErr,
  MAX_FORMULA,
  type CellValue,
  type SheetSource,
  type DatasetSource,
} from '../../src/app/features/sheets/engine'
import type { CustomFunction } from '../../src/app/store/types'

type Cells = Record<string, string>

function sheet(id: string, name: string, cells: Cells, rows = 60, cols = 30): SheetSource {
  return { id, name, rows, cols, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v }])) }
}

function book(cells: Cells, extra: { sheets?: SheetSource[]; datasets?: DatasetSource[] } = {}): Workbook {
  const wb = new Workbook()
  wb.sync([sheet('s1', 'Sheet1', cells), ...(extra.sheets ?? [])], extra.datasets ?? [])
  return wb
}

function val(wb: Workbook, addr: string, sheetId = 's1'): CellValue {
  const p = parseA1(addr)!
  return wb.get(sheetId, p.row, p.col).value
}

/** Value of one formula with some cells around it. */
function calc(formula: string, cells: Cells = {}): CellValue {
  return val(book({ ...cells, Z1: formula }), 'Z1')
}

const code = (v: CellValue) => (isErr(v) ? v.code : v)
const near = (v: CellValue, x: number, digits = 6) => {
  expect(typeof v).toBe('number')
  expect(v as number).toBeCloseTo(x, digits)
}

const nums: Cells = { A1: '10', A2: '20', A3: '30', A4: 'text', A5: '', B1: '1', B2: '2', B3: '3' }

test.describe('parser and operators', () => {
  test('precedence follows Excel', () => {
    expect(calc('=1+2*3')).toBe(7)
    expect(calc('=(1+2)*3')).toBe(9)
    expect(calc('=-2^2')).toBe(4)
    expect(calc('=2^3^2')).toBe(64)
    expect(calc('=50%')).toBe(0.5)
    expect(calc('=10*20%')).toBe(2)
    expect(calc('="a"&1+1')).toBe('a2')
    expect(calc('=1+1=2')).toBe(true)
    expect(calc('=1<>2')).toBe(true)
    expect(calc('=3>=3')).toBe(true)
    expect(calc('="abc"="ABC"')).toBe(true)
  })

  test('comma and semicolon separators, empty arguments, nested parentheses', () => {
    expect(calc('=SUM(1,2;3)')).toBe(6)
    expect(calc('=IF(TRUE;;1)')).toBe(0)
    expect(calc('=((((1))))+1')).toBe(2)
    expect(calc('=sum(1;2)')).toBe(3)
  })

  test('references: relative, absolute, ranges, whole columns, other sheets', () => {
    const wb = book(
      { A1: '1', A2: '2', A3: '3', B1: '=$A$1+A2', B2: '=SUM(A:A)', B3: "=SUM('Q1 Budget'!A1:A2)", B4: '=Data!B2*2', B5: '=Nope!A1' },
      { sheets: [sheet('s2', 'Q1 Budget', { A1: '5', A2: '7' }), sheet('s3', 'Data', { B2: '21' })] },
    )
    expect(val(wb, 'B1')).toBe(3)
    expect(val(wb, 'B2')).toBe(6)
    expect(val(wb, 'B3')).toBe(12)
    expect(val(wb, 'B4')).toBe(42)
    expect(code(val(wb, 'B5'))).toBe('#REF!')
  })

  test('errors are values', () => {
    expect(code(calc('=1/0'))).toBe('#DIV/0!')
    expect(code(calc('=NOSUCH(1)'))).toBe('#NAME?')
    expect(code(calc('=Revenue'))).toBe('#NAME?')
    expect(code(calc('=1+"x"'))).toBe('#VALUE!')
    expect(code(calc('=SUM(1;'))).toBe('#ERROR!')
    expect(code(calc('=#N/A'))).toBe('#N/A')
    expect(code(calc('=SQRT(-1)'))).toBe('#NUM!')
    expect(code(calc('=A1:A3'))).toBe('#VALUE!')
    expect(code(calc('=1/0+1'))).toBe('#DIV/0!')
    expect(calc('=IFERROR(1/0; "safe")')).toBe('safe')
  })
})

test.describe('built-in library', () => {
  test('math', () => {
    expect(calc('=SUM(A1:A5; 5)', nums)).toBe(65)
    expect(calc('=PRODUCT(B1:B3)', nums)).toBe(6)
    expect(calc('=ROUND(2.345; 2)')).toBe(2.35)
    expect(calc('=ROUND(1.005; 2)')).toBe(1.01)
    expect(calc('=ROUND(-2.5)')).toBe(-3)
    expect(calc('=ROUND(1234; -2)')).toBe(1200)
    expect(calc('=ROUNDUP(2.341; 2)')).toBe(2.35)
    expect(calc('=ROUNDDOWN(2.349; 2)')).toBe(2.34)
    expect(calc('=INT(-2.5)')).toBe(-3)
    expect(calc('=ABS(-4)')).toBe(4)
    expect(calc('=SQRT(16)')).toBe(4)
    expect(calc('=POWER(2; 10)')).toBe(1024)
    expect(calc('=MOD(10; 3)')).toBe(1)
    expect(calc('=MOD(-1; 3)')).toBe(2)
    expect(code(calc('=MOD(1; 0)'))).toBe('#DIV/0!')
    expect(calc('=CEILING(23; 5)')).toBe(25)
    expect(calc('=FLOOR(23; 5)')).toBe(20)
    expect(calc('=CEILING(2.31; 0.1)')).toBe(2.4)
    near(calc('=PI()'), Math.PI)
  })

  test('finance', () => {
    near(calc('=PMT(5%/12; 36; 10000)'), -299.7110, 3)
    near(calc('=PMT(0; 10; 1000)'), -100)
    near(calc('=FV(3%; 10; -100)'), 1146.388, 2)
    near(calc('=NPV(8%; 100; 200; 300)'), 502.0273, 3)
  })

  test('statistics and counting', () => {
    expect(calc('=AVERAGE(A1:A5)', nums)).toBe(20)
    expect(code(calc('=AVERAGE(A4:A5)', nums))).toBe('#DIV/0!')
    expect(calc('=MIN(A1:A3)', nums)).toBe(10)
    expect(calc('=MAX(A1:A3; 99)', nums)).toBe(99)
    expect(calc('=MEDIAN(3; 1; 2; 10)')).toBe(2.5)
    near(calc('=STDEV(2; 4; 4; 4; 5; 5; 7; 9)'), 2.13809, 4)
    expect(calc('=COUNT(A1:A5)', nums)).toBe(3)
    expect(calc('=COUNTA(A1:A5)', nums)).toBe(4)
    expect(calc('=COUNTBLANK(A1:A5)', nums)).toBe(1)
    expect(calc('=COUNTIF(A1:A3; ">15")', nums)).toBe(2)
    expect(calc('=COUNTIF(C1:C4; "a*")', { C1: 'apple', C2: 'Avocado', C3: 'pear', C4: 'a' })).toBe(3)
    expect(calc('=COUNTIF(C1:C4; "<>pear")', { C1: 'apple', C2: 'Avocado', C3: 'pear', C4: 'a' })).toBe(3)
    const sales: Cells = { A1: 'Nord', A2: 'Süd', A3: 'Nord', A4: 'Nord', B1: '5', B2: '7', B3: '-1', B4: '4', C1: '100', C2: '200', C3: '300', C4: '400' }
    expect(calc('=COUNTIFS(A1:A4; "Nord"; B1:B4; ">0")', sales)).toBe(2)
    expect(calc('=SUMIF(A1:A4; "Nord"; C1:C4)', sales)).toBe(800)
    expect(calc('=SUMIF(B1:B4; ">0")', sales)).toBe(16)
    expect(calc('=SUMIFS(C1:C4; A1:A4; "Nord"; B1:B4; ">0")', sales)).toBe(500)
    expect(calc('=AVERAGEIF(A1:A4; "Nord"; C1:C4)', sales)).toBeCloseTo(266.6667, 3)
    expect(code(calc('=SUMIF(A1:A4; "Nord"; C1:C2)', sales))).toBe('#VALUE!')
  })

  test('logic', () => {
    expect(calc('=IF(A1>15; "high"; "low")', nums)).toBe('low')
    expect(calc('=IF(FALSE; 1)')).toBe(false)
    expect(calc('=IFS(A2>25; "A"; A2>15; "B"; TRUE; "C")', nums)).toBe('B')
    expect(code(calc('=IFS(FALSE; 1)'))).toBe('#N/A')
    expect(calc('=IFNA(#N/A; "none")')).toBe('none')
    expect(calc('=AND(TRUE; 1; B1:B3)', nums)).toBe(true)
    expect(calc('=OR(FALSE; 0)')).toBe(false)
    expect(calc('=XOR(TRUE; TRUE; TRUE)')).toBe(true)
    expect(calc('=NOT(0)')).toBe(true)
    expect(calc('=SWITCH(2; 1; "one"; 2; "two"; "many")')).toBe('two')
    expect(calc('=SWITCH(9; 1; "one"; "many")')).toBe('many')
    expect(code(calc('=SWITCH(9; 1; "one")'))).toBe('#N/A')
    // only the chosen branch runs
    expect(calc('=IF(TRUE; 1; NOSUCH())')).toBe(1)
  })

  test('text', () => {
    const t: Cells = { A1: '  Ada   Lovelace ', A2: 'ada lovelace', A3: 'x-y-z' }
    expect(calc('=LEN("äöü")')).toBe(3)
    expect(calc('=LEFT("Spreadsheet"; 6)')).toBe('Spread')
    expect(calc('=RIGHT("Spreadsheet"; 5)')).toBe('sheet')
    expect(calc('=MID("Spreadsheet"; 2; 4)')).toBe('prea')
    expect(calc('=UPPER("abc")')).toBe('ABC')
    expect(calc('=LOWER("ABC")')).toBe('abc')
    expect(calc('=PROPER(A2)', t)).toBe('Ada Lovelace')
    expect(calc('=TRIM(A1)', t)).toBe('Ada Lovelace')
    expect(calc('=CONCAT("a"; 1; TRUE)')).toBe('a1TRUE')
    expect(calc('=CONCAT(B1:B3)', nums)).toBe('123')
    expect(calc('=TEXTJOIN(", "; TRUE; A1:A5)', nums)).toBe('10, 20, 30, text')
    expect(calc('=SUBSTITUTE(A3; "-"; "/")', t)).toBe('x/y/z')
    expect(calc('=SUBSTITUTE(A3; "-"; "/"; 2)', t)).toBe('x-y/z')
    expect(calc('=FIND("b"; "abcb")')).toBe(2)
    expect(code(calc('=FIND("B"; "abc")'))).toBe('#VALUE!')
    expect(calc('=SEARCH("B"; "abc")')).toBe(2)
    expect(calc('=SEARCH("c*"; "abcd")')).toBe(3)
    expect(calc('=TEXT(1234.567; "#,##0.00")')).toBe('1,234.57')
    expect(calc('=TEXT(0.256; "0%")')).toBe('26%')
    expect(calc('=TEXT(DATE(2026;10;3); "yyyy-mm-dd")')).toBe('2026-10-03')
    expect(calc('=TEXT(DATE(2026;10;3); "dd.mm.yyyy")')).toBe('03.10.2026')
    expect(calc('=VALUE("12%")')).toBe(0.12)
    expect(code(calc('=VALUE("abc")'))).toBe('#VALUE!')
  })

  test('dates', () => {
    expect(calc('=DATE(2026; 10; 3)')).toBe(46298)
    expect(calc('=DATE(2026; 14; 1)')).toBe(calc('=DATE(2027; 2; 1)'))
    expect(calc('=YEAR(DATE(2026; 10; 3))')).toBe(2026)
    expect(calc('=MONTH("2026-10-03")')).toBe(10)
    expect(calc('=DAY(A1)', { A1: '2026-10-03' })).toBe(3)
    expect(calc('=WEEKDAY(DATE(2026; 10; 3))')).toBe(7)
    expect(calc('=WEEKDAY(DATE(2026; 10; 3); 2)')).toBe(6)
    expect(calc('=EDATE(DATE(2026; 1; 31); 1)')).toBe(calc('=DATE(2026; 2; 28)'))
    expect(calc('=EOMONTH(DATE(2026; 2; 10); 0)')).toBe(calc('=DATE(2026; 2; 28)'))
    expect(calc('=DATEDIF(DATE(2020;5;15); DATE(2026;10;3); "Y")')).toBe(6)
    expect(calc('=DATEDIF(DATE(2026;1;31); DATE(2026;3;1); "M")')).toBe(1)
    expect(calc('=DATEDIF(DATE(2026;1;1); DATE(2026;1;31); "D")')).toBe(30)
    expect(code(calc('=DATEDIF(DATE(2027;1;1); DATE(2026;1;1); "D")'))).toBe('#NUM!')
    expect(calc('=NETWORKDAYS(DATE(2026;9;28); DATE(2026;10;9))')).toBe(10)
    expect(calc('=NETWORKDAYS(DATE(2026;9;28); DATE(2026;10;9); A1)', { A1: '2026-10-03' })).toBe(10)
    expect(calc('=NETWORKDAYS(DATE(2026;9;28); DATE(2026;10;9); A1)', { A1: '2026-10-05' })).toBe(9)
    const today = calc('=TODAY()') as number
    const d = new Date()
    expect(today).toBe(calc(`=DATE(${d.getFullYear()}; ${d.getMonth() + 1}; ${d.getDate()})`))
    expect(Math.floor(calc('=NOW()') as number)).toBe(today)
    const wb = book({ A1: '=TODAY()+7', A2: '=DATE(2026;1;1)', A3: '=A2', A4: '=YEAR(A2)' })
    expect(wb.get('s1', 0, 0).hint).toBe('date')
    expect(wb.get('s1', 2, 0).hint).toBe('date')
    expect(wb.get('s1', 3, 0).hint).toBe(null)
  })

  test('lookup', () => {
    const tbl: Cells = { A1: 'Nord', B1: '10', C1: 'x', A2: 'Ost', B2: '20', C2: 'y', A3: 'Süd', B3: '30', C3: 'z', E1: '0', E2: '100', E3: '500', F1: 'S', F2: 'M', F3: 'L' }
    expect(calc('=VLOOKUP("ost"; A1:C3; 3; FALSE)', tbl)).toBe('y')
    expect(code(calc('=VLOOKUP("west"; A1:C3; 2; FALSE)', tbl))).toBe('#N/A')
    expect(code(calc('=VLOOKUP("Ost"; A1:C3; 4; FALSE)', tbl))).toBe('#REF!')
    expect(calc('=VLOOKUP(250; E1:F3; 2)', tbl)).toBe('M')
    expect(calc('=VLOOKUP("S*"; A1:C3; 2; FALSE)', tbl)).toBe(30)
    expect(calc('=HLOOKUP(20; B1:B3; 1; FALSE)', { B1: '10', B2: '20', B3: '30' })).toBe(10)
    expect(calc('=HLOOKUP("b"; A1:C2; 2; FALSE)', { A1: 'a', B1: 'b', C1: 'c', A2: '1', B2: '2', C2: '3' })).toBe(2)
    expect(calc('=XLOOKUP("Süd"; A1:A3; B1:B3)', tbl)).toBe(30)
    expect(calc('=XLOOKUP("West"; A1:A3; B1:B3; "–")', tbl)).toBe('–')
    expect(calc('=XLOOKUP(250; E1:E3; F1:F3; ""; -1)', tbl)).toBe('M')
    expect(calc('=XLOOKUP(250; E1:E3; F1:F3; ""; 1)', tbl)).toBe('L')
    expect(calc('=INDEX(A1:C3; 2; 3)', tbl)).toBe('y')
    expect(calc('=INDEX(B1:B3; 3)', tbl)).toBe(30)
    expect(code(calc('=INDEX(A1:C3; 4; 1)', tbl))).toBe('#REF!')
    expect(calc('=SUM(INDEX(A1:C3; 0; 2))', tbl)).toBe(60)
    expect(calc('=MATCH("Süd"; A1:A3; 0)', tbl)).toBe(3)
    expect(calc('=MATCH(120; E1:E3)', tbl)).toBe(2)
    expect(calc('=ROWS(A1:C3)')).toBe(3)
    expect(calc('=COLUMNS(A1:C3)')).toBe(3)
  })

  test('information', () => {
    expect(calc('=ISBLANK(A5)', nums)).toBe(true)
    expect(calc('=ISBLANK(A1)', nums)).toBe(false)
    expect(calc('=ISNUMBER(A1)', nums)).toBe(true)
    expect(calc('=ISTEXT(A4)', nums)).toBe(true)
    expect(calc('=ISERROR(1/0)')).toBe(true)
    expect(calc('=ISERROR(1)')).toBe(false)
    expect(calc('=ISNA(NA())')).toBe(true)
    expect(calc('=ISLOGICAL(TRUE)')).toBe(true)
  })

  test('every built-in has EN + DE descriptions, an example and a known category', () => {
    const cats = new Set(['data', 'math', 'stats', 'logic', 'text', 'date', 'lookup', 'info'])
    const builtins = listFunctions().filter((f) => !f.custom)
    expect(builtins.length).toBeGreaterThanOrEqual(75)
    expect(builtins[0].name).toBe('DS')
    for (const f of builtins) {
      expect(f.description.en.length, f.name).toBeGreaterThan(5)
      expect(f.description.de.length, f.name).toBeGreaterThan(5)
      expect(f.example.startsWith('='), f.name).toBe(true)
      expect(cats.has(f.category), f.name).toBe(true)
    }
    // each example parses and evaluates without throwing
    for (const f of builtins) {
      const v = calc(f.example, { A1: '1', B1: '2', A2: '3' })
      expect(isErr(v) ? v.code : 'ok', f.name).not.toBe('#ERROR!')
    }
    for (const n of ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'SUMIF', 'SUMIFS', 'AVERAGEIF', 'PRODUCT', 'MEDIAN', 'STDEV', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'ABS', 'SQRT', 'POWER', 'MOD', 'CEILING', 'FLOOR', 'PI', 'IF', 'IFS', 'IFERROR', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'LEN', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'CONCAT', 'TEXTJOIN', 'SUBSTITUTE', 'FIND', 'SEARCH', 'TEXT', 'VALUE', 'TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'EDATE', 'EOMONTH', 'DATEDIF', 'NETWORKDAYS', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'ROWS', 'COLUMNS', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISERROR', 'PMT', 'FV', 'NPV', 'DS'])
      expect(getFunction(n), n).not.toBeNull()
    expect(getFunction('VLOOKUP')!.keywords).toContain('SVERWEIS')
  })
})

test.describe('datasets DS(…)', () => {
  const grid: Cells = { A1: '1', A2: '2', A3: '3', B2: '10', B3: '20', C1: '100', C2: '200', D1: 'x' }

  test('aggregates flatten datasets; shared cells count once', () => {
    expect(calc('=SUM(DS(A1:A3; C1:C2))', grid)).toBe(306)
    expect(calc('=SUM(DS(A1:A3; A2:B3))', grid)).toBe(36)
    expect(calc('=SUM(DS(A1:A3); DS(C1:C2))', grid)).toBe(306)
    expect(calc('=COUNT(DS(A1:A3; A1:A3))', grid)).toBe(3)
    expect(calc('=AVERAGE(DS(A1:A3; C1))', grid)).toBe(26.5)
    expect(calc('=MAX(DS(A:A; B2:B3))', grid)).toBe(20)
    expect(calc('=COUNTIF(DS(A1:A3; C1:C2); ">2")', grid)).toBe(3)
    expect(calc('=TEXTJOIN("-"; TRUE; DS(A1:A2; D1))', grid)).toBe('1-2-x')
    expect(calc('=SUM(DS(DS(A1); A2))', grid)).toBe(3)
  })

  test('one-rectangle functions: single-area DS works, multi-area is #VALUE!', () => {
    const tbl: Cells = { A1: 'a', B1: '1', A2: 'b', B2: '2', D1: 'z', E1: '9' }
    expect(calc('=VLOOKUP("b"; DS(A1:B2); 2; FALSE)', tbl)).toBe(2)
    expect(code(calc('=VLOOKUP("b"; DS(A1:B2; D1:E1); 2; FALSE)', tbl))).toBe('#VALUE!')
    expect(code(calc('=ROWS(DS(A1:B2; D1:E1))', tbl))).toBe('#VALUE!')
    expect(calc('=ROWS(DS(A1:B2))', tbl)).toBe(2)
    expect(code(calc('=INDEX(DS(A1:A2; D1); 1)', tbl))).toBe('#VALUE!')
    expect(code(calc('=MATCH("z"; DS(A1:A2; D1); 0)', tbl))).toBe('#VALUE!')
  })

  test('named datasets, unknown names, a DS alone in a cell', () => {
    const datasets: DatasetSource[] = [{ id: 'd1', name: 'Revenue', ranges: [{ sheet: 's1', ref: 'A1:A3' }, { sheet: 's2', ref: 'B1' }] }, { id: 'd2', name: 'Gone', ranges: [] }]
    const wb = book({ ...grid, F1: '=SUM(DS(Revenue))', F2: '=SUM(DS("revenue"; C1))', F3: '=SUM(DS(Nope))', F4: '=DS(A1:A3)', F5: '=SUM(DS(Gone))' }, { sheets: [sheet('s2', 'Other', { B1: '50' })], datasets })
    expect(val(wb, 'F1')).toBe(56)
    expect(val(wb, 'F2')).toBe(106)
    expect(code(val(wb, 'F3'))).toBe('#NAME?')
    expect(code(val(wb, 'F4'))).toBe('#VALUE!')
    expect(code(val(wb, 'F5'))).toBe('#REF!')
  })

  test('formula colouring: every DS group and every other reference gets its own group', () => {
    const p = paintFormula('SUM(DS(A1:A10; B2:B7); DS(Revenue); C1) + C1 + D4')
    expect(p.groups.map((g) => g.kind)).toEqual(['ds', 'ds', 'ref', 'ref'])
    expect(p.groups[0].refs.map((r) => r.a.col)).toEqual([0, 1])
    expect(p.groups[1].names).toEqual(['Revenue'])
    expect(p.groups[2].refs).toHaveLength(2)
    expect(p.groups[0].s).toBe(4)
    expect(p.groups[0].e).toBe('SUM(DS(A1:A10; B2:B7)'.length)
  })
})

test.describe('dependency graph', () => {
  test('incremental recalculation follows the chain', () => {
    const cells: Cells = { A1: '1', A2: '=A1*2', A3: '=A2+A1', A4: '=SUM(A1:A3)', B1: '=A4' }
    const wb = new Workbook()
    const src = (c: Cells) => [sheet('s1', 'Sheet1', c)]
    wb.sync(src(cells))
    expect(val(wb, 'B1')).toBe(6)
    const v0 = wb.version
    wb.sync(src({ ...cells, A1: '10' }))
    expect(val(wb, 'A2')).toBe(20)
    expect(val(wb, 'A3')).toBe(30)
    expect(val(wb, 'B1')).toBe(60)
    expect(wb.version).toBe(v0 + 1)
    // unchanged input: nothing recalculates
    wb.sync(src({ ...cells, A1: '10' }))
    expect(wb.version).toBe(v0 + 1)
    // clearing a cell
    const { A1: _a, ...rest } = cells
    wb.sync(src(rest))
    expect(val(wb, 'B1')).toBe(0)
  })

  test('cycles are #CYCLE!, cells downstream too, unrelated cells are fine', () => {
    const wb = book({ A1: '=B1', B1: '=A1', C1: '=C1+1', D1: '=A1+1', E1: '5', F1: '=IFERROR(A1; "loop")' })
    expect(code(val(wb, 'A1'))).toBe('#CYCLE!')
    expect(code(val(wb, 'B1'))).toBe('#CYCLE!')
    expect(code(val(wb, 'C1'))).toBe('#CYCLE!')
    expect(code(val(wb, 'D1'))).toBe('#CYCLE!')
    expect(val(wb, 'F1')).toBe('loop')
    expect(val(wb, 'E1')).toBe(5)
  })

  test('long chains do not overflow the stack', () => {
    const cells: Cells = { A1: '1' }
    for (let r = 2; r <= 2000; r++) cells[`A${r}`] = `=A${r - 1}+1`
    const wb = new Workbook()
    wb.sync([sheet('s1', 'Sheet1', cells, 2000, 2)])
    expect(val(wb, 'A2000')).toBe(2000)
    const loop = { ...cells, A1: '=A2000' }
    wb.sync([sheet('s1', 'Sheet1', loop, 2000, 2)])
    expect(code(val(wb, 'A1000'))).toBe('#CYCLE!')
  })
})

test.describe('reference adjustment', () => {
  test('copy / fill shifts relative parts only; off the sheet is #REF!', () => {
    expect(shiftFormula('=A1+$B$1+$C2+D$3', 1, 1)).toBe('=B2+$B$1+$C3+E$3')
    expect(shiftFormula('=SUM(A1:A3)', 2, 0)).toBe('=SUM(A3:A5)')
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!')
    expect(shiftFormula('=SUM(B:B)', 5, 1)).toBe('=SUM(C:C)')
    expect(shiftFormula('="A1"&A1', 1, 0)).toBe('="A1"&A2')
  })

  test('insert / delete rows and columns', () => {
    const id = () => 's1'
    const ins = { kind: 'insert', axis: 'row', sheetId: 's1', at: 1, count: 1 } as const
    expect(adjustFormula('=SUM(A1:A3)+A1+$A$3', 's1', ins, id)).toBe('=SUM(A1:A4)+A1+$A$4')
    const del = { kind: 'delete', axis: 'row', sheetId: 's1', at: 1, count: 1 } as const
    expect(adjustFormula('=A2+A3', 's1', del, id)).toBe('=#REF!+A2')
    expect(adjustFormula('=SUM(A1:A3)', 's1', del, id)).toBe('=SUM(A1:A2)')
    expect(adjustFormula('=SUM(A2:A2)', 's1', del, id)).toBe('=SUM(#REF!)')
    expect(adjustFormula('=SUM(DS(A1:A3; B2:B7))', 's1', del, id)).toBe('=SUM(DS(A1:A2; B2:B6))')
    const col = { kind: 'insert', axis: 'col', sheetId: 's1', at: 0, count: 2 } as const
    expect(adjustFormula('=A1+B:B', 's1', col, id)).toBe('=C1+D:D')
    // another sheet's rows: only refs that name it move
    const other = { kind: 'insert', axis: 'row', sheetId: 's2', at: 0, count: 1 } as const
    expect(adjustFormula("=A1+'Q 1'!A1", 's1', other, (n) => (n === 'Q 1' ? 's2' : null))).toBe("=A1+'Q 1'!A2")
    expect(adjustRect('A1:A10', del)).toBe('A1:A9')
    expect(adjustRect('A2', del)).toBeNull()
    expect(adjustRect('B:B', { kind: 'delete', axis: 'col', sheetId: 's1', at: 0, count: 1 })).toBe('A:A')
  })

  test('sheet rename and delete', () => {
    expect(renameSheetRefs("=SUM('Q1 Budget'!A1:A3)+Data!B1", 'q1 budget', 'Budget 2026')).toBe("=SUM('Budget 2026'!A1:A3)+Data!B1")
    expect(renameSheetRefs('=Data!B1', 'Data', 'My Data')).toBe("=Data!B1".replace('Data!', "'My Data'!"))
    expect(dropSheetRefs('=Data!B1+1', 'Data')).toBe('=#REF!+1')
  })
})

test.describe('input and formats', () => {
  test('typed input becomes canonical, language-neutral raw text', () => {
    expect(canonicalInput('1,5', 'de').v).toBe('1.5')
    expect(canonicalInput('1.234,5', 'de').v).toBe('1234.5')
    expect(canonicalInput('1,234.5', 'en').v).toBe('1234.5')
    expect(canonicalInput('12,5%', 'de').v).toBe('12.5%')
    expect(canonicalInput('3.10.2026', 'de').v).toBe('2026-10-03')
    expect(canonicalInput('10/3/2026', 'en').v).toBe('2026-10-03')
    expect(canonicalInput('€ 1.200', 'de')).toEqual({ v: '1200', fmt: { type: 'currency', currency: 'EUR' } })
    expect(canonicalInput('$5', 'en')).toEqual({ v: '5', fmt: { type: 'currency', currency: 'USD' } })
    expect(canonicalInput('wahr', 'de').v).toBe('TRUE')
    expect(canonicalInput('=sum(a1)', 'de').v).toBe('=sum(a1)')
    expect(canonicalInput('hello', 'en').v).toBe('hello')
  })

  test('literals and display', () => {
    expect(literal('12%')).toEqual({ value: 0.12, hint: 'percent' })
    expect(literal('2026-10-03')).toEqual({ value: 46298, hint: 'date' })
    expect(literal("'=1+1")).toEqual({ value: '=1+1', hint: null })
    expect(literal('42', 'text').value).toBe('42')
    expect(formatValue(0.125, { type: 'percent', decimals: 1 }, null, 'en')).toBe('12.5%')
    expect(formatValue(1234.5, { type: 'currency', currency: 'EUR' }, null, 'de')).toMatch(/1\.234,50\s€/)
    expect(formatValue(1234.5, { type: 'currency', currency: 'USD' }, null, 'en')).toBe('$1,234.50')
    expect(formatValue(46298, { type: 'date' }, null, 'en')).toBe('Oct 3, 2026')
    expect(formatValue(46298, { type: 'date' }, null, 'de')).toBe('03.10.2026')
    expect(formatValue(46298, undefined, 'date', 'en')).toBe('Oct 3, 2026')
    expect(formatValue(0.1 + 0.2, undefined, null, 'en')).toBe('0.3')
    expect(formatValue(1.5, undefined, null, 'de')).toBe('1,5')
    expect(formatValue(true, undefined, null, 'de')).toBe('WAHR')
    expect(formatValue(1234.5, { type: 'number', decimals: 1 }, null, 'en')).toBe('1,234.5')
    expect(formatWithCode(0.5, '0.0%', 'en')).toBe('50.0%')
  })

  test('editor helpers: call + argument at the caret, word being typed, point mode', () => {
    expect(callAt('SUM(A1; IF(B1; ', 15)).toEqual({ name: 'IF', arg: 1 })
    expect(callAt('SUM(A1; 2)', 5)).toEqual({ name: 'SUM', arg: 0 })
    expect(callAt('1+2', 3)).toBeNull()
    expect(wordAt('SUM(A1)+VLO', 11)).toEqual({ word: 'VLO', start: 8 })
    expect(wordAt('"VLO', 4)).toBeNull()
    expect(wordAt('A1', 2)).toBeNull()
    expect(canPoint('SUM(', 4)).toBe(true)
    expect(canPoint('A1+', 3)).toBe(true)
    expect(canPoint('A1', 2)).toBe(false)
    expect(canPoint('"x', 2)).toBe(false)
  })
})

test.describe('custom functions and limits', () => {
  const spread: CustomFunction = {
    id: 'f1',
    name: 'SPREAD',
    params: [{ name: 'values', type: 'range' }],
    body: { k: 'call', fn: '-', args: [{ k: 'call', fn: 'MAX', args: [{ k: 'param', name: 'values' }] }, { k: 'call', fn: 'MIN', args: [{ k: 'param', name: 'values' }] }] },
    createdAt: 0,
    updatedAt: 0,
  }
  const margin: CustomFunction = {
    id: 'f2',
    name: 'MARGIN',
    params: [{ name: 'price', type: 'number' }, { name: 'cost', type: 'number' }],
    body: { k: 'call', fn: '/', args: [{ k: 'call', fn: '-', args: [{ k: 'param', name: 'price' }, { k: 'param', name: 'cost' }] }, { k: 'param', name: 'price' }] },
    createdAt: 0,
    updatedAt: 0,
  }
  const fact: CustomFunction = {
    id: 'f3',
    name: 'FACT_R',
    params: [{ name: 'n', type: 'number' }],
    body: {
      k: 'call',
      fn: 'IF',
      args: [
        { k: 'call', fn: '<=', args: [{ k: 'param', name: 'n' }, { k: 'num', v: 1 }] },
        { k: 'num', v: 1 },
        { k: 'call', fn: '*', args: [{ k: 'param', name: 'n' }, { k: 'call', fn: 'FACT_R', args: [{ k: 'call', fn: '-', args: [{ k: 'param', name: 'n' }, { k: 'num', v: 1 }] }] }] },
      ],
    },
    createdAt: 0,
    updatedAt: 0,
  }
  const forever: CustomFunction = { id: 'f4', name: 'FOREVER', params: [{ name: 'n', type: 'number' }], body: { k: 'call', fn: 'FOREVER', args: [{ k: 'param', name: 'n' }] }, createdAt: 0, updatedAt: 0 }
  const shadow: CustomFunction = { id: 'f5', name: 'SUM', params: [], body: { k: 'num', v: 1 }, createdAt: 0, updatedAt: 0 }

  test.beforeAll(() => setCustomFunctions([spread, margin, fact, forever, shadow]))
  test.afterAll(() => setCustomFunctions([]))

  test('custom functions in cells, with datasets and type checks', () => {
    const cells: Cells = { A1: '4', A2: '9', A3: '1', B2: '20', B3: '-3', C1: '100', C2: '60' }
    expect(calc('=SPREAD(DS(A1:A3; B2:B3))', cells)).toBe(23)
    expect(calc('=SPREAD(A1:A3)', cells)).toBe(8)
    expect(calc('=MARGIN(C1; C2)', cells)).toBe(0.4)
    expect(code(calc('=MARGIN(DS(C1); C2)', cells))).toBe('#VALUE!')
    expect(code(calc('=MARGIN(C1)', cells))).toBe('#ERROR!')
    expect(calc('=FACT_R(5)')).toBe(120)
    expect(code(calc('=FOREVER(1)'))).toBe('#NUM!')
    expect(code(calc('=FACT_R(40)'))).toBe('#NUM!')
    // a custom function can't replace a built-in
    expect(calc('=SUM(2; 3)')).toBe(5)
    expect(getFunction('SPREAD')!.category).toBe('custom')
    expect(evaluateExpr(spread.body, { values: datasetOf([3, 8, 1]) })).toBe(7)
    expect(callFunction('MARGIN', [50, 40])).toBeCloseTo(0.2, 10)
  })

  test('limits: formula length, nesting, text size, step budget', () => {
    expect(code(calc(`=${'1+'.repeat(MAX_FORMULA / 2)}1`))).toBe('#ERROR!')
    expect(code(calc(`=${'('.repeat(70)}1${')'.repeat(70)}`))).toBe('#ERROR!')
    expect(calc(`=${'('.repeat(60)}1${')'.repeat(60)}`)).toBe(1)
    expect(code(calc('=CONCAT(A1:A40)', Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`A${i + 1}`, 'x'.repeat(1000)]))))).toBe('#VALUE!')
    expect(code(calc('=SUBSTITUTE(REPT; 1; 2)'))).toBe('#NAME?')
    const wb = new Workbook({ maxSteps: 5000 })
    const cells: Record<string, { v: string }> = {}
    for (let r = 1; r <= 200; r++) cells[`A${r}`] = { v: `=SUM(B1:B2000)+${r}` }
    wb.sync([{ id: 's1', name: 'S', rows: 2000, cols: 3, cells }])
    const last = wb.get('s1', 199, 0).value
    expect(isErr(last) && last.code).toBe('#NUM!')
    // pathological wildcard patterns stay linear (no regular expression backtracking)
    const t0 = Date.now()
    expect(calc(`=COUNTIF(A1; "${'*a'.repeat(30)}b")`, { A1: 'a'.repeat(3000) })).toBe(0)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  test('names never reach the prototype chain', () => {
    for (const n of ['CONSTRUCTOR', '__PROTO__', 'TOSTRING', 'HASOWNPROPERTY', 'VALUEOF']) expect(code(calc(`=${n}(1)`))).toBe('#NAME?')
    const wb = book({ A1: '=SUM(DS(constructor))', A2: '=SUM(DS(__proto__))' }, { datasets: [] })
    expect(code(val(wb, 'A1'))).toBe('#NAME?')
    expect(code(val(wb, 'A2'))).toBe('#NAME?')
  })
})
