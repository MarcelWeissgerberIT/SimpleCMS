/**
 * The word-level diff as a page (docDiff.ts): removed words struck through on a red tint, new words on
 * the signal tint, unchanged blocks folded ("12 unchanged blocks"). Used by History ("Changes") and the
 * AI terminal's review of an edit.
 *  - variant 'rich' (History): unchanged / removed / added blocks render with the editor's own look
 *    (ReadOnlyDoc); changed blocks are drawn here, inside `.doc-content` so they share its typography.
 *  - variant 'plain' (terminal, custom agents' review): everything drawn here — light, no editor.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { useLang, useT } from '../../i18n'
import { ReadOnlyDoc, StaticWorkItem, itemChanges, workItemDueText, workItemReminderShort, type ItemChange } from '../../editor'
import { useWorkspace } from '../../store/store'
import { foldRows, toDiffNode, type DiffNode, type DiffRow, type DocItem } from './docDiff'
import './diff.css'

type Variant = 'rich' | 'plain'

export function DocDiff({ items, context = 2, variant = 'rich', label }: { items: DocItem[]; context?: number; variant?: Variant; label?: string }) {
  const t = useT()
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  const rows = useMemo(() => foldRows(items, context, open), [items, context, open])
  const groups = useMemo(() => groupRows(rows, variant), [rows, variant])
  return (
    <div className="ddiff" data-variant={variant} aria-label={label}>
      {groups.map((g, i) => {
        if (g.kind === 'fold')
          return (
            <button key={`f${g.from}`} type="button" className="ddiff__fold" onClick={() => setOpen((o) => new Set(o).add(g.from))} data-testid="diff-fold">
              <span className="ddiff__fold-rule" aria-hidden />
              <span className="label">{t('features.history.unchangedBlocks', { count: g.count })}</span>
              <span className="ddiff__fold-rule" aria-hidden />
            </button>
          )
        if (g.kind === 'docs') {
          const doc: JSONContent = { type: 'doc', content: g.blocks }
          const blank = g.state !== 'same' && g.blocks.every((b) => b.type === 'paragraph' && !b.content?.length)
          return (
            <div key={`d${i}`} className="ddiff__seg" data-state={g.state}>
              {g.state !== 'same' && <SegMark state={g.state} />}
              {blank ? <span className="ddiff__blank label">¶ {t('features.history.emptyLines', { count: g.blocks.length })}</span> : <ReadOnlyDoc content={doc} />}
            </div>
          )
        }
        // drawn here: a changed block, or (plain) any block — a whole removed / added one takes its look from the row
        const state = g.item.kind === 'changed' ? 'changed' : g.item.kind
        const node = g.item.kind === 'changed' ? g.item.merged : toDiffNode(g.item.block)
        return (
          <div key={`i${g.index}`} className="ddiff__seg" data-state={state}>
            {state !== 'same' && <SegMark state={state} />}
            <div className={variant === 'rich' ? 'one-doc' : 'ddiff__plain'}>
              <div className={variant === 'rich' ? 'doc-content ddiff__doc' : 'ddiff__doc'}>
                <DiffBlock node={node} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SegMark({ state }: { state: 'removed' | 'added' | 'changed' }) {
  const t = useT()
  const glyph = state === 'added' ? '+' : state === 'removed' ? '−' : '~'
  return (
    <span className="ddiff__mark mono" aria-label={t(`features.history.${state === 'changed' ? 'changedOne' : state}`)}>
      {glyph}
    </span>
  )
}

type Group = { kind: 'fold'; count: number; from: number } | { kind: 'docs'; state: 'same' | 'removed' | 'added'; blocks: JSONContent[] } | { kind: 'item'; item: DocItem; index: number }

/** Rich: runs of whole blocks of one state render as one editor doc; plain: one row per block. */
function groupRows(rows: DiffRow[], variant: Variant): Group[] {
  const out: Group[] = []
  for (const r of rows) {
    if (r.kind === 'fold') {
      out.push({ kind: 'fold', count: r.count, from: r.from })
      continue
    }
    const it = r.item
    if (variant === 'plain' || it.kind === 'changed') {
      out.push({ kind: 'item', item: it, index: r.index })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'docs' && last.state === it.kind) last.blocks.push(it.block)
    else out.push({ kind: 'docs', state: it.kind, blocks: [it.block] })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Drawing a DiffNode                                                  */
/* ------------------------------------------------------------------ */

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const diffAttr = (n: DiffNode) => (n.diff ? { 'data-diff': n.diff } : {})

export function DiffBlock({ node }: { node: DiffNode }) {
  return <>{renderNode(node, 'b')}</>
}

function kids(n: DiffNode): ReactNode {
  return (n.content ?? []).map((c, i) => renderNode(c, String(i)))
}

function renderText(n: DiffNode, key: string): ReactNode {
  let el: ReactNode = n.text ?? ''
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case 'bold':
        el = <strong>{el}</strong>
        break
      case 'italic':
        el = <em>{el}</em>
        break
      case 'strike':
        el = <s>{el}</s>
        break
      case 'underline':
        el = <u>{el}</u>
        break
      case 'code':
        el = <code>{el}</code>
        break
      case 'highlight':
        el = <mark>{el}</mark>
        break
      case 'link':
        el = <span className="ddiff-link">{el}</span>
        break
    }
  }
  if (n.diff === 'del') return <del key={key} className="ddiff-del">{el}</del>
  if (n.diff === 'add') return <ins key={key} className="ddiff-ins">{el}</ins>
  return <Fragment key={key}>{el}</Fragment>
}

function inlineAtom(n: DiffNode, key: string): ReactNode {
  const a = n.attrs ?? {}
  let text = ''
  if (n.type === 'mention') text = `@${str(a.label) || str(a.id)}`
  else if (n.type === 'inlineMath') text = `$${str(a.latex)}$`
  else if (n.type === 'icon') text = `:${str(a.name)}:`
  const el = <span className="ddiff-chip">{text}</span>
  if (n.diff === 'del') return <del key={key} className="ddiff-del">{el}</del>
  if (n.diff === 'add') return <ins key={key} className="ddiff-ins">{el}</ins>
  return <Fragment key={key}>{el}</Fragment>
}

function renderNode(n: DiffNode, key: string): ReactNode {
  const a = n.attrs ?? {}
  const d = diffAttr(n)
  switch (n.type) {
    case 'text':
      return renderText(n, key)
    case 'hardBreak':
      return <br key={key} />
    case 'mention':
    case 'inlineMath':
    case 'icon':
      return inlineAtom(n, key)
    case 'paragraph':
      return (
        <p key={key} {...d}>
          {kids(n)}
        </p>
      )
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(a.level) || 1))
      const H = (['h2', 'h3', 'h4'] as const)[level - 1]
      return (
        <H key={key} data-level={level} {...d}>
          {kids(n)}
        </H>
      )
    }
    case 'bulletList':
      return (
        <ul key={key} {...d}>
          {kids(n)}
        </ul>
      )
    case 'orderedList':
      return (
        <ol key={key} start={Number(a.start) || 1} {...d}>
          {kids(n)}
        </ol>
      )
    case 'listItem':
      return (
        <li key={key} {...d}>
          {kids(n)}
        </li>
      )
    case 'taskList':
      return (
        <ul key={key} className="ddiff-tasks" {...d}>
          {kids(n)}
        </ul>
      )
    case 'taskItem': {
      const was = n.was && n.was.checked !== a.checked ? (n.was.checked ? '☑' : '☐') : null
      return (
        <li key={key} className="ddiff-task" data-checked={a.checked ? 'true' : undefined} {...d}>
          <span className="ddiff-task__box mono" aria-hidden>
            {was && <del className="ddiff-del">{was}</del>}
            {was ? <ins className="ddiff-ins">{a.checked ? '☑' : '☐'}</ins> : a.checked ? '☑' : '☐'}
          </span>
          <div>{kids(n)}</div>
        </li>
      )
    }
    case 'blockquote':
      return (
        <blockquote key={key} {...d}>
          {kids(n)}
        </blockquote>
      )
    case 'codeBlock':
      return (
        <pre key={key} {...d}>
          <code>{kids(n)}</code>
        </pre>
      )
    case 'callout': {
      const icon = str(a.icon)
      return (
        <div key={key} className={`callout callout--${str(a.color) || 'default'}`} {...d}>
          <span className="callout__icon" aria-hidden>
            {icon && icon.length <= 4 ? icon : '◆'}
          </span>
          <div className="callout__body">{kids(n)}</div>
        </div>
      )
    }
    case 'details':
    case 'detailsContent':
    case 'columns':
    case 'column':
    case 'tabs':
    case 'syncedBlock':
    case 'meetingNotes':
      return (
        <div key={key} className={`ddiff-box ddiff-box--${n.type}`} {...d}>
          {kids(n)}
        </div>
      )
    case 'workItem':
      return <WorkItemDiff key={key} node={n} />
    case 'tab':
      return (
        <div key={key} className="ddiff-box ddiff-box--tab" {...d}>
          <span className="ddiff-box__label label">{str(a.title)}</span>
          {kids(n)}
        </div>
      )
    case 'detailsSummary':
      return (
        <p key={key} className="ddiff-summary" {...d}>
          <span aria-hidden>▸ </span>
          {kids(n)}
        </p>
      )
    case 'table':
      return (
        <table key={key} className="ddiff-table" {...d}>
          <tbody>{kids(n)}</tbody>
        </table>
      )
    case 'tableRow':
      return (
        <tr key={key} {...d}>
          {kids(n)}
        </tr>
      )
    case 'tableHeader':
      return (
        <th key={key} {...d}>
          {kids(n)}
        </th>
      )
    case 'tableCell':
      return (
        <td key={key} {...d}>
          {kids(n)}
        </td>
      )
    case 'horizontalRule':
      return <hr key={key} {...d} />
    default:
      return <AtomBlock key={key} node={n} />
  }
}

/* ------------------------------------------------------------------ */
/* Task block: the placard (as it is now) + its fields before → after  */
/* ------------------------------------------------------------------ */

function WorkItemDiff({ node }: { node: DiffNode }) {
  const t = useT()
  const changes = useMemo(() => (node.was ? itemChanges(node.was, node.attrs) : []), [node.was, node.attrs])
  return (
    <div className="ddiff-item" {...diffAttr(node)}>
      <StaticWorkItem attrs={node.attrs}>{kids(node)}</StaticWorkItem>
      {changes.length > 0 && (
        <dl className="ddiff-fields" aria-label={t('features.history.item.label')} data-testid="workitem-changes">
          {changes.map((c) => (
            <div key={c.field} className="ddiff-fields__row" data-field={c.field}>
              <dt className="label">{t(`features.history.item.${c.field}`)}</dt>
              <dd>
                <FieldValue change={c} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** One field's change: the value before (struck) → after; people added / removed by name. */
function FieldValue({ change: c }: { change: ItemChange }) {
  const t = useT()
  const lang = useLang()
  const people = useWorkspace((s) => s.people)
  const none = t('features.history.item.none')
  const pair = (a: string, b: string) => (
    <>
      <del className="ddiff-del">{a}</del> <span aria-hidden>→</span> <ins className="ddiff-ins">{b}</ins>
    </>
  )
  switch (c.field) {
    case 'status':
      return pair(t(`editor.workItem.status.${c.before.status}`), t(`editor.workItem.status.${c.after.status}`))
    case 'due':
      return pair(c.before.due ? workItemDueText(c.before.due, lang) : none, c.after.due ? workItemDueText(c.after.due, lang) : none)
    case 'reminder': {
      const r = (code: string | null) => (code ? workItemReminderShort(code, t) || '🔔' : none)
      return pair(r(c.before.reminder), r(c.after.reminder))
    }
    case 'people': {
      const name = (id: string) => people.find((p) => p.id === id)?.name ?? null
      const kept = c.after.people.filter((id) => !c.added.includes(id)).map(name).filter(Boolean) as string[]
      const added = c.added.map(name).filter(Boolean) as string[]
      const removed = c.removed.map(name).filter(Boolean) as string[]
      // frozen copies: names only
      if (!c.before.people.length && !c.after.people.length) return pair(c.before.frozen?.people.join(', ') || none, c.after.frozen?.people.join(', ') || none)
      if (!kept.length && !added.length && !removed.length) return <>{none}</>
      return (
        <>
          {[...kept.map((n) => <span key={`k${n}`}>{n}</span>), ...removed.map((n) => <del key={`r${n}`} className="ddiff-del">{n}</del>), ...added.map((n) => <ins key={`a${n}`} className="ddiff-ins">{n}</ins>)].map((el, i) => (
            <Fragment key={i}>
              {i > 0 && ', '}
              {el}
            </Fragment>
          ))}
        </>
      )
    }
    case 'blockedBy':
    case 'related': {
      const n = (list: string[]) => (list.length ? t(list.length === 1 ? 'features.history.item.links.one' : 'features.history.item.links', { n: list.length }) : none)
      return pair(n(c.before[c.field]), n(c.after[c.field]))
    }
  }
}

/** A block without text (image, database, embed …): a placard with what it is. */
function AtomBlock({ node }: { node: DiffNode }) {
  const t = useT()
  const a = node.attrs ?? {}
  const kind = ATOM_LABEL[node.type] ?? 'block'
  // a page link / an inline database: the title it points at
  const target = useWorkspace((s) => (node.type === 'pageLink' ? s.pages[str(a.pageId)]?.title : node.type === 'databaseBlock' ? s.pages[str(a.databaseId)]?.title : undefined))
  const detail = (target?.trim() ?? '') || str(a.alt) || str(a.caption) || str(a.title) || str(a.name) || str(a.label) || str(a.url) || str(a.latex) || ''
  return (
    <div className="ddiff-atom" {...diffAttr(node)}>
      <span className="ddiff-atom__kind label">{t(`features.history.atom.${kind}`)}</span>
      {detail && <span className="ddiff-atom__detail">{detail.length > 80 ? `${detail.slice(0, 79)}…` : detail}</span>}
    </div>
  )
}

const ATOM_LABEL: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  fileBlock: 'file',
  bookmark: 'bookmark',
  embed: 'embed',
  databaseBlock: 'database',
  pageLink: 'page',
  mermaid: 'diagram',
  blockMath: 'math',
  toc: 'toc',
  breadcrumb: 'breadcrumb',
  spreadsheet: 'spreadsheet',
  chart: 'chart',
  button: 'button',
}
