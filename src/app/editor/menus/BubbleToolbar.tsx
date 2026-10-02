/**
 * Selection toolbar — an ink "control strip": Turn into, marks, link, colour, inline math, Ask AI.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { useStore } from 'zustand'
import Fuse from 'fuse.js'
import { Bold, ChevronDown, Code, CornerDownLeft, Italic, Link2, Pi, Strikethrough, Underline, Unlink } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { Menu, useMenu } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { shortcutLabel } from '../../ui/controls'
import { COLOR_NAMES } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { activeTurnTarget, turnInto } from '../lib/blocks'
import { TURN_INTO_ITEMS } from '../lib/catalog'
import { isUrl } from '../lib/embeds'
import { BlockGlyph } from './SlashMenu'
import { posAnchor } from './common'

const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches

export function normalizeHref(raw: string): string {
  const v = raw.trim()
  if (!v) return v
  if (/^(https?:|mailto:|tel:|#)/i.test(v)) return v
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  return `https://${v}`
}

function Btn({ label, keys, active, onClick, children, wide }: { label: string; keys?: string; active?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      className={`bubble__btn${wide ? ' bubble__btn--wide' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={keys ? `${label}  ${shortcutLabel(keys)}` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Text + background colour grid (shared by bubble toolbar and block menu). */
export function ColorGrid({ text, bg, onText, onBg }: { text: string | null; bg: string | null; onText: (c: string | null) => void; onBg: (c: string | null) => void }) {
  const t = useT()
  return (
    <div className="color-grid" onMouseDown={(e) => e.preventDefault()}>
      <div className="label">{t('editor.color.text')}</div>
      <div className="color-grid__row">
        {COLOR_NAMES.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-pressed={(text ?? 'default') === c}
            title={t(`color.${c}`)}
            style={{ color: `var(--c-${c}-text)`, background: 'var(--surface)' }}
            onClick={() => onText(c === 'default' ? null : c)}
          >
            A
          </button>
        ))}
      </div>
      <div className="label">{t('editor.color.background')}</div>
      <div className="color-grid__row">
        {COLOR_NAMES.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-pressed={(bg ?? 'default') === c}
            title={t(`color.${c}`)}
            style={{ background: c === 'default' ? 'var(--surface)' : `var(--c-${c}-bg)`, color: 'var(--ink)' }}
            onClick={() => onBg(c === 'default' ? null : c)}
          >
            A
          </button>
        ))}
      </div>
    </div>
  )
}

function LinkPanel({ editor, initial, onDone }: { editor: Editor; initial: string; onDone: () => void }) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const [active, setActive] = useState(0)
  const pages = useMemo(() => {
    const q = value.trim()
    if (!q || isUrl(q) || q.startsWith('#') || q.includes('://')) return []
    const self = editor.view.dom.getAttribute('data-page-id')
    const all = Object.values(useWorkspace.getState().pages).filter((p) => !p.trashed && p.id !== self)
    return new Fuse(all, { keys: ['title'], threshold: 0.38, ignoreLocation: true })
      .search(q)
      .slice(0, 5)
      .map((r) => r.item)
  }, [value, editor])
  useEffect(() => setActive(0), [pages])

  const apply = (href: string, text?: string) => {
    const { empty, from } = editor.state.selection
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else if (empty) {
      const label = text || href
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] })
        .setTextSelection(from + label.length)
        .unsetMark('link')
        .run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    onDone()
  }
  const submit = () => {
    const p = pages[active]
    if (p) apply(`#/p/${p.id}`, p.title || t('common.untitled'))
    else apply(normalizeHref(value))
  }
  return (
    <div className="bubble__link" onMouseDown={(e) => e.stopPropagation()}>
      <div className="bubble__link-row">
        <Link2 size={14} className="bubble__link-icon" />
        <input
          className="bubble__link-input"
          value={value}
          autoFocus
          placeholder={t('editor.link.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onDone()
              editor.commands.focus()
            } else if (e.key === 'ArrowDown' && pages.length) {
              e.preventDefault()
              setActive((active + 1) % pages.length)
            } else if (e.key === 'ArrowUp' && pages.length) {
              e.preventDefault()
              setActive((active - 1 + pages.length) % pages.length)
            }
          }}
        />
        <button type="button" className="bubble__btn" title={t('editor.link.apply')} onClick={submit} disabled={!value.trim()}>
          <CornerDownLeft size={14} />
        </button>
        {initial && (
          <button type="button" className="bubble__btn" title={t('editor.link.remove')} onClick={() => apply('')}>
            <Unlink size={14} />
          </button>
        )}
      </div>
      {pages.length > 0 && (
        <div className="bubble__link-results">
          <div className="label">{t('editor.link.pages')}</div>
          {pages.map((p, i) => (
            <button key={p.id} type="button" className="bubble__link-result" data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => apply(`#/p/${p.id}`, p.title || t('common.untitled'))}>
              <PageIcon icon={p.icon} kind={p.kind} size={15} />
              <span>{pageTitle(p, t('common.untitled'))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function BubbleToolbar({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const t = useT()
  const linkEdit = useStore(bridge, (s) => s.linkEdit)
  const blocked = useStore(bridge, (s) => !!s.suggest || !!s.ai || !!s.urlPaste)
  const [mouseDown, setMouseDown] = useState(false)
  const [sub, setSub] = useState<'color' | null>(null)
  const turnMenu = useMenu()
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const colorBtn = useRef<HTMLButtonElement>(null)

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const { selection } = e.state
      return {
        from: selection.from,
        to: selection.to,
        empty: selection.empty,
        text: selection instanceof TextSelection,
        code: !!selection.$from.parent.type.spec.code,
        focused: e.isFocused,
        editable: e.isEditable,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        inlineCode: e.isActive('code'),
        link: (e.getAttributes('link').href as string | undefined) ?? null,
        color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
        bg: e.isActive('highlight') ? ((e.getAttributes('highlight').color as string | undefined) ?? 'yellow') : null,
        turn: activeTurnTarget(e),
      }
    },
  })

  useEffect(() => {
    const dom = editor.view.dom
    const down = (e: MouseEvent) => e.button === 0 && setMouseDown(true)
    const up = () => setMouseDown(false)
    dom.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => {
      dom.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
    }
  }, [editor])

  const key = st ? `${st.from}:${st.to}` : ''
  useEffect(() => {
    if (dismissedAt && dismissedAt !== key) setDismissedAt(null)
  }, [key, dismissedAt])

  const anchor = useMemo(() => (st ? posAnchor(editor, st.from, st.to) : null), [editor, st?.from, st?.to]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null
  const subOpen = !!sub || turnMenu.open
  const selectionUi = st.editable && st.text && !st.empty && !st.code && !blocked && !mouseDown && dismissedAt !== key && (st.focused || subOpen)
  const show = st.editable && (linkEdit || selectionUi)
  const closeLink = () => bridge.setState({ linkEdit: false })
  const turnLabel = TURN_INTO_ITEMS.find((b) => b.turnInto === st.turn)

  return (
    <Popover
      open={show}
      anchor={anchor}
      onClose={() => (linkEdit ? closeLink() : setDismissedAt(key))}
      placement={isTouch ? 'bottom' : 'top'}
      offset={10}
      bare
      autoFocus={false}
      closeOnOutside={linkEdit}
      className="bubble"
      role="toolbar"
      aria-label={t('editor.bubble.label')}
    >
      {linkEdit ? (
        <LinkPanel editor={editor} initial={st.link ?? ''} onDone={closeLink} />
      ) : (
        <div className="bubble__strip">
          <Btn label={t('editor.bubble.askAI')} onClick={() => bridge.setState({ ai: { mode: 'selection' } })} wide>
            <span className="led led--on" />
            <span className="bubble__long">{t('editor.bubble.askAI')}</span>
            <span className="bubble__short">{t('editor.bubble.ai')}</span>
          </Btn>
          <span className="bubble__sep" />
          <Btn label={t('editor.bubble.turnInto')} onClick={(e) => turnMenu.toggle(e)} wide>
            {turnLabel && <BlockGlyph item={turnLabel} size={14} />}
            <span className="bubble__turn bubble__long">{turnLabel ? t(`editor.block.${turnLabel.id}`) : t('editor.block.text')}</span>
            <ChevronDown size={12} />
          </Btn>
          <span className="bubble__sep" />
          <Btn label={t('editor.mark.bold')} keys="Mod+B" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={15} strokeWidth={2.2} />
          </Btn>
          <Btn label={t('editor.mark.italic')} keys="Mod+I" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={15} />
          </Btn>
          <Btn label={t('editor.mark.underline')} keys="Mod+U" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline size={15} />
          </Btn>
          <Btn label={t('editor.mark.strike')} keys="Mod+Shift+S" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size={15} />
          </Btn>
          <Btn label={t('editor.mark.code')} keys="Mod+E" active={st.inlineCode} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size={15} />
          </Btn>
          <Btn label={t('editor.mark.link')} keys="Mod+K" active={!!st.link} onClick={() => bridge.setState({ linkEdit: true })}>
            <Link2 size={15} />
          </Btn>
          <span className="bubble__sep" />
          <button
            ref={colorBtn}
            type="button"
            className="bubble__btn bubble__color"
            aria-label={t('common.color')}
            title={t('common.color')}
            aria-expanded={sub === 'color'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSub(sub === 'color' ? null : 'color')}
          >
            <span className="bubble__color-a" style={{ color: st.color ? `var(--c-${st.color}-text)` : undefined, background: st.bg ? `var(--c-${st.bg}-bg)` : undefined }}>
              A
            </span>
            <ChevronDown size={12} />
          </button>
          <Btn
            label={t('editor.mark.math')}
            onClick={() => {
              const { from, to } = editor.state.selection
              const text = editor.state.doc.textBetween(from, to, ' ')
              editor.chain().focus().insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex: text } }).run()
            }}
          >
            <Pi size={15} />
          </Btn>
        </div>
      )}
      <Menu
        {...turnMenu.props}
        placement="bottom-start"
        width={220}
        entries={[
          { kind: 'section', label: t('editor.bubble.turnInto') },
          ...TURN_INTO_ITEMS.map((b) => ({
            label: t(`editor.block.${b.id}`),
            icon: <BlockGlyph item={b} size={15} />,
            hint: b.md,
            checked: st.turn === b.turnInto,
            onSelect: () => turnInto(editor, b.turnInto!),
          })),
        ]}
      />
      <Popover open={sub === 'color'} anchor={colorBtn.current} onClose={() => setSub(null)} placement="bottom-start" autoFocus={false}>
        <ColorGrid
          text={st.color}
          bg={st.bg}
          onText={(c) => {
            if (c) editor.chain().focus().setTextColor(c).run()
            else editor.chain().focus().unsetTextColor().run()
          }}
          onBg={(c) => {
            if (c) editor.chain().focus().setHighlight({ color: c }).run()
            else editor.chain().focus().unsetHighlight().run()
          }}
        />
      </Popover>
    </Popover>
  )
}
