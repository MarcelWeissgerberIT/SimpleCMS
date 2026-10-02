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

/** Source for a card's preview area, or null. */
export function previewSource(m: DbModel, row: Page, preview: View['cardPreview']): { kind: 'img'; src: string; pos?: number } | { kind: 'css'; style: CSSProperties } | { kind: 'text'; lines: string[] } | null {
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
  return img ? { kind: 'img', src: img } : null
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
  const values = props.map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v) || p.type === 'checkbox')
  return (
    <div className="dbc-body">
      <div className="dbc-title">
        {row.icon && <PageIcon icon={row.icon} size={16} />}
        {editing && onEditDone ? <TitleInput row={row} onDone={onEditDone} /> : <span className={row.title ? '' : 'is-empty'}>{row.title || t('common.untitled')}</span>}
      </div>
      {values.length > 0 && (
        <div className="dbc-props">
          {values.map(({ p, v }) => (
            <div key={p.id} className="dbc-prop" data-type={p.type} title={p.name}>
              <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={v} variant="card" interactive={p.type === 'checkbox' || p.type === 'rating'} />
              {p.type === 'checkbox' && <span className="dbc-prop__label">{p.name}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
