/**
 * The shared code area's pure parts (ui/code, run in Node by the Playwright runner — no browser): tokenizer
 * positions (Markdown-ish instructions, JSON, the lowlight adapter), JSON errors and value places, placeholders,
 * bracket pairs and the cause of an unclosed bracket, the syntax colours' contrast (tokens.css --syn-*, WCAG AA on
 * every surface of Paper and Carbon) and the strings in EN + DE.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { createLowlight, common } from 'lowlight'
import { markdownTokenizer } from '../../src/app/ui/code/tokenizers/markdown'
import { jsonError, jsonPathRange, tokenizeJson } from '../../src/app/ui/code/tokenizers/json'
import { lowlightTokenizer, synOfHljs } from '../../src/app/ui/code/tokenizers/lowlight'
import { oneScriptGrammar } from '../../src/app/features/script/editor/hljs'
import { PLACEHOLDER_PATTERN, countPlaceholders, findPlaceholders } from '../../src/app/ui/code/placeholders'
import { pairAt, scanBrackets } from '../../src/app/ui/code/brackets'
import { lineColAt, lineStarts, markerRange, offsetAt, tokensByLine } from '../../src/app/ui/code/lines'
import { messages } from '../../src/app/ui/code/messages'
import { contrast, mixSrgb } from '../../src/app/lib/look/color'
import type { CodeToken } from '../../src/app/ui/code/types'

/** "cls:text" for every token (positions checked through the text they cover). */
const show = (code: string, toks: CodeToken[]) => toks.map((t) => `${t.cls}:${code.slice(t.start, t.end)}`)
const sortedAndApart = (toks: CodeToken[]) => toks.every((t, i) => t.end > t.start && (i === 0 || toks[i - 1].end <= t.start))

test.describe('Markdown-ish instructions', () => {
  const md = markdownTokenizer({ tools: ['create_row', 'query_database', 'kb_search'], placeholders: PLACEHOLDER_PATTERN })

  test('headings, list markers, task boxes, quotes, inline code, bold, emphasis, links', () => {
    const code = ['## Mirror the base', '1. Call `kb_search`; **never** twice', '- [ ] Map *Status*', '> a quote with [a link](https://x.y)', '---'].join('\n')
    const toks = md(code)
    expect(sortedAndApart(toks)).toBe(true)
    expect(show(code, toks)).toEqual([
      'list:##',
      'head: Mirror the base',
      'list:1.',
      'code:`kb_search`',
      'strong:**never**',
      'list:-',
      'list:[ ]',
      'em:*Status*',
      'list:>',
      'quote: a quote with ',
      'link:[a link](https://x.y)',
      'punct:---',
    ])
  })

  test('tool names as whole words only; placeholders win over everything', () => {
    const code = 'Use create_row, not create_rows; then [HOW TO LIST THE ITEMS] via query_database.\n`[MAX ITEMS]` stays a placeholder'
    const toks = md(code)
    expect(sortedAndApart(toks)).toBe(true)
    expect(show(code, toks)).toEqual(['tool:create_row', 'ph:[HOW TO LIST THE ITEMS]', 'tool:query_database', 'code:`', 'ph:[MAX ITEMS]', 'code:`'])
    // absolute offsets on the second line
    const ph = toks.find((t) => code.slice(t.start, t.end) === '[MAX ITEMS]')!
    expect(ph.start).toBe(code.indexOf('[MAX ITEMS]'))
  })

  test('fenced code is one block until its fence closes', () => {
    const code = 'Before\n```json\n{ "a": **1** }\n```\nAfter **b**'
    expect(show(code, md(code))).toEqual(['meta:```json', 'code:{ "a": **1** }', 'meta:```', 'strong:**b**'])
  })

  test('2,000 lines tokenize quickly', () => {
    const line = '3. Map: Title ← record.title · Status ← [STATUS MAPPING] · use create_row and **never** `delete`'
    const code = Array.from({ length: 2000 }, () => line).join('\n')
    const t0 = performance.now()
    const toks = md(code)
    const ms = performance.now() - t0
    expect(toks.length).toBe(2000 * 5)
    expect(ms).toBeLessThan(250)
  })
})

test.describe('placeholders', () => {
  test('the default pattern: capitals in square brackets, never task boxes or short / lower-case brackets', () => {
    const text = '[HOW TO LIST THE ITEMS] [LAST RUN DATE] [x] [ ] [1, 2] [ok] [A] [MAX 50 ITEMS] [STATUS/STAGE] [ÄNDERUNG] [WAS „KLAR“ HIER HEISST]'
    expect(findPlaceholders(text).map((p) => p.text)).toEqual(['[HOW TO LIST THE ITEMS]', '[LAST RUN DATE]', '[MAX 50 ITEMS]', '[STATUS/STAGE]', '[ÄNDERUNG]', '[WAS „KLAR“ HIER HEISST]'])
    expect(countPlaceholders('no placeholder here')).toBe(0)
  })
  test('a caller’s own pattern (without the g flag) works the same', () => {
    expect(findPlaceholders('a {{name}} b {{date}}', /\{\{\w+\}\}/).map((p) => [p.start, p.end])).toEqual([
      [2, 10],
      [13, 21],
    ])
  })
})

test.describe('JSON', () => {
  test('keys differ from string values; numbers, literals, punctuation, comments', () => {
    const code = '{\n  "id": "kb", // the id\n  "n": -1.5e3, "on": true, "x": null\n}'
    const toks = tokenizeJson(code)
    expect(sortedAndApart(toks)).toBe(true)
    expect(show(code, toks)).toEqual(['punct:{', 'key:"id"', 'punct::', 'str:"kb"', 'punct:,', 'comment:// the id', 'key:"n"', 'punct::', 'num:-1.5e3', 'punct:,', 'key:"on"', 'punct::', 'lit:true', 'punct:,', 'key:"x"', 'punct::', 'lit:null', 'punct:}'])
  })

  test('the first error with its line and column', () => {
    expect(jsonError('{ "a": 1 }')).toBeNull()
    expect(jsonError('  ')).toBeNull()
    expect(jsonError('{\n  "a": 1,\n}')).toMatchObject({ code: 'trailingComma', line: 2, col: 9 })
    expect(jsonError('{\n  "a" 1\n}')).toMatchObject({ code: 'colon', line: 2, col: 7, found: '1' })
    expect(jsonError('{ "a": tru }')).toMatchObject({ code: 'unexpected', line: 1, col: 8, endCol: 11, found: 'tru' })
    expect(jsonError('{ "a": "open\n}')).toMatchObject({ code: 'unterminated', line: 1, col: 8 })
    expect(jsonError('[1, 2')).toMatchObject({ code: 'end' })
    expect(jsonError('{ "a": 1 } x')).toMatchObject({ code: 'trailing', col: 12, found: 'x' })
    expect(jsonError('{ "a": 1, "a": 2 }', { strict: true })).toMatchObject({ code: 'duplicate', col: 11 })
    expect(jsonError('{ "a": 1, "a": 2 }')).toBeNull()
    expect(jsonError('// comment\n{ "a": [1, 2] }')).toBeNull()
  })

  test('where a value sits: schema errors land on their key or value', () => {
    const code = '{\n  "requires": { "mcp": "kb", "tools": ["kb_search", 42] }\n}'
    expect(jsonPathRange(code, ['requires', 'tools', 1])).toEqual({ line: 2, col: 59, endLine: 2, endCol: 61 })
    expect(code.split('\n')[1].slice(58, 60)).toBe('42')
    expect(jsonPathRange(code, ['requires', 'mcp'], 'key')).toEqual({ line: 2, col: 17, endLine: 2, endCol: 22 })
    expect(jsonPathRange(code, ['nope'])).toBeNull()
    expect(jsonPathRange('{ broken', ['a'])).toBeNull()
  })
})

test.describe('lowlight adapter', () => {
  const lowlight = createLowlight(common)
  test('highlight.js scopes become token classes at the right offsets', () => {
    const code = 'const n = 42 // answer\nfunction go(a) { return "x" }'
    const toks = lowlightTokenizer(lowlight, 'javascript')(code)
    expect(sortedAndApart(toks)).toBe(true)
    const s = show(code, toks)
    expect(s).toContain('kw:const')
    expect(s).toContain('num:42')
    expect(s).toContain('comment:// answer')
    expect(s).toContain('fn:go')
    expect(s).toContain('var:a')
    expect(s).toContain('str:"x"')
    expect(lowlightTokenizer(lowlight, 'not-a-language')(code)).toEqual([])
  })
  test('One Script as a grammar (code blocks): keywords, built-ins, calls, strings, durations, @ references', () => {
    const ll = createLowlight(common)
    ll.register({ onescript: oneScriptGrammar })
    const code = 'let due = db(@[Projects](p:abc12)).where(Status != "Done", Due < today() + 3d) # soon'
    const s = show(code, lowlightTokenizer(ll, 'onescript')(code))
    expect(s).toEqual(expect.arrayContaining(['kw:let', 'fn:db', 'lit:@[Projects](p:abc12)', 'fn:where', 'str:"Done"', 'fn:today', 'num:3d', 'comment:# soon']))
  })
  test('sub-scopes first: title.class_ is a type, title.function_ a function', () => {
    expect(synOfHljs(['hljs-title', 'class_'])).toBe('type')
    expect(synOfHljs(['hljs-title', 'function_'])).toBe('fn')
    expect(synOfHljs(['hljs-attr'])).toBe('key')
    expect(synOfHljs(['plain'])).toBeNull()
  })
})

test.describe('brackets and lines', () => {
  test('pairs at the caret; strings and comments are skipped', () => {
    const code = 'f(a, "(", [b]) # )'
    const toks: CodeToken[] = [
      { start: 5, end: 8, cls: 'str' },
      { start: 15, end: 18, cls: 'comment' },
    ]
    const b = scanBrackets(code, toks)
    expect(b.unmatched).toEqual([])
    expect(pairAt(b, code, 2)).toEqual([1, 13])
    expect(pairAt(b, code, 14)).toEqual([1, 13])
    expect(pairAt(b, code, 11)).toEqual([10, 12])
  })
  test('the unclosed opener is found, not only where the parser gave up', () => {
    // One Script: t.set( is never closed; notify(…) and the block close fine
    const code = 'for t in due {\n  t.set(Priority: "High"\n  notify("x")\n}'
    const b = scanBrackets(code, [{ start: code.indexOf('"High"'), end: code.indexOf('"High"') + 6, cls: 'str' }])
    expect(b.unmatched).toEqual([code.indexOf('t.set(') + 5])
    expect(lineColAt(lineStarts(code), b.unmatched[0])).toEqual({ line: 2, col: 8 })
    expect(scanBrackets('a)').unmatched).toEqual([1])
  })
  test('offsets ⇄ lines, tokens cut into lines, marker ranges', () => {
    const code = 'ab\ncde\n\nf'
    const st = lineStarts(code)
    expect(st).toEqual([0, 3, 7, 8])
    expect(lineColAt(st, 5)).toEqual({ line: 2, col: 3 })
    expect(offsetAt(code, st, 2, 99)).toBe(6)
    expect(tokensByLine(code, st, [{ start: 1, end: 5, cls: 'str' }])).toEqual([[{ start: 1, end: 2, cls: 'str' }], [{ start: 0, end: 2, cls: 'str' }], [], []])
    expect(markerRange('let notify = 1', lineStarts('let notify = 1'), { line: 1, col: 5, message: '', severity: 'error' })).toEqual({ from: 4, to: 10 })
  })
})

test.describe('palette and strings', () => {
  const TOKENS = readFileSync(fileURLToPath(new URL('../../src/shared/tokens.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (re: RegExp) => Object.fromEntries([...(TOKENS.match(re)?.[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const LIGHT = block(/:root\s*\{([^}]*)\}/)
  const DARK = { ...LIGHT, ...block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/) }
  /** a token's value with var() and color-mix(in srgb, a p%, b) resolved */
  const resolve = (t: Record<string, string>, v: string): string => {
    v = v.trim()
    const ref = /^var\((--[\w-]+)\)$/.exec(v)
    if (ref) return resolve(t, t[ref[1]])
    const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v)
    if (mix) return mixSrgb(resolve(t, mix[3]), resolve(t, mix[1]), Number(mix[2]) / 100)
    return v
  }

  test('every syntax colour is AA (4.5 : 1) on bg, surface, surface-2 and surface-3 — Paper and Carbon', () => {
    const fails: string[] = []
    for (const [mode, t] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      const names = Object.keys(t).filter((k) => k.startsWith('--syn-') && !['--syn-line', '--syn-match', '--syn-ph-bg'].includes(k))
      expect(names.length).toBeGreaterThanOrEqual(15)
      for (const name of names) {
        const fg = resolve(t, t[name])
        expect(fg, `${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/)
        for (const bg of ['--bg', '--surface', '--surface-2', '--surface-3']) {
          const r = contrast(fg, resolve(t, t[bg]))
          if (r < 4.5) fails.push(`${mode} ${name} on ${bg}: ${r.toFixed(2)}`)
        }
      }
      // keys and strings differ in lightness too, not only in hue
      expect(contrast(resolve(t, t['--syn-key']), resolve(t, t['--syn-str'])), `${mode} key/str`).toBeGreaterThanOrEqual(1.5)
    }
    expect(fails).toEqual([])
  })

  test('every string exists in EN and DE', () => {
    expect(Object.keys(messages.de).sort()).toEqual(Object.keys(messages.en).sort())
    for (const [k, v] of Object.entries(messages.de)) expect(v, k).not.toBe('')
  })
})
