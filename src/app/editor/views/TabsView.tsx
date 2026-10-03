/**
 * Tabs block — a strip of tab keys above the active tab's content.
 *  - click / ←→ Home End (roving tabindex) switch tabs; Enter, F2 or a double click renames
 *  - "+" adds a tab; the "⋯" key (or a right click on a tab) opens rename / duplicate / move /
 *    delete for the active tab
 *  - Mod+Alt+←/→ switch tabs from inside the content (schema/tabs.ts)
 * Which tab is active is view state (decorations from the tabs plugin), never document content.
 * Read-only renders (share view, history, presentation) get the same strip without editing.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { MoreHorizontal, Plus, Pencil, Copy, ArrowLeft, ArrowRight, Trash2 } from 'lucide-react'
import { Menu, type MenuEntry } from '../../ui/Menu'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { activateTab, tabPos, tabTitle, type TabsInfo } from '../schema/tabs'
import './tabs.css'

const pad = (n: number) => String(n).padStart(2, '0')

/** Does a tab hold anything worth a confirmation before deleting it? */
function hasContent(tab: PMNode): boolean {
  if (tab.childCount > 1) return true
  const first = tab.firstChild
  return !!first && (first.type.name !== 'paragraph' || first.content.size > 0)
}

function TitleInput({ initial, label, placeholder, onDone }: { initial: string; label: string; placeholder: string; onDone: (value: string | null, how: 'enter' | 'blur' | 'escape') => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (v: string | null, how: 'enter' | 'blur' | 'escape') => {
    if (done.current) return
    done.current = true
    onDone(v, how)
  }
  return (
    <input
      ref={ref}
      className="tabs__input"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      size={Math.max(4, value.length + 1)}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(value, 'enter')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(null, 'escape')
        }
      }}
      onBlur={() => finish(value, 'blur')}
    />
  )
}

function TabsFrame({ node, editor, getPos, decorations, readOnly }: ReactNodeViewProps & { readOnly: boolean }) {
  const t = useT()
  const spec = (decorations as ReadonlyArray<{ spec?: { tabs?: TabsInfo } }>).find((d) => d.spec?.tabs)?.spec?.tabs
  const count = node.childCount
  const active = Math.min(Math.max(0, spec?.index ?? 0), count - 1)
  const idBase = spec?.idBase ?? 'tabs'
  const live = useEditorState({ editor, selector: ({ editor: e }) => !!e?.isEditable && !e.isDestroyed })
  const editable = !readOnly && live
  const [editing, setEditing] = useState<number | null>(null)
  const [menuAt, setMenuAt] = useState<{ el: Element; index: number } | null>(null)
  const keys = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocus = useRef<number | null>(null)

  const titles: string[] = []
  node.forEach((tab, _o, i) => titles.push(tabTitle(tab, i)))

  // focus a tab key after the re-render that follows a switch / move
  useEffect(() => {
    const i = pendingFocus.current
    if (i === null) return
    pendingFocus.current = null
    const el = keys.current[i]
    el?.focus({ preventScroll: true })
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })

  const pos = () => {
    const p = getPos()
    return typeof p === 'number' && editor.state.doc.nodeAt(p)?.type.name === 'tabs' ? p : null
  }
  const current = () => {
    const p = pos()
    return p === null ? null : { p, node: editor.state.doc.nodeAt(p)! }
  }

  const select = (i: number, focus = false) => {
    const p = pos()
    if (p === null || editor.isDestroyed) return
    if (focus) pendingFocus.current = i
    if (i !== active) activateTab(editor.view, p, i)
    else if (focus) keys.current[i]?.focus()
  }

  /** Run a structural change; `next` = the tab to show afterwards. */
  const change = (build: (tr: import('@tiptap/pm/state').Transaction, p: number, tabs: PMNode) => number | null, opts: { focusKey?: boolean } = {}) => {
    const cur = current()
    if (!cur || !editable) return
    const tr = editor.state.tr
    const next = build(tr, cur.p, cur.node)
    if (!tr.docChanged) return
    if (next !== null && next >= 0) activateTab(editor.view, cur.p, next, tr)
    editor.view.dispatch(tr)
    if (opts.focusKey && next !== null) pendingFocus.current = next
  }

  const rename = (i: number, title: string) =>
    change((tr, p, tabs) => {
      const tab = tabs.child(i)
      if (!tab || title === String(tab.attrs.title ?? '')) return null
      tr.setNodeMarkup(tabPos(tabs, p, i), undefined, { ...tab.attrs, title })
      return null
    })

  const addTab = () => {
    const cur = current()
    if (!cur || !editable) return
    const { schema } = editor.state
    const n = cur.node.childCount
    change((tr, p, tabs) => {
      tr.insert(p + tabs.nodeSize - 1, schema.nodes.tab.create({ title: t('editor.tabs.untitled', { n: n + 1 }) }, schema.nodes.paragraph.create()))
      return n
    })
    setEditing(n)
  }

  const duplicate = (i: number) =>
    change(
      (tr, p, tabs) => {
        const tab = tabs.child(i)
        const at = tabPos(tabs, p, i) + tab.nodeSize
        tr.insert(at, tab.type.create({ ...tab.attrs, id: null, title: t('editor.tabs.copyOf', { title: tabTitle(tab, i) }) }, tab.content))
        return i + 1
      },
      { focusKey: true },
    )

  const move = (i: number, dir: -1 | 1) =>
    change(
      (tr, p, tabs) => {
        const j = i + dir
        if (j < 0 || j >= tabs.childCount) return null
        const tab = tabs.child(i)
        const from = tabPos(tabs, p, i)
        tr.delete(from, from + tab.nodeSize)
        const after = tr.doc.nodeAt(p)!
        tr.insert(tabPos(after, p, j), tab)
        return j
      },
      { focusKey: true },
    )

  const remove = (i: number) => {
    const cur = current()
    if (!cur || !editable) return
    const tab = cur.node.child(i)
    const id = tab.attrs.id as string | null
    const run = () => {
      const now = current()
      if (!now) return
      // positions may have moved while the confirmation was open: find the tab again
      let idx = i
      if (id) now.node.forEach((c, _o, k) => c.attrs.id === id && (idx = k))
      if (idx >= now.node.childCount) return
      if (now.node.childCount === 1) {
        const tr = editor.state.tr.delete(now.p, now.p + now.node.nodeSize)
        const $p = tr.doc.resolve(Math.min(now.p, tr.doc.content.size))
        tr.setSelection(TextSelection.near($p, -1))
        editor.view.dispatch(tr.scrollIntoView())
        editor.view.focus()
        return
      }
      change(
        (tr, p, tabs) => {
          const from = tabPos(tabs, p, idx)
          tr.delete(from, from + tabs.child(idx).nodeSize)
          // the deleted tab was shown: its left neighbour takes over; else the shown tab stays
          return idx === active ? Math.max(0, idx - 1) : active > idx ? active - 1 : active
        },
        { focusKey: true },
      )
    }
    if (!hasContent(tab)) return run()
    useUI.getState().openModal({
      type: 'confirm',
      title: t('editor.tabs.deleteTitle', { title: tabTitle(tab, i) }),
      body: t(cur.node.childCount === 1 ? 'editor.tabs.deleteLastBody' : 'editor.tabs.deleteBody'),
      danger: true,
      confirmLabel: t('common.delete'),
      onConfirm: run,
    })
  }

  /** Leave the title field: Enter continues in the tab's content. */
  const endEdit = (i: number, value: string | null, how: 'enter' | 'blur' | 'escape') => {
    setEditing(null)
    if (value !== null) rename(i, value.trim())
    if (how === 'escape') {
      pendingFocus.current = i
      return
    }
    if (how !== 'enter') return
    const cur = current()
    if (!cur) return
    const start = tabPos(cur.node, cur.p, i) + 1
    const tr = editor.state.tr
    const $s = tr.doc.resolve(start)
    const sel = TextSelection.findFrom($s, 1, true)
    if (sel && sel.from < start + cur.node.child(i).nodeSize) tr.setSelection(sel)
    editor.view.dispatch(tr)
    editor.view.focus()
  }

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = count - 1
    const go = (k: number) => {
      e.preventDefault()
      e.stopPropagation()
      select(k, true)
    }
    if (e.key === 'ArrowRight') go(i === last ? 0 : i + 1)
    else if (e.key === 'ArrowLeft') go(i === 0 ? last : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(last)
    else if ((e.key === 'Enter' || e.key === 'F2') && editable) {
      e.preventDefault()
      e.stopPropagation()
      if (i !== active) select(i)
      setEditing(i)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      remove(i)
    }
  }

  const menuEntries = (i: number): MenuEntry[] => [
    { kind: 'section', label: titles[i] ?? '' },
    { label: t('editor.tabs.rename'), icon: <Pencil size={15} />, hint: 'F2', onSelect: () => setEditing(i) },
    { label: t('common.duplicate'), icon: <Copy size={15} />, onSelect: () => duplicate(i) },
    { label: t('editor.tabs.moveLeft'), icon: <ArrowLeft size={15} />, disabled: i === 0, onSelect: () => move(i, -1) },
    { label: t('editor.tabs.moveRight'), icon: <ArrowRight size={15} />, disabled: i === count - 1, onSelect: () => move(i, 1) },
    { kind: 'separator' },
    { label: t('editor.tabs.delete'), icon: <Trash2 size={15} />, danger: true, onSelect: () => remove(i) },
  ]

  return (
    <NodeViewWrapper className={`tabs-block${editable ? ' is-editable' : ''}`} data-type="tabs" data-count={count}>
      <div className="tabs__strip" contentEditable={false} suppressContentEditableWarning>
        <div className="tabs__list" role="tablist" aria-label={t('editor.tabs.label')}>
          {titles.map((title, i) => (
            <span key={i} className="tabs__slot" role="presentation">
              {editing === i && editable ? (
                <span className="tabs__key is-active is-editing">
                  <span className="tabs__n" aria-hidden>
                    {pad(i + 1)}
                  </span>
                  <TitleInput initial={String(node.child(i).attrs.title ?? '')} label={t('editor.tabs.titleLabel')} placeholder={t('editor.tabs.untitled', { n: i + 1 })} onDone={(v, how) => endEdit(i, v, how)} />
                </span>
              ) : (
                <button
                  ref={(el) => {
                    keys.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={`${idBase}-t${i}`}
                  aria-controls={`${idBase}-p${i}`}
                  aria-selected={i === active}
                  tabIndex={i === active ? 0 : -1}
                  className={`tabs__key${i === active ? ' is-active' : ''}`}
                  onClick={() => select(i)}
                  onDoubleClick={() => editable && setEditing(i)}
                  onKeyDown={(e) => onKey(e, i)}
                  onContextMenu={(e) => {
                    if (!editable) return
                    e.preventDefault()
                    if (i !== active) select(i)
                    setMenuAt({ el: e.currentTarget, index: i })
                  }}
                >
                  <span className="tabs__n" aria-hidden>
                    {pad(i + 1)}
                  </span>
                  <span className="tabs__title">{title}</span>
                </button>
              )}
            </span>
          ))}
        </div>
        {editable && (
          <span className="tabs__tools">
            <button
              type="button"
              className="tabs__tool"
              aria-label={t('editor.tabs.options', { title: titles[active] ?? '' })}
              title={t('editor.tabs.optionsShort')}
              aria-haspopup="menu"
              aria-expanded={!!menuAt}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => setMenuAt(menuAt ? null : { el: keys.current[active] ?? e.currentTarget, index: active })}
            >
              <MoreHorizontal size={15} strokeWidth={1.75} />
            </button>
            <button type="button" className="tabs__tool tabs__add" aria-label={t('editor.tabs.add')} title={t('editor.tabs.add')} onMouseDown={(e) => e.preventDefault()} onClick={addTab}>
              <Plus size={15} strokeWidth={1.75} />
            </button>
          </span>
        )}
        <span className="tabs__spec label" aria-hidden>
          {pad(active + 1)}/{pad(count)}
        </span>
      </div>
      <NodeViewContent className="tabs__panels" />
      <Menu
        open={!!menuAt}
        anchor={menuAt?.el ?? null}
        onClose={() => setMenuAt(null)}
        entries={menuAt ? menuEntries(Math.min(menuAt.index, count - 1)) : []}
        placement="bottom-start"
        width={220}
      />
    </NodeViewWrapper>
  )
}

export function TabsView(props: ReactNodeViewProps) {
  return <TabsFrame {...props} readOnly={false} />
}

/** Read-only renders: switching works, editing doesn't. */
export function StaticTabsView(props: ReactNodeViewProps) {
  return <TabsFrame {...props} readOnly />
}

/**
 * Node view options: events on the strip (keys, title field, menu) belong to React, not
 * ProseMirror; and the strip re-renders when only the decorations change (= another tab shown),
 * which TipTap skips by default.
 */
export const tabsViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('.tabs__strip'),
  update: ({ updateProps }: { updateProps: () => void }) => {
    updateProps()
    return true
  },
}

