/**
 * "Link to page": pick an EXISTING page and insert a `pageLink` block for it (the slash item
 * "/page" creates a new sub-page instead). Offers live pages only, template pages only from a page
 * of the same template (lib/livePages → templateScope), never the page itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import Fuse from 'fuse.js'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import type { Page } from '../../store/types'
import { useT } from '../../i18n'
import { insertBlock } from '../lib/blocks'
import { livePages } from '../lib/livePages'
import { posAnchor, useScrollActive } from './common'

const LIMIT = 40

export function PagePicker({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const t = useT()
  const anchor = useMemo(() => posAnchor(editor, pos), [editor, pos])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const self = editor.view.dom.getAttribute('data-page-id')

  // computed once per opening: live pages in scope (not this one), most recent first
  const candidates = useMemo(() => {
    const { pages, recent } = useWorkspace.getState()
    const rank = (p: Page) => {
      const r = recent.indexOf(p.id)
      return r < 0 ? 999 : r
    }
    return livePages(pages, self)
      .filter((p) => p.id !== self)
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
  }, [self])
  const fuse = useMemo(() => new Fuse(candidates, { keys: ['title'], threshold: 0.38, ignoreLocation: true }), [candidates])
  const results = useMemo(() => (query.trim() ? fuse.search(query.trim()).map((r) => r.item) : candidates).slice(0, LIMIT), [query, fuse, candidates])

  useEffect(() => setActive(0), [query])
  useScrollActive(listRef, active)

  const pick = (p: Page) => {
    onClose()
    insertBlock(editor, { type: 'pageLink', attrs: { pageId: p.id } })
    // database rows answer a link to a page with "link as relation?" (database PAGE_MENTIONED)
    if (self) window.dispatchEvent(new CustomEvent('one:page-mentioned', { detail: { from: self, to: p.id } }))
  }

  const close = () => {
    onClose()
    if (!editor.isDestroyed) editor.commands.focus()
  }

  const parentOf = (p: Page) => {
    const parent = p.parentId ? useWorkspace.getState().pages[p.parentId] : undefined
    return parent ? pageTitle(parent, t('common.untitled')) : ''
  }

  return (
    <Popover open anchor={anchor} onClose={close} placement="bottom-start" offset={6} className="page-picker" role="dialog" aria-label={t('editor.linkPage.title')}>
      <div className="page-picker__head">
        <span className="label">{t('editor.linkPage.title')}</span>
        <span className="label faint">{t('editor.linkPage.count', { count: results.length })}</span>
      </div>
      <div className="page-picker__search">
        <input
          className="input"
          autoFocus
          data-autofocus=""
          value={query}
          placeholder={t('editor.linkPage.search')}
          aria-label={t('editor.linkPage.search')}
          role="combobox"
          aria-expanded
          aria-controls="page-picker-list"
          aria-activedescendant={results[active] ? `page-picker-${results[active].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = Math.max(results.length, 1)
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const p = results[active]
              if (p) pick(p)
            }
          }}
        />
      </div>
      <div className="page-picker__list" role="listbox" id="page-picker-list" ref={listRef} aria-label={t('editor.linkPage.title')}>
        {results.length === 0 && <div className="menu-section faint">{candidates.length ? t('editor.slash.empty') : t('editor.linkPage.none')}</div>}
        {results.map((p, i) => {
          const parent = parentOf(p)
          return (
            <div
              key={p.id}
              id={`page-picker-${p.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              data-active={i === active}
              className="menu-item page-picker__item"
              onMouseMove={() => i !== active && setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <span className="menu-item__icon">
                <PageIcon icon={p.icon} kind={p.kind} size={16} />
              </span>
              <span className="menu-item__label">{pageTitle(p, t('common.untitled'))}</span>
              {parent && <span className="menu-item__hint page-picker__parent">{parent}</span>}
            </div>
          )
        })}
      </div>
    </Popover>
  )
}
