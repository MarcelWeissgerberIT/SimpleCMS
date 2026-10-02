import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Popover } from '../../ui/Popover'
import { Kbd, MOD } from '../../ui/controls'
import { useT } from '../../i18n'

function renderInto(el: HTMLElement | null, latex: string, displayMode: boolean): boolean {
  if (!el) return true
  try {
    katex.render(latex, el, { displayMode, throwOnError: true, strict: false, output: 'htmlAndMathml' })
    return true
  } catch {
    try {
      katex.render(latex, el, { displayMode, throwOnError: false, strict: false })
    } catch {
      el.textContent = latex
    }
    return false
  }
}

function Tex({ latex, display, onValid }: { latex: string; display: boolean; onValid?: (ok: boolean) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const ok = renderInto(ref.current, latex, display)
    onValid?.(ok)
  }, [latex, display, onValid])
  return <span ref={ref} className="tex" />
}

function MathEditor({
  anchor,
  initial,
  display,
  onCommit,
  onCancel,
}: {
  anchor: Element
  initial: string
  display: boolean
  onCommit: (latex: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const [valid, setValid] = useState(true)
  const done = () => onCommit(value.trim())
  return (
    <Popover open anchor={anchor} onClose={done} placement="bottom" offset={8} className="math-editor">
      <div className="math-editor__head">
        <span className="label">{display ? t('editor.math.block') : t('editor.math.inline')} · TeX</span>
        {!valid && value.trim() && <span className="math-editor__err label">{t('editor.math.invalid')}</span>}
      </div>
      <textarea
        className="input math-editor__input"
        value={value}
        rows={display ? 3 : 1}
        spellCheck={false}
        data-autofocus=""
        placeholder="\\frac{a}{b}"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (!display || e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            done()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="math-editor__preview">{value.trim() ? <Tex latex={value} display={display} onValid={setValid} /> : <span className="faint">{t('editor.math.preview')}</span>}</div>
      <div className="math-editor__foot">
        <span className="faint">
          {display ? (
            <>
              <Kbd>{MOD}</Kbd>
              <Kbd>↵</Kbd>
            </>
          ) : (
            <Kbd>↵</Kbd>
          )}{' '}
          {t('editor.math.done')}
        </span>
        <button type="button" className="btn btn--sm btn--ink" onClick={done}>
          {t('common.done')}
        </button>
      </div>
    </Popover>
  )
}

function useMathEditing({ node, selected, editor, deleteNode, updateAttributes }: ReactNodeViewProps) {
  const latex = String(node.attrs.latex ?? '')
  const [editing, setEditing] = useState(false)
  // freshly inserted (selected + empty) → open the editor right away
  useEffect(() => {
    if (selected && !latex && editor.isEditable) setEditing(true)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (v: string) => {
    setEditing(false)
    if (!v) {
      deleteNode()
      return
    }
    if (v !== latex) updateAttributes({ latex: v })
    editor.commands.focus()
  }
  const cancel = () => {
    setEditing(false)
    if (!latex) deleteNode()
    else editor.commands.focus()
  }
  return { latex, editing, setEditing, commit, cancel }
}

export function BlockMathView(props: ReactNodeViewProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const { latex, editing, setEditing, commit, cancel } = useMathEditing(props)
  return (
    <NodeViewWrapper className={`math-block${props.selected ? ' is-selected' : ''}`} data-type="block-math" contentEditable={false}>
      <div ref={ref} className="math-block__inner" onClick={() => props.editor.isEditable && setEditing(true)} role="button" tabIndex={-1}>
        {latex ? <Tex latex={latex} display /> : <span className="math-block__empty label">{t('editor.math.empty')}</span>}
      </div>
      {editing && ref.current && <MathEditor anchor={ref.current} initial={latex} display onCommit={commit} onCancel={cancel} />}
    </NodeViewWrapper>
  )
}

export function InlineMathView(props: ReactNodeViewProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const { latex, editing, setEditing, commit, cancel } = useMathEditing(props)
  return (
    <NodeViewWrapper as="span" className={`math-inline${props.selected ? ' is-selected' : ''}`} data-type="inline-math" contentEditable={false}>
      <span ref={ref} onClick={() => props.editor.isEditable && setEditing(true)}>
        {latex ? <Tex latex={latex} display={false} /> : <span className="math-inline__empty">TeX</span>}
      </span>
      {editing && ref.current && <MathEditor anchor={ref.current} initial={latex} display={false} onCommit={commit} onCancel={cancel} />}
    </NodeViewWrapper>
  )
}
