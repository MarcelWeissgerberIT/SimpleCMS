/**
 * Button block — a keycap in the page. Click (or ↵ / Space when it is focused or selected) runs
 * its actions in order; "Edit" (or ⇧↵) opens the configuration. Read-only renders
 * (share view, history, presentation) get StaticButtonView: a disabled key that never runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Settings2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { toast } from '../../store/ui'
import { useT } from '../../i18n'
import { asVariant, normalizeActions, type ButtonAction, type ButtonVariant } from '../schema/button'
import { consumeFreshButton, runButton } from '../lib/buttonRun'
import { ButtonConfig, type ButtonDraft } from './ButtonConfig'
import './button.css'

type RunState = 'idle' | 'busy' | 'ok' | 'error'

export function ButtonKey({ label, variant, state = 'idle', disabled, onClick, title }: { label: string; variant: ButtonVariant; state?: RunState; disabled?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button type="button" className={`ob-key ob-key--${variant}`} data-state={state} disabled={disabled} aria-busy={state === 'busy' || undefined} onClick={onClick} title={title}>
      <span className="ob-key__led" aria-hidden />
      <span className="ob-key__label">{label}</span>
    </button>
  )
}

export function ButtonView({ node, editor, getPos, selected, updateAttributes }: ReactNodeViewProps) {
  const t = useT()
  const label = String(node.attrs.label ?? '').trim() || t('editor.button.default')
  const variant = asVariant(node.attrs.variant)
  const actions = useMemo(() => normalizeActions(node.attrs.actions), [node.attrs.actions])
  const pageId = editor.view.dom.getAttribute('data-page-id')
  const trashed = useWorkspace((s) => !!pageId && !!s.pages[pageId] && isEffectivelyTrashed(s.pages, pageId))
  const locked = useWorkspace((s) => !!pageId && !!s.pages[pageId]?.settings.locked)
  const [config, setConfig] = useState(false)
  const [state, setState] = useState<RunState>('idle')
  const running = useRef(false)
  const alive = useRef(true)
  const canEdit = !trashed && !locked && editor.isEditable

  useEffect(() => {
    alive.current = true
    // inserted from the slash menu: straight into its settings
    if (consumeFreshButton(editor, actions.length > 0)) setConfig(true)
    return () => {
      alive.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (running.current || trashed) return
    if (!actions.length) {
      if (canEdit) setConfig(true)
      else toast({ message: t('editor.button.res.noActions'), kind: 'info' })
      return
    }
    running.current = true
    setState('busy')
    let ok = false
    try {
      ok = await runButton({ editor, getPos, label, actions, pageId })
    } finally {
      running.current = false
    }
    if (!alive.current) return
    setState(ok ? 'ok' : 'error')
    window.setTimeout(() => alive.current && setState('idle'), 1400)
  }

  const save = (next: ButtonDraft) => {
    setConfig(false)
    const changed = next.label !== node.attrs.label || next.variant !== node.attrs.variant || JSON.stringify(next.actions) !== JSON.stringify(node.attrs.actions ?? [])
    if (changed && !editor.isDestroyed) updateAttributes({ label: next.label, variant: next.variant, actions: next.actions as ButtonAction[] })
  }

  const count = actions.length
  return (
    <NodeViewWrapper className={`ob ob--${variant}${selected ? ' is-selected' : ''}${config ? ' is-configuring' : ''}`} data-type="button" contentEditable={false}>
      <ButtonKey label={label} variant={variant} state={state} disabled={trashed} onClick={run} />
      {canEdit && (
        <span className="ob__tools">
          <button type="button" className="ob-edit" onClick={() => setConfig(true)} aria-label={t('editor.button.configure')} aria-haspopup="dialog">
            <Settings2 size={13} strokeWidth={1.75} aria-hidden />
            <span>{t('editor.button.edit')}</span>
          </button>
          <span className={`ob__count label${count ? '' : ' is-empty'}`}>{count ? t(count === 1 ? 'editor.button.count.one' : 'editor.button.count', { count }) : t('editor.button.none')}</span>
          {selected && (
            <span className="ob__keys label" aria-hidden>
              <kbd className="kbd">↵</kbd> {t('editor.button.hint.run')} <kbd className="kbd">⇧↵</kbd> {t('editor.button.hint.edit')}
            </span>
          )}
        </span>
      )}
      {config && <ButtonConfig initial={{ label: String(node.attrs.label ?? ''), variant, actions }} pageId={pageId} onDone={save} />}
    </NodeViewWrapper>
  )
}

/** Read-only contexts: the same key, disabled — it never runs. */
export function StaticButtonView({ node }: ReactNodeViewProps) {
  const t = useT()
  const label = String(node.attrs.label ?? '').trim() || t('editor.button.default')
  const variant = asVariant(node.attrs.variant)
  return (
    <NodeViewWrapper className={`ob ob--${variant} is-static`} data-type="button" contentEditable={false}>
      <ButtonKey label={label} variant={variant} disabled title={t('editor.button.readOnly')} />
    </NodeViewWrapper>
  )
}
