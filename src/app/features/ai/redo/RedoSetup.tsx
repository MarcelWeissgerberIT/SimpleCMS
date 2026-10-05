/**
 * "Redo with instructions" — the instructions card in the AI panel, after the passages were marked:
 * a multi-line field, saved presets as chips (use / save / rename / delete — per device), an optional
 * rules page (a style guide whose content goes along; "@" in the field or the key), Run (⌘↵).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { BookMarked, MoreHorizontal, Plus, X } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import { Menu, MenuList, useMenu, type MenuEntry } from '../../../ui/Menu'
import { Kbd, shortcutLabel } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID } from '../../../store/types'
import type { RunRequest } from '../runs'
import { capturePassages, type RedoPassage } from './passages'
import { addPreset, deletePreset, PRESETS_MAX, renamePreset, useRedoPresets, type RedoPreset } from './presets'
import { countWords } from '../reads'
import './redo.css'

/** What the card holds — kept by the panel while the picker or the reads choice is open. */
export interface RedoDraft {
  text: string
  /** the rules page (null: none) */
  rules: ID | null
}

export interface RedoSetupProps {
  editor: Editor
  /** the marked passages (block ids) */
  ids: string[]
  draft: RedoDraft
  onDraft: (draft: RedoDraft) => void
  onRun: (req: RunRequest) => void
  onRepick: () => void
  onCancel: () => void
}

export function RedoSetup({ editor, ids, draft, onDraft, onRun, onRepick, onCancel }: RedoSetupProps) {
  const t = useT()
  const lang = useLang()
  const presets = useRedoPresets((s) => s.list)
  const { text, rules } = draft
  const setText = (next: string | ((cur: string) => string)) => onDraft({ ...draft, text: typeof next === 'function' ? next(text) : next })
  const setRules = (id: ID | null) => onDraft({ ...draft, rules: id })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [pickRules, setPickRules] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const rulesBtn = useRef<HTMLButtonElement>(null)
  const rulesTitle = useWorkspace((s) => (rules ? s.pages[rules]?.title.trim() || t('common.untitled') : ''))
  // Esc while renaming a preset ends the renaming, not the panel
  const renameOff = useRef(false)
  useEscapeFirst(renaming !== null, () => {
    renameOff.current = true
    setRenaming(null)
  })

  const doc = editor.isDestroyed ? null : editor.state.doc
  const passages: RedoPassage[] = useMemo(() => (doc ? capturePassages(editor, ids) : []), [editor, ids, doc])

  // the keyboard comes to the instructions (also when the card comes back from the reads choice)
  useEffect(() => {
    const id = requestAnimationFrame(() => areaRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [])
  const sent = passages.filter((p) => !p.skip)
  const skipped = passages.length - sent.length
  const words = sent.reduce((n, p) => n + countWords(p.anchor), 0)
  const num = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  const plural = (n: number) => (n === 1 ? 'one' : 'other')

  const run = () => {
    if (!sent.length || editor.isDestroyed) return
    // read anew: the page may have changed while the card was open
    onRun({ kind: 'redo', label: t('features.ai.redo.label'), code: 'REDO', instructions: text.trim(), rulesPageId: rules, passages: capturePassages(editor, ids) })
  }

  const usePreset = (p: RedoPreset) => {
    setText((cur) => (!cur.trim() ? p.text : cur.includes(p.text) ? cur : `${cur.trimEnd()}\n${p.text}`))
    requestAnimationFrame(() => areaRef.current?.focus())
  }

  const save = () => {
    if (presets.length >= PRESETS_MAX) return useUI.getState().toast({ message: t('features.ai.redo.full'), kind: 'error' })
    const p = addPreset(text)
    if (p) useUI.getState().toast({ message: t('features.ai.redo.saved', { name: p.name }), kind: 'success' })
  }

  return (
    <div className="redo-setup" data-testid="redo-setup">
      <div className="redo-setup__head label">
        <span className="led led--on" aria-hidden />
        <span className="redo-setup__count">
          {t('features.ai.redo.head')} · {t(`features.ai.redo.passages.${plural(sent.length)}`, { count: num(sent.length) })} · {t(`features.ai.reads.words.${plural(words)}`, { count: num(words) })}
          {skipped > 0 && <> · {t(`features.ai.redo.skipped.${plural(skipped)}`, { count: num(skipped) })}</>}
        </span>
        <button type="button" className="redo-setup__repick" onClick={onRepick}>
          {t('features.ai.redo.repick')}
        </button>
      </div>

      <label className="redo-setup__label label" htmlFor="redo-instructions">
        {t('features.ai.redo.instructions')}
      </label>
      <textarea
        id="redo-instructions"
        ref={areaRef}
        className="redo-setup__text"
        data-autofocus=""
        rows={3}
        value={text}
        placeholder={t('features.ai.redo.placeholder')}
        onChange={(e) => {
          const v = e.target.value
          const caret = e.target.selectionStart
          // "@" at a word start: the rules page (the "@" itself does not stay)
          if (v.length === text.length + 1 && v[caret - 1] === '@' && (caret === 1 || /\s/.test(v[caret - 2]))) {
            setText(v.slice(0, caret - 1) + v.slice(caret))
            setPickRules(true)
            return
          }
          setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            run()
          }
        }}
      />

      <div className="redo-presets" role="group" aria-label={t('features.ai.redo.presets')}>
        {presets.map((p) =>
          renaming === p.id ? (
            <input
              key={p.id}
              className="redo-preset__input"
              aria-label={t('features.ai.redo.presetName')}
              defaultValue={p.name}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  renamePreset(p.id, e.currentTarget.value)
                  setRenaming(null)
                  requestAnimationFrame(() => areaRef.current?.focus())
                }
              }}
              onFocus={() => (renameOff.current = false)}
              onBlur={(e) => {
                if (!renameOff.current) renamePreset(p.id, e.currentTarget.value)
                setRenaming(null)
              }}
            />
          ) : (
            <PresetChip key={p.id} preset={p} onUse={() => usePreset(p)} onRename={() => setRenaming(p.id)} onDelete={() => deletePreset(p.id)} />
          ),
        )}
        <button type="button" className="redo-preset redo-preset--add" onClick={save} disabled={!text.trim()}>
          <Plus size={11} strokeWidth={2} aria-hidden /> {t('features.ai.redo.save')}
        </button>
      </div>

      <div className="redo-rules">
        <span className="label">{t('features.ai.redo.rules')}</span>
        {rules ? (
          <span className="redo-rules__chip">
            <BookMarked size={12} strokeWidth={1.8} aria-hidden />
            <span className="redo-rules__title">{rulesTitle}</span>
            <button type="button" className="redo-rules__x" onClick={() => setRules(null)} aria-label={t('features.ai.redo.rulesRemove', { title: rulesTitle })}>
              <X size={11} strokeWidth={2} aria-hidden />
            </button>
          </span>
        ) : (
          <button type="button" ref={rulesBtn} className="redo-rules__pick" onClick={() => setPickRules(true)} title={t('features.ai.redo.rulesHint')}>
            @ {t('features.ai.redo.rulesPick')}
          </button>
        )}
        <span className="redo-rules__hint">{t('features.ai.redo.rulesHint')}</span>
      </div>
      <RulesPicker
        open={pickRules}
        anchor={rulesBtn.current ?? areaRef.current}
        onPick={(id) => {
          setRules(id)
          setPickRules(false)
          requestAnimationFrame(() => areaRef.current?.focus())
        }}
        onClose={() => {
          setPickRules(false)
          requestAnimationFrame(() => areaRef.current?.focus())
        }}
      />

      <div className="redo-setup__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={run} disabled={!sent.length} data-testid="redo-run">
          {t('features.ai.redo.run')} <Kbd>{shortcutLabel('Mod+Enter')}</Kbd>
        </button>
      </div>
    </div>
  )
}

/**
 * A popover inside the AI panel: Esc closes it, not the panel (the panel's own Esc listener sits on the
 * document — this one on the window comes first).
 */
function useEscapeFirst(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])
}

function PresetChip({ preset, onUse, onRename, onDelete }: { preset: RedoPreset; onUse: () => void; onRename: () => void; onDelete: () => void }) {
  const t = useT()
  const menu = useMenu()
  useEscapeFirst(menu.open, menu.close)
  const entries: MenuEntry[] = [
    { label: t('features.ai.redo.rename'), onSelect: onRename },
    { label: t('features.ai.redo.delete'), danger: true, onSelect: onDelete },
  ]
  return (
    <span className="redo-preset" data-testid="redo-preset">
      <button type="button" className="redo-preset__use" onClick={onUse} title={t('features.ai.redo.use', { text: preset.text })}>
        {preset.name}
      </button>
      <button type="button" className="redo-preset__more" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} aria-label={t('features.ai.redo.presetMenu', { name: preset.name })}>
        <MoreHorizontal size={12} strokeWidth={1.8} aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} width={180} />
    </span>
  )
}

/** A searchable list of pages for the rules page. */
function RulesPicker({ open, anchor, onPick, onClose }: { open: boolean; anchor: Element | null; onPick: (id: ID) => void; onClose: () => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  useEscapeFirst(open, onClose)
  const entries: MenuEntry[] = useMemo(() => {
    if (!open) return []
    return Object.values(pages)
      .filter((p) => !p.trashed && !p.databaseId && p.kind !== 'database' && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200)
      .map((p) => ({ id: p.id, label: p.title.trim() || t('common.untitled'), onSelect: () => onPick(p.id) }))
  }, [open, pages, t, onPick])
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} placement="bottom-start" style={{ width: 280 }}>
      <MenuList entries={entries} onClose={onClose} searchable searchPlaceholder={t('features.ai.redo.rulesSearch')} emptyLabel={t('editor.slash.empty')} />
    </Popover>
  )
}
