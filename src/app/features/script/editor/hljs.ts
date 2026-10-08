/**
 * One Script as a highlight.js grammar — for code blocks on pages (```onescript), registered at boot (main.tsx →
 * editor registerCodeLanguage). Built from the language's own lists (lexer KEYWORDS, catalog GLOBAL_FUNCTIONS), so
 * a new keyword or function shows up here without touching this file. The script editor itself highlights with
 * the real lexer (analyze.ts); this grammar only has to agree with it on what is what.
 */
import type { LanguageFn } from 'lowlight'
import { KEYWORDS } from '../lang/lexer'
import { GLOBAL_FUNCTIONS } from '../catalog'

const LITERALS = ['true', 'false', 'null']

export const oneScriptGrammar: LanguageFn = (hljs) => ({
  name: 'One Script',
  aliases: ['one'],
  keywords: {
    keyword: [...KEYWORDS].filter((k) => !LITERALS.includes(k)),
    literal: LITERALS,
    built_in: [...new Set(GLOBAL_FUNCTIONS.map((f) => f.name))],
  },
  contains: [
    hljs.HASH_COMMENT_MODE,
    hljs.C_LINE_COMMENT_MODE,
    // "text {expr} text": interpolations are code again
    {
      scope: 'string',
      begin: '"',
      end: '"',
      illegal: '\\n',
      contains: [hljs.BACKSLASH_ESCAPE, { scope: 'subst', begin: '\\{', end: '\\}' }],
    },
    { scope: 'string', begin: "'", end: "'", illegal: '\\n', contains: [hljs.BACKSLASH_ESCAPE] },
    // numbers and durations: 12 · 3.5 · 1_000 · 3d · 500ms
    { scope: 'number', match: /\b\d[\d_]*(?:\.\d+)?(?:ms|[wdhms])?\b/ },
    // @ references: @[Label](p:id) · @"Some name" · @Name
    { scope: 'symbol', match: /@\[[^\]\n]*\]\([pusa]:[\w-]+\)|@"[^"\n]*"|@[A-Za-z_À-ÿ][\wÀ-ÿ]*/ },
    // a property written in backticks
    { scope: 'property', match: /`[^`\n]+`/ },
    { scope: 'title.function', match: /\b[A-Za-z_][\w]*(?=\s*\()/ },
  ],
})
