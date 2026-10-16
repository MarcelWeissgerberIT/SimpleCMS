/**
 * Row cards shared by board and gallery: cover preview, title (inline-editable), visible values.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { Page, PropertyDef, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useFileUrl } from '../../lib/files'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import { ValueView } from '../cells/display'
import { isEmptyValue } from '../model/resolve'
import { guessIsImage } from '../model/files'
import type { DbModel } from '../hooks'
import { subItemsOf } from '../model/hierarchy'
import { subItemCount } from './tree'
import { plural } from '../parts'
import { rowProps } from '../model/recordTypes'
import { itemTitleText } from '../../editor'
import { Globe } from 'lucide-react'

function firstImage(node: JSONContent | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'image' && typeof node.attrs?.src === 'string') return node.attrs.src
  for (const c of node.content ?? []) {
    const hit = firstImage(c)
    if (hit) return hit
  }
  return null
}

/** Plain text of an inline container (paragraph / heading): text, mentions, hard breaks. */
function inlineText(n: JSONContent): string {
  return (n.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'mention' ? String(c.attrs?.label ?? '') : c.type === 'hardBreak' ? ' ' : c.content ? inlineText(c) : ''))
    .join('')
    .trim()
}

function firstLines(node: JSONContent | null | undefined, max = 4): string[] {
  const out: string[] = []
  const walk = (n: JSONContent) => {
    if (out.length >= max) return
    if (n.type === 'paragraph' || n.type === 'heading') {
      const txt = inlineText(n)
      if (txt) out.push(txt)
      return
    }
    // a task: its title line like a to-do's (■ done / □ not done), then its notes
    if (n.type === 'workItem') {
      const txt = itemTitleText(n)
      if (txt) out.push(`${n.attrs?.status === 'done' ? '■' : '□'} ${txt}`)
      ;(n.content ?? []).slice(1).forEach(walk)
      return
    }
    if (n.type === 'listItem' || n.type === 'taskItem') {
      // the item's own line is its first block; nested lists follow as their own lines
      const [first, ...rest] = n.content ?? []
      const txt = first ? inlineText(first) : ''
      if (txt) out.push(n.type === 'taskItem' ? `${n.attrs?.checked ? '■' : '□'} ${txt}` : txt)
      rest.forEach(walk)
      return
    }
    n.content?.forEach(walk)
  }
  if (node) walk(node)
  return out
}

/** A source the browser would fetch from the web (http(s) or protocol-relative). */
const WEB_SRC = /^\s*(https?:)?\/\//i

type PreviewSource = { kind: 'img'; src: string; pos?: number } | { kind: 'web'; src: string } | { kind: 'css'; style: CSSProperties } | { kind: 'text'; lines: string[] }

/**
 * Source for a card's preview area, or null. A files property's web image is `web`: it never loads by itself (any
 * writer — the API, MCP, an import — could make every viewer's browser fetch an address); a click loads it.
 */
export function previewSource(m: DbModel, row: Page, preview: View['cardPreview']): PreviewSource | null {
  if (!preview || preview === 'none') return null
  if (preview === 'cover') {
    const c = row.cover
    if (c?.type === 'image') return { kind: 'img', src: c.value, pos: c.positionY }
    if (c?.type === 'gradient') return { kind: 'css', style: { background: c.value } }
    if (c?.type === 'color') return { kind: 'css', style: { background: `var(--c-${c.value}-bg)` } }
    const img = firstImage(row.content)
    if (img) return { kind: 'img', src: img }
    const lines = firstLines(row.content)
    return lines.length ? { kind: 'text', lines } : null
  }
  if (preview === 'content') {
    const img = firstImage(row.content)
    if (img) return { kind: 'img', src: img }
    const lines = firstLines(row.content)
    return lines.length ? { kind: 'text', lines } : null
  }
  const prop = m.propMap.get(preview)
  const files = prop?.type === 'files' ? ((row.properties[prop.id] as string[] | undefined) ?? []) : []
  const img = files.find((f) => guessIsImage(f))
  if (!img) return null
  return WEB_SRC.test(img) ? { kind: 'web', src: img } : { kind: 'img', src: img }
}

/** Web covers the person loaded in this tab (by address). */
const loadedWeb = new Set<string>()

const hostOf = (src: string) => {
  try {
    return new URL(src.trim().replace(/^\/\//, 'https://')).host
  } catch {
    return ''
  }
}

/** A web image as a card cover: a chip with its host until the person loads it (never a referrer, never by itself). */
function WebCover({ src }: { src: string }) {
  const t = useT()
  const [on, setOn] = useState(() => loadedWeb.has(src))
  if (on)
    return (
      <div className="dbc-cover">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} />
      </div>
    )
  const host = hostOf(src) || t('database.cover.web.unknown')
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  return (
    <div className="dbc-cover dbc-cover--web">
      <button
        type="button"
        className="dbc-webchip"
        title={src}
        aria-label={t('database.cover.web.load', { host })}
        onPointerDown={stop}
        onKeyDown={stop}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          loadedWeb.add(src)
          setOn(true)
        }}
      >
        <Globe size={14} strokeWidth={1.7} aria-hidden />
        <span className="dbc-webchip__host">{host}</span>
        <span className="dbc-webchip__act">{t('database.cover.web.action')}</span>
      </button>
    </div>
  )
}

function CoverImg({ src, pos }: { src: string; pos?: number }) {
  const url = useFileUrl(src)
  return url ? <img src={url} alt="" loading="lazy" draggable={false} style={{ objectPosition: `50% ${pos ?? 50}%` }} /> : null
}

export function CardPreview({ m, row, preview, reserve }: { m: DbModel; row: Page; preview: View['cardPreview']; reserve?: boolean }) {
  const src = previewSource(m, row, preview)
  if (!src)
    return reserve ? (
      <div className="dbc-cover dbc-cover--blank" aria-hidden>
        {row.icon && <PageIcon icon={row.icon} size={44} />}
      </div>
    ) : null
  if (src.kind === 'web') return <WebCover src={src.src} />
  if (src.kind === 'img')
    return (
      <div className="dbc-cover">
        <CoverImg src={src.src} pos={src.pos} />
      </div>
    )
  if (src.kind === 'css') return <div className="dbc-cover" style={src.style} />
  return (
    <div className="dbc-cover dbc-cover--text">
      {src.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  )
}

/** Inline title input used for freshly created cards. */
export function TitleInput({ row, onDone }: { row: Page; onDone: (cancelled: boolean) => void }) {
  const t = useT()
  const [v, setV] = useState(row.title)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const commit = (cancel = false) => {
    if (!cancel && v !== row.title) useWorkspace.getState().updatePage(row.id, { title: v.replace(/\n/g, ' ') })
    onDone(cancel)
  }
  return (
    <textarea
      ref={ref}
      className="dbc-titleinput"
      value={v}
      rows={1}
      placeholder={t('common.untitled')}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => commit()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          commit(!v.trim())
        }
      }}
    />
  )
}

export const CardBody = memo(function CardBody({ m, row, props, editing, onEditDone }: { m: DbModel; row: Page; props: PropertyDef[]; editing?: boolean; onEditDone?: (cancelled: boolean) => void }) {
  const t = useT()
  // another record type's fields are not part of this card (model/recordTypes)
  const values = rowProps(props, row).map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v) || p.type === 'checkbox')
  const subs = subItemCount(m, subItemsOf(m.db), row)
  return (
    <div className="dbc-body">
      <div className="dbc-title">
        {row.icon && <PageIcon icon={row.icon} size={16} />}
        {editing && onEditDone && !m.readOnly ? <TitleInput row={row} onDone={onEditDone} /> : <span className={row.title ? '' : 'is-empty'}>{row.title || t('common.untitled')}</span>}
      </div>
      {values.length > 0 && (
        <div className="dbc-props">
          {values.map(({ p, v }) => (
            <div key={p.id} className="dbc-prop" data-type={p.type} title={p.name}>
              <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={v} variant="card" interactive={!m.readOnly && (p.type === 'checkbox' || p.type === 'rating')} />
              {p.type === 'checkbox' && <span className="dbc-prop__label">{p.name}</span>}
            </div>
          ))}
        </div>
      )}
      {subs > 0 && (
        <div className="dbc-subs">
          <span aria-hidden>↳</span> {plural(t, 'database.sub.count', subs)}
        </div>
      )}
    </div>
  )
})
