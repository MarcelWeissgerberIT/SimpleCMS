/**
 * highlight.js (lowlight) → code area tokens. The caller passes its lowlight instance (the editor's has the
 * common languages plus One Script), so this module loads no grammar itself. HLJS_SYN is the one mapping of
 * highlight.js scopes onto token classes; ui/code/syntax.css colours `.hljs-*` spans the same way for code
 * blocks and diffs that render lowlight's output directly.
 */
import type { CodeToken, SynClass, Tokenizer } from '../types'

/** highlight.js scope (first class name, without "hljs-") → token class. Sub-scopes (title.function_) first. */
export const HLJS_SYN: Record<string, SynClass> = {
  'title.function_': 'fn',
  'title.function': 'fn',
  'title.class_': 'type',
  'title.class': 'type',
  'variable.language_': 'kw',
  'variable.constant_': 'lit',
  'meta.keyword': 'kw',
  'meta.string': 'str',
  keyword: 'kw',
  'selector-tag': 'tag',
  doctag: 'kw',
  built_in: 'fn',
  literal: 'lit',
  number: 'num',
  symbol: 'lit',
  string: 'str',
  char: 'str',
  regexp: 'regex',
  subst: 'var',
  attr: 'key',
  attribute: 'key',
  property: 'key',
  params: 'var',
  variable: 'var',
  'template-variable': 'var',
  'template-tag': 'tag',
  title: 'fn',
  function: 'fn',
  type: 'type',
  class: 'type',
  tag: 'tag',
  name: 'tag',
  'selector-id': 'tag',
  'selector-class': 'tag',
  'selector-attr': 'key',
  'selector-pseudo': 'tag',
  comment: 'comment',
  quote: 'quote',
  meta: 'meta',
  punctuation: 'punct',
  operator: 'op',
  addition: 'add',
  deletion: 'del',
  section: 'head',
  bullet: 'list',
  code: 'code',
  strong: 'strong',
  emphasis: 'em',
  link: 'link',
}

/** The token class of an hljs element's class list ("hljs-title function_" → fn), or null. */
export function synOfHljs(classNames: string[]): SynClass | null {
  const first = classNames.find((c) => c.startsWith('hljs-'))
  if (!first) return null
  const scope = first.slice(5)
  const sub = classNames.filter((c) => c !== first && !c.startsWith('hljs-'))
  for (const s of sub) {
    const hit = HLJS_SYN[`${scope}.${s}`]
    if (hit) return hit
  }
  return HLJS_SYN[scope] ?? null
}

/** The part of a hast tree the adapter reads. */
interface HastNode {
  type: string
  value?: string
  properties?: { className?: string[] | string }
  children?: HastNode[]
}

export interface LowlightLike {
  highlight(language: string, value: string): { children: unknown[] }
  registered(language: string): boolean
}

/** A tokenizer for one language of a lowlight instance (an unknown language: plain text, no tokens). */
export function lowlightTokenizer(lowlight: LowlightLike, language: string): Tokenizer {
  return (code) => {
    if (!language || !lowlight.registered(language)) return []
    const out: CodeToken[] = []
    let at = 0
    const walk = (nodes: HastNode[], cls: SynClass | null) => {
      for (const n of nodes) {
        if (n.type === 'text') {
          const len = n.value?.length ?? 0
          if (cls && len) {
            const last = out[out.length - 1]
            if (last && last.cls === cls && last.end === at) last.end = at + len
            else out.push({ start: at, end: at + len, cls })
          }
          at += len
        } else if (n.children) {
          const raw = n.properties?.className
          const names = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/) : []
          walk(n.children, synOfHljs(names) ?? cls)
        }
      }
    }
    walk(lowlight.highlight(language, code).children as HastNode[], null)
    return out
  }
}
