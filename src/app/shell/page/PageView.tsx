import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ImagePlus, SmilePlus, RotateCcw, Trash2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { isEffectivelyTrashed, usePage } from '../../store/selectors'
import { PageEditor } from '../../editor'
import { DatabaseView, RowProperties } from '../../database'
import { TemplateBanner } from '../../features'
import { PageIcon } from '../../ui/PageIcon'
import { IconPicker } from '../../ui/IconPicker'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import type { ID, Page, PageCover } from '../../store/types'
import { Cover } from './Cover'
import { GRADIENTS, coverAssetPath, loadCoverManifest } from './covers'
import { resolveAssetUrl } from '../../lib/files'
import { Backlinks } from './Backlinks'
import { SpecPlate } from './SpecPlate'
import { consumeTitleFocus } from '../lib/actions'
import { NotFound } from '../home/NotFound'
import { useReadOnly } from '../cloud/state'
import { MarginRail, railHasContent } from './MarginRail'
import { scrollHostOf } from './outline'
import { toggleMarginRail, useMarginRailOpen } from './railPref'
import './page.css'

export type PageVariant = 'main' | 'pane' | 'peek'

export function PageView({ pageId, variant }: { pageId: ID; variant: PageVariant }) {
  const page = usePage(pageId)
  if (!page) return <NotFound kind="page" />
  return <PageViewInner key={pageId} page={page} variant={variant} />
}

function PageViewInner({ page, variant }: { page: Page; variant: PageVariant }) {
  const trashed = useWorkspace((s) => isEffectivelyTrashed(s.pages, page.id))
  const editorRef = useRef<Editor | null>(null)
  const isDb = page.kind === 'database'
  const isRow = !!page.databaseId
  const locked = page.settings.locked
  // a viewer in a team workspace reads every page like a locked one
  const viewer = useReadOnly()
  const readOnly = locked || trashed || viewer
  const wide = page.settings.fullWidth || isDb

  const articleRef = useRef<HTMLElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const rail = useRail(articleRef, variant === 'main' && !wide)
  const railOpen = useMarginRailOpen()
  // an empty rail (no outline, no reminders) leaves the text centred; the first layout reads the
  // stored content, the rail reports the live document from then on
  const [railFilled, setRailFilled] = useState(() => variant === 'main' && !wide && railHasContent(page))
  const focusEditor = (where: 'start' | 'end') => {
    let ed = editorRef.current
    if (!ed || ed.isDestroyed) {
      // TipTap exposes the live instance on its root element (survives StrictMode re-creation)
      const dom = articleRef.current?.querySelector('.pv-content .ProseMirror') as (HTMLElement & { editor?: Editor }) | null
      ed = dom?.editor ?? null
    }
    if (ed && !ed.isDestroyed && ed.isEditable) ed.commands.focus(where)
  }

  return (
    <article
      ref={articleRef}
      className="pv"
      data-variant={variant}
      data-wide={wide || undefined}
      data-db={isDb || undefined}
      data-font={page.settings.font}
      data-small={page.settings.smallText || undefined}
      data-has-cover={page.cover ? true : undefined}
      data-locked={readOnly || undefined}
      data-rail={rail ? (railOpen && railFilled ? 'open' : 'closed') : undefined}
    >
      {trashed && <TrashBanner page={page} canEdit={!viewer} />}
      {!trashed && <TemplateBanner pageId={page.id} />}
      <Cover page={page} editable={!readOnly} />
      <header className="pv-head">
        <div className="pv-col">
          <PageHeaderControls page={page} readOnly={readOnly} />
          <PageTitle page={page} readOnly={readOnly} variant={variant} onEnter={() => focusEditor('start')} />
          {isRow && (
            <div className="pv-props">
              <RowProperties pageId={page.id} />
            </div>
          )}
        </div>
      </header>
      <div className="pv-body">
        <div className="pv-col pv-content">
          {isDb ? (
            <DatabaseView databaseId={page.id} />
          ) : (
            <PageEditor
              pageId={page.id}
              readOnly={readOnly}
              onReady={(ed) => {
                editorRef.current = ed
                setEditor(ed)
              }}
            />
          )}
        </div>
        {rail && <MarginRail page={page} editor={editor} onFill={setRailFilled} />}
        {!isDb && (
          <div
            className="pv-filler"
            aria-hidden
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget || readOnly) return
              e.preventDefault()
              focusEditor('end')
            }}
          />
        )}
      </div>
      <footer className="pv-foot">
        <div className="pv-col">
          <Backlinks pageId={page.id} />
          <SpecPlate page={page} />
        </div>
      </footer>
    </article>
  )
}

/* ---------------- margin rail ---------------- */

/** Width of the page column from which the margin rail shows (page.css sizes it). */
const RAIL_MIN = 1240

/**
 * Does this view get the margin rail? Only the main column of a document page, wide enough,
 * outside focus mode. Mod+. toggles it (per device) while it is available.
 */
function useRail(ref: React.RefObject<HTMLElement | null>, eligible: boolean): boolean {
  const focusMode = useUI((s) => s.focusMode)
  const [wideHost, setWideHost] = useState(false)
  const on = eligible && !focusMode
  // before paint: a wide page never flashes the narrow layout
  useLayoutEffect(() => {
    const host = on ? scrollHostOf(ref.current) : null
    if (!host) return setWideHost(false)
    const measure = () => setWideHost(host.clientWidth >= RAIL_MIN)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref, on])
  const rail = on && wideHost
  useEffect(() => {
    if (!rail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey) || e.key !== '.') return
      if (document.querySelector('.modal-scrim, .pal-scrim')) return
      e.preventDefault()
      toggleMarginRail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail])
  return rail
}

/* ---------------- icon + "add icon / add cover" row ---------------- */

function PageHeaderControls({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const t = useT()
  const [iconAnchor, setIconAnchor] = useState<Element | null>(null)
  const update = (patch: Partial<Page>) => useWorkspace.getState().updatePage(page.id, patch)
  return (
    <>
      {page.icon && (
        <button
          type="button"
          className="pv-icon"
          disabled={readOnly}
          aria-label={t('shell.page.changeIcon')}
          onClick={(e) => setIconAnchor(iconAnchor ? null : e.currentTarget)}
        >
          <PageIcon icon={page.icon} kind={page.kind} size={78} />
        </button>
      )}
      {!readOnly && (!page.icon || !page.cover) && (
        <div className="pv-adds">
          {!page.icon && (
            <button type="button" className="pv-add" onClick={(e) => setIconAnchor(e.currentTarget)}>
              <SmilePlus size={14} />
              {t('shell.page.addIcon')}
            </button>
          )}
          {!page.cover && (
            <button
              type="button"
              className="pv-add"
              onClick={() => {
                // one click gives a tasteful default (Notion-style); "Change cover" opens the picker
                void loadCoverManifest(resolveAssetUrl).then((list) => {
                  const pool: PageCover[] = [
                    ...list.map((c) => ({ type: 'image' as const, value: coverAssetPath(c), positionY: 50 })),
                    ...GRADIENTS.slice(0, 4).map((g) => ({ type: 'gradient' as const, value: g.value, positionY: 50 })),
                  ]
                  update({ cover: pool[Math.floor(Math.random() * pool.length)] })
                })
              }}
            >
              <ImagePlus size={14} />
              {t('shell.page.addCover')}
            </button>
          )}
        </div>
      )}
      <Popover open={!!iconAnchor} anchor={iconAnchor} onClose={() => setIconAnchor(null)} bare placement="bottom-start">
        <IconPicker
          symbols
          onSelect={(icon) => {
            update({ icon })
            setIconAnchor(null)
          }}
          onRemove={
            page.icon
              ? () => {
                  update({ icon: null })
                  setIconAnchor(null)
                }
              : undefined
          }
        />
      </Popover>
    </>
  )
}

/* ---------------- title ---------------- */

function PageTitle({ page, readOnly, variant, onEnter }: { page: Page; readOnly: boolean; variant: PageVariant; onEnter: () => void }) {
  const t = useT()
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(fit, [page.title, page.settings.font, page.settings.smallText])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // refit on width changes only, a frame later — fitting changes the height, and doing that
    // inside the observer callback would re-trigger it ("ResizeObserver loop" error)
    let lastW = el.clientWidth
    let raf = 0
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      if (w === lastW) return
      lastW = w
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
  useEffect(() => {
    if (variant === 'main' && consumeTitleFocus(page.id)) {
      requestAnimationFrame(() => ref.current?.focus())
    }
  }, [page.id, variant])

  // the title is the view's heading: h1 in the main column, level 2 in panes and the peek
  const Heading = variant === 'main' ? 'h1' : 'div'
  return (
    <Heading className="pv-titlewrap" {...(variant === 'main' ? {} : { role: 'heading', 'aria-level': 2 })}>
      <textarea
        ref={ref}
        className="pv-title"
        rows={1}
        value={page.title}
        readOnly={readOnly}
        placeholder={t('common.untitled')}
        aria-label={t('shell.page.title')}
        spellCheck={false}
        onChange={(e) => useWorkspace.getState().updatePage(page.id, { title: e.target.value.replace(/\n/g, ' ') })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          const el = e.currentTarget
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          } else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
    </Heading>
  )
}

/* ---------------- trash banner ---------------- */

function TrashBanner({ page, canEdit }: { page: Page; canEdit: boolean }) {
  const t = useT()
  const ws = useWorkspace.getState()
  // a child of a trashed page: restore the trashed ancestor
  const rootTrashed = (() => {
    let cur: Page | undefined = page
    const pages = ws.pages
    let top: Page = page
    while (cur) {
      if (cur.trashed) top = cur
      cur = cur.parentId ? pages[cur.parentId] : undefined
    }
    return top
  })()
  return (
    <div className="pv-trash" role="status">
      <span className="pv-trash__stripes" aria-hidden />
      <span className="pv-trash__text">{t('shell.page.inTrash')}</span>
      {canEdit && (
        <>
          <button type="button" className="btn btn--sm" onClick={() => ws.restorePage(rootTrashed.id)}>
            <RotateCcw size={13} />
            {t('shell.trash.restore')}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--danger"
            onClick={() =>
              useUI.getState().openModal({
                type: 'confirm',
                title: t('shell.trash.deleteForeverTitle'),
                body: t('shell.trash.deleteForeverBody'),
                danger: true,
                confirmLabel: t('shell.trash.deleteForever'),
                // the main column, panes and the peek all let go of the page (usePruneGoneViews)
                onConfirm: () => useWorkspace.getState().deletePagePermanently(rootTrashed.id),
              })
            }
          >
            <Trash2 size={13} />
            {t('shell.trash.deleteForever')}
          </button>
        </>
      )}
    </div>
  )
}

