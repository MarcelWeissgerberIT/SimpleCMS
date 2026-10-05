/**
 * The page side of background AI runs (runs.ts): mounted once per editable editor (EditorOverlays).
 *  - takes over the page's runs that no live editor holds (a re-created editor checks the text again)
 *  - shows them: a calm plate at the foot of the page — LED + mono label ("AI · WRITING…" /
 *    "AI RESULT READY · VIEW", a count when there are several); it opens the AI panel on a run
 *  - opens the panel by itself when a toast's "Open" brought the user here
 * AIRunLed: the sidebar's LED for a page with a ready result nobody has looked at yet.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useShallow } from 'zustand/react/shallow'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { AIMenu } from './AIMenu'
import { adoptRuns, currentScope, ensureRunsLoaded, runsOf, takeOpenRequest, useAIRuns, type AIRun } from './runs'
import { endImageAsk, useImageAsk } from './image/actions'
import './runs.css'

export interface AIRunsHostProps {
  editor: Editor
  pageId: ID
}

type Shown = 'running' | 'ready' | 'error'

const shownOf = (r: AIRun): Shown => (r.status === 'running' ? 'running' : r.status === 'done' ? 'ready' : 'error')

export function AIRunsHost({ editor, pageId }: AIRunsHostProps) {
  const t = useT()
  const runs = useAIRuns(useShallow((s) => runsOf(s.runs, pageId)))
  const loaded = useAIRuns((s) => s.loaded)
  const openRequest = useAIRuns((s) => s.openRequest)
  /** the panel opened on a run (it follows its run itself: Retry and Revise start new ones) */
  const [opened, setOpened] = useState<{ id: string; mode: 'selection' | 'block' } | null>(null)
  const menu = useMenu()
  /** "Ask about the image" (image toolbar, block menu): the panel on that image, the prompt ready */
  const imageAsk = useImageAsk((s) => (s.req?.editor === editor ? s.req : null))

  useEffect(() => {
    void ensureRunsLoaded()
  }, [])

  // runs of this page that no live editor holds (saved ones, or the page was left meanwhile): this editor takes them
  useEffect(() => {
    if (runs.length) adoptRuns(editor, pageId)
  }, [editor, pageId, runs, loaded])

  // a toast's "Open" brought us here
  useEffect(() => {
    if (!openRequest) return
    const id = takeOpenRequest(pageId)
    if (id) requestAnimationFrame(() => openRun(id))
  }, [openRequest, pageId, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRun = (id: string) => {
    const run = useAIRuns.getState().runs[id]
    if (!run) return
    endImageAsk()
    setOpened({ id, mode: run.target.mode })
  }

  // a question about an image replaces the panel shown on a run
  useEffect(() => {
    if (imageAsk) setOpened(null)
  }, [imageAsk])

  const close = useCallback(() => {
    setOpened(null)
    // like the editor's own AI menu: the caret goes back, unless the close came from focusing something else
    requestAnimationFrame(() => {
      const el = document.activeElement
      if (useUI.getState().paletteOpen) return
      if (!editor.isDestroyed && (!el || el === document.body)) editor.view.focus()
    })
  }, [editor])

  const viewing = useAIRuns((s) => s.viewing)
  const shown = runs.filter((r) => !viewing.includes(r.id))
  // the plate speaks for the most useful run: a ready result first, then one at work, then a failed one
  const lead = shown.find((r) => shownOf(r) === 'ready') ?? shown.find((r) => shownOf(r) === 'running') ?? shown[shown.length - 1]
  const label = (r: AIRun) => {
    const s = shownOf(r)
    if (s === 'ready') return t('features.ai.bg.readyShort')
    if (s === 'running') return r.req.kind === 'todb' || r.req.kind === 'image' || r.req.kind === 'transform' ? t('features.ai.bg.reading') : t('features.ai.bg.writing')
    return r.status === 'interrupted' ? t('features.ai.bg.interruptedShort') : t('features.ai.bg.failed')
  }
  const entries: MenuEntry[] = shown
    .slice()
    .reverse()
    .map((r) => ({ id: r.id, label: `${r.req.label} — ${label(r)}`, onSelect: () => openRun(r.id) }))

  return (
    <>
      {lead && (
        <div className="ai-runs" data-testid="ai-runs">
          <button
            type="button"
            className="ai-runs__plate"
            data-state={shownOf(lead)}
            aria-haspopup={shown.length > 1 ? 'menu' : undefined}
            aria-label={`${label(lead)} · ${lead.req.label}${shown.length > 1 ? ` · ${t('features.ai.bg.runs', { n: shown.length })}` : ''}`}
            onClick={(e) => (shown.length > 1 ? menu.toggle(e) : openRun(lead.id))}
          >
            <span className={`led${shownOf(lead) === 'running' ? ' led--on ai-led--live' : shownOf(lead) === 'ready' ? ' led--on' : ' ai-led--err'}`} aria-hidden />
            <span className="ai-runs__label">{label(lead)}</span>
            <span className="ai-runs__what">{lead.req.label}</span>
            {shownOf(lead) !== 'running' && <span className="ai-runs__view">{t('features.ai.bg.view')}</span>}
            {shown.length > 1 && <span className="ai-runs__count">{shown.length}</span>}
          </button>
          <Menu {...menu.props} placement="top-start" entries={entries} />
        </div>
      )}
      {opened && <AIMenu key={opened.id} editor={editor} pageId={pageId} mode={opened.mode} runId={opened.id} onClose={close} />}
      {imageAsk && !opened && (
        <AIMenu
          key={`image-ask:${imageAsk.n}`}
          editor={editor}
          pageId={pageId}
          mode="selection"
          onClose={() => {
            endImageAsk()
            close()
          }}
        />
      )}
    </>
  )
}

/** The sidebar's LED: this page has a finished AI result nobody has looked at yet. */
export function AIRunLed({ pageId }: { pageId: ID }) {
  const t = useT()
  useEffect(() => {
    void ensureRunsLoaded()
  }, [])
  const ready = useAIRuns((s) => {
    const scope = currentScope()
    for (const r of Object.values(s.runs)) if (r.pageId === pageId && r.scope === scope && r.status === 'done' && !r.seen) return true
    return false
  })
  if (!ready) return null
  return <span className="led led--on ai-run-led" role="img" aria-label={t('features.ai.bg.led')} title={t('features.ai.bg.led')} data-testid="ai-run-led" />
}
