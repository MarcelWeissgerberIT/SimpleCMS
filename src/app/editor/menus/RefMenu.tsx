/**
 * "one:" menu: a reference to another page or entry — those on the same level as this page first (same parent or
 * database), then those inside it, then a title search over every page and entry. Picking one inserts a page
 * mention (like "@"); a private page's title never travels inside it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { useStore } from 'zustand'
import Fuse from 'fuse.js'
import { exitSuggestion } from '@tiptap/suggestion'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle, templateScope } from '../../store/selectors'
import type { Page } from '../../store/types'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { SUGGEST_KEYS, type SuggestRun } from '../extensions/suggest'
import { liveIds } from '../lib/livePages'
import { useScrollActive, useSuggestAnchor, useSuggestKeys } from './common'

type Section = 'level' | 'inside' | 'search'

interface Row {
  key: string
  section: Section
  page: Page
  hint?: string
}

const PER_SECTION = 6

export function RefMenu({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const suggest = useStore(bridge, (s) => (s.suggest?.kind === 'ref' ? s.suggest : null))
  const anchor = useSuggestAnchor(editor, suggest)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const query = suggest?.query.trim() ?? ''
  const open = !!suggest
  const live = useMemo(() => (open ? liveIds(useWorkspace.getState().pages) : null), [open])

  const rows = useMemo<Row[]>(() => {
    if (!open) return []
    const { pages } = useWorkspace.getState()
    const here = pages[pageId]
    const scope = templateScope(pages, pageId)
    const candidates = Object.values(pages).filter((p) => !!live?.has(p.id) && p.id !== pageId && scope(p.id))
    const parentOf = (p: Page) => (p.parentId ? pages[p.parentId] : null)
    const hintOf = (p: Page) => {
      const parent = parentOf(p)
      return parent ? pageTitle(parent, t('common.untitled')) : undefined
    }
    const byTitle = (list: Page[]) => (query ? new Fuse(list, { keys: ['title'], threshold: 0.38, ignoreLocation: true }).search(query).map((r) => r.item) : [...list].sort((a, b) => b.updatedAt - a.updatedAt))
    const level = byTitle(candidates.filter((p) => !!here && p.parentId === here.parentId)).slice(0, PER_SECTION)
    const inside = byTitle(candidates.filter((p) => p.parentId === pageId)).slice(0, PER_SECTION)
    const seen = new Set([...level, ...inside].map((p) => p.id))
    const search = query ? byTitle(candidates.filter((p) => !seen.has(p.id))).slice(0, PER_SECTION) : []
    return [
      ...level.map((page) => ({ key: `l-${page.id}`, section: 'level' as const, page })),
      ...inside.map((page) => ({ key: `i-${page.id}`, section: 'inside' as const, page })),
      ...search.map((page) => ({ key: `s-${page.id}`, section: 'search' as const, page, hint: hintOf(page) })),
    ]
  }, [open, live, query, pageId, t])

  useEffect(() => setActive(0), [rows])
  useScrollActive(listRef, active)

  const insert = (range: Range, p: Page) => {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        // a private page's title never travels inside a mention (docs/CLOUD.md § Private pages)
        { type: 'mention', attrs: { id: p.id, label: p.private ? '' : p.title, kind: 'page' } },
        { type: 'text', text: ' ' },
      ])
      .run()
    window.dispatchEvent(new CustomEvent('one:page-mentioned', { detail: { from: pageId, to: p.id } }))
  }
  const select = (i: number) => {
    const row = rows[i]
    if (row && suggest) suggest.command(((range: Range) => insert(range, row.page)) as SuggestRun)
  }
  useSuggestKeys(bridge, 'ref', { count: rows.length, active, setActive, onSelect: select })

  return (
    <Popover
      open={open && !!anchor}
      anchor={anchor}
      onClose={() => exitSuggestion(editor.view, SUGGEST_KEYS.ref)}
      placement="bottom-start"
      offset={6}
      autoFocus={false}
      className="suggest-menu"
      role="listbox"
    >
      <div ref={listRef} onMouseDown={(e) => e.preventDefault()} data-testid="ref-menu">
        {rows.length === 0 && <div className="menu-section faint">{t(query ? 'editor.slash.empty' : 'editor.ref.type')}</div>}
        {rows.map((r, i) => (
          <div key={r.key}>
            {(i === 0 || rows[i - 1].section !== r.section) && <div className="menu-section label">{t(`editor.ref.${r.section}`)}</div>}
            <div role="option" aria-selected={i === active} data-index={i} data-active={i === active} className="menu-item" onMouseMove={() => i !== active && setActive(i)} onClick={() => select(i)}>
              <span className="menu-item__icon">
                <PageIcon icon={r.page.icon} kind={r.page.kind} size={16} />
              </span>
              <span className="menu-item__label">{pageTitle(r.page, t('common.untitled'))}</span>
              {r.hint && <span className="menu-item__hint">{r.hint}</span>}
            </div>
          </div>
        ))}
      </div>
    </Popover>
  )
}
