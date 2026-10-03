/**
 * YAML front matter for synced files — the small, strict subset One writes (and reads back):
 *   key: plain value · key: "double quoted" · key: 'single quoted' · key: 12 · key: true
 *   key: [a, "b, c"] · key: (empty = no value) · key:\n  - item (block list)
 * Strings that a YAML parser could misread (numbers, booleans, ":" …) are double-quoted (JSON
 * escapes are valid YAML), so other tools (Obsidian, Jekyll, GitHub's preview) read the same values.
 */
export type YamlScalar = string | number | boolean | null
export type YamlValue = YamlScalar | string[]

const RESERVED = /^(true|false|yes|no|on|off|null|~)$/i
const NUMERIC = /^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function plainOk(s: string, inList: boolean): boolean {
  if (!s || s !== s.trim()) return false
  if (RESERVED.test(s)) return false
  if (NUMERIC.test(s) && /\d/.test(s)) return DATE.test(s)
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false
  if (/:(\s|$)|\s#|[\n\r\t]/.test(s)) return false
  if (inList && /[,[\]{}]/.test(s)) return false
  return true
}

const quote = (s: string) => JSON.stringify(s)

function scalar(v: YamlScalar, inList = false): string {
  if (v === null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return plainOk(v, inList) ? v : quote(v)
}

export function yamlKey(k: string): string {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_ .()/-]*$/u.test(k) && k === k.trim() && !RESERVED.test(k) ? k : quote(k)
}

/** "---\nkey: value\n---\n" */
export function writeFrontMatter(entries: Array<[string, YamlValue]>): string {
  const lines = entries.map(([k, v]) => {
    const key = yamlKey(k)
    if (Array.isArray(v)) return `${key}: [${v.map((x) => scalar(x, true)).join(', ')}]`
    const val = scalar(v)
    return val ? `${key}: ${val}` : `${key}:`
  })
  return `---\n${lines.join('\n')}\n---\n`
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function unquote(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  }
  if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

/** Split a flow list body ("a, "b, c", 'd'") on commas outside quotes. */
function splitFlow(body: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (q) {
      cur += c
      if (c === '\\' && q === '"' && i + 1 < body.length) cur += body[++i]
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim() || out.length) out.push(cur)
  return out.map(unquote).filter((x) => x !== '')
}

/** Strip a trailing " # comment" from a plain scalar. */
const dropComment = (s: string) => (/^["']/.test(s.trim()) ? s : s.replace(/\s+#.*$/, ''))

function parseValue(raw: string): YamlValue {
  const s = dropComment(raw).trim()
  if (!s || s === '~' || s === 'null') return null
  if (s.startsWith('[') && s.endsWith(']')) return splitFlow(s.slice(1, -1))
  return unquote(s)
}

export interface FrontMatter {
  data: Map<string, YamlValue>
  body: string
}

/** Leading "---" … "---" block → key/value pairs + the rest. No block (or not YAML-ish) → empty data. */
export function readFrontMatter(text: string): FrontMatter {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = src.match(/^---[ \t]*\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/)
  const data = new Map<string, YamlValue>()
  if (!m) return { data, body: src }
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const kv = line.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#'"-][^:]*?)\s*:(?:[ \t]+(.*))?$/)
    // a "---" rule followed by ordinary prose is not front matter
    if (!kv) return { data: new Map(), body: src }
    const key = unquote(kv[1])
    const rest = kv[2] ?? ''
    if (/^[|>][+-]?\s*$/.test(rest.trim())) {
      // block scalar: the indented lines below
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      data.set(key, rest.trim().startsWith('|') ? block.join('\n').trim() : block.join(' ').trim())
      continue
    }
    if (!rest.trim()) {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unquote(dropComment(lines[++i].replace(/^\s*-\s+/, ''))))
      data.set(key, items.length ? items : null)
      continue
    }
    data.set(key, parseValue(rest))
  }
  return { data, body: src.slice(m[0].length) }
}

/** A front matter value as one string (lists joined with ", "). */
export function yamlText(v: YamlValue | undefined): string {
  if (v === undefined || v === null) return ''
  return Array.isArray(v) ? v.join(', ') : String(v)
}

export function yamlList(v: YamlValue | undefined): string[] {
  if (v === undefined || v === null || v === '') return []
  if (Array.isArray(v)) return v
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
