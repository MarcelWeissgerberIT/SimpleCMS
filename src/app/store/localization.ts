/** Presentation-only text variants. Canonical blocks, identifiers, values and executable fields never change. */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import type { Database, Page, PageCover } from './types'
export interface PageTranslation { at: number; signature: string; texts: Array<[string, string]>; images?: Array<[string, string]>; cover?: PageCover }
export interface PageLocalization { source: Lang; variants: Partial<Record<Lang, PageTranslation>> }
export const MAX_TRANSLATION_TEXTS = 2000
const ATTRS = ['alt', 'caption', 'title', 'label']
const PLAIN_CODE = new Set(['', 'text', 'plaintext', 'markdown'])
export function pageTexts(page: Page, db?: Database): string[] {
  const out = new Set<string>(), add = (s: unknown) => { if (typeof s === 'string' && s.trim()) out.add(s) }
  add(page.title)
  const walk = (n: JSONContent) => {
    if (n.type === 'codeBlock' && !PLAIN_CODE.has(String(n.attrs?.language ?? ''))) return
    if (!n.marks?.some(m => m.type === 'code')) add(n.text)
    for (const k of ATTRS) add(n.attrs?.[k])
    n.content?.forEach(walk)
  }
  if (page.content) walk(page.content)
  for (const p of db?.properties ?? []) {
    if (page.kind === 'database') { add(p.name); p.options?.forEach(o => add(o.name)) }
    else if (p.type === 'text') add(page.properties[p.id])
  }
  if (page.kind === 'database') db?.views.forEach(v => add(v.name))
  return [...out].sort()
}
/** Independent of repaired block IDs or language metadata. Two hashes also avoid accidental short-hash collisions. */
export function translationSignature(page: Page, db?: Database): string {
  const text = JSON.stringify(pageTexts(page, db)); let a = 2166136261, b = 5381
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i) }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
export function sanitizeLocalization(v: unknown): PageLocalization | undefined {
  if (!v || typeof v !== 'object') return
  const x = v as PageLocalization
  if (!['en', 'de'].includes(x.source) || !x.variants || typeof x.variants !== 'object') return
  const variants: PageLocalization['variants'] = {}
  for (const lang of ['en', 'de'] as const) {
    const t = x.variants[lang]
    if (!t || lang === x.source || !Number.isFinite(t.at) || typeof t.signature !== 'string' || t.signature.length > 100 || !Array.isArray(t.texts) || t.texts.length > MAX_TRANSLATION_TEXTS) continue
    let size = 0
    if (!t.texts.every(p => Array.isArray(p) && p.length === 2 && p.every(s => typeof s === 'string' && s.length <= 50000) && (size += p[0].length + p[1].length) <= 500000)) continue
    if (new Set(t.texts.map(p => p[0])).size !== t.texts.length) continue
    variants[lang] = { at: t.at, signature: t.signature, texts: t.texts.map(p => [p[0], p[1]]) }
    if (Array.isArray(t.images)) variants[lang]!.images = t.images.filter(p => Array.isArray(p) && p.length === 2 && p.every(s => typeof s === 'string' && /^onefile:[A-Za-z0-9_-]{1,64}$/.test(s))).slice(0, 100).map(p => [p[0], p[1]])
    if (t.cover?.type === 'image' && /^onefile:[A-Za-z0-9_-]{1,64}$/.test(t.cover.value) && Number.isFinite(t.cover.positionY)) variants[lang]!.cover = { ...t.cover, positionY: Math.max(0, Math.min(100, t.cover.positionY)) }
  }
  return { source: x.source, variants }
}
export function translationState(page: Page, lang: Lang | null, db?: Database): 'original' | 'missing' | 'ready' | 'stale' {
  if (!lang || !page.localization || lang === page.localization.source) return 'original'
  const v = page.localization.variants[lang]
  return !v ? 'missing' : v.signature === translationSignature(page, db) ? 'ready' : 'stale'
}
export function translatedText(v: string, texts: readonly [string, string][]): string { return new Map(texts).get(v) ?? v }
export function localizedTitle(page: Page, lang: Lang | null): string {
  if (!lang || lang === page.localization?.source) return page.title
  const v = page.localization?.variants[lang]
  return v ? translatedText(page.title, v.texts) : page.title
}
export function localizePage(page: Page, lang: Lang | null, db?: Database): Page {
  if (!lang || lang === page.localization?.source || !page.localization?.variants[lang]) return page
  const ready = translationState(page, lang, db) === 'ready'
  const v = page.localization.variants[lang]!, texts = new Map(v.texts), images = new Map(v.images), text = (s: string) => texts.get(s) ?? s
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'codeBlock' && !PLAIN_CODE.has(String(n.attrs?.language ?? ''))) return n
    const attrs = n.attrs ? { ...n.attrs } : undefined
    if (attrs) {
      for (const k of ATTRS) if (typeof attrs[k] === 'string') attrs[k] = text(attrs[k])
      if (n.type === 'image' && images.has(attrs.src)) attrs.src = images.get(attrs.src)
    }
    return { ...n, ...(attrs ? { attrs } : {}), ...(n.text && !n.marks?.some(m => m.type === 'code') ? { text: text(n.text) } : {}), ...(n.content ? { content: n.content.map(walk) } : {}) }
  }
  const properties = { ...page.properties }
  for (const p of db?.properties ?? []) if (p.type === 'text' && typeof properties[p.id] === 'string') properties[p.id] = text(properties[p.id] as string)
  return { ...page, title: text(page.title), content: ready && page.content ? walk(page.content) : page.content, properties, ...(ready && v.cover ? { cover: v.cover } : {}) }
}
export function localizeDatabase(db: Database, page: Page, lang: Lang | null): Database {
  if (translationState(page, lang, db) !== 'ready') return db
  const texts = new Map(page.localization!.variants[lang!]!.texts), text = (s: string) => texts.get(s) ?? s
  return { ...db, properties: db.properties.map(p => ({ ...p, name: text(p.name), ...(p.options ? { options: p.options.map(o => ({ ...o, name: text(o.name) })) } : {}) })), views: db.views.map(v => ({ ...v, name: text(v.name) })) }
}
