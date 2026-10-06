/** Hover card for links in the text: shows the target and offers Edit / Copy / Remove. */
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Copy, ExternalLink, FileText, Pencil, Unlink } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import { toast } from '../../store/ui'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { domainOf } from '../lib/embeds'
import { isForeignRelative, resolveForeign } from '../../lib/foreignLinks'

const SHOW_DELAY = 450
const HIDE_DELAY = 250

export function LinkHover({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null)
  const showTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const dom = editor.view.dom
    const over = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !dom.contains(a) || a.closest('[data-node-view-wrapper]')) return
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(showTimer.current)
      showTimer.current = window.setTimeout(() => setAnchor(a), SHOW_DELAY)
    }
    const out = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href]')
      if (!a) return
      window.clearTimeout(showTimer.current)
      hideTimer.current = window.setTimeout(() => setAnchor(null), HIDE_DELAY)
    }
    const hideNow = () => {
      window.clearTimeout(showTimer.current)
      setAnchor(null)
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mouseout', out)
    dom.addEventListener('keydown', hideNow)
    dom.addEventListener('mousedown', hideNow)
    return () => {
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mouseout', out)
      dom.removeEventListener('keydown', hideNow)
      dom.removeEventListener('mousedown', hideNow)
      window.clearTimeout(showTimer.current)
      window.clearTimeout(hideTimer.current)
    }
  }, [editor])

  if (!anchor || !anchor.isConnected) return null
  const raw = anchor.getAttribute('href') ?? ''
  const pageId = raw.match(/^#\/p\/([\w-]+)/)?.[1]
  // a relative link Claude copied from an MCP server ("/r/11900") belongs to that server, not to One
  const foreign = !pageId && isForeignRelative(raw)
  const href = foreign ? (resolveForeign(raw) ?? raw) : raw
  const page = pageId ? useWorkspace.getState().pages[pageId] : undefined

  const selectLink = () => {
    try {
      const pos = editor.view.posAtDOM(anchor, 0)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
      editor.chain().focus().extendMarkRange('link').run()
      return true
    } catch {
      return false
    }
  }
  const close = () => setAnchor(null)
  return (
    <Popover open anchor={anchor} onClose={close} placement="bottom-start" offset={6} autoFocus={false} bare className="link-hover">
      <div
        className="link-hover__card"
        onMouseEnter={() => window.clearTimeout(hideTimer.current)}
        onMouseLeave={() => (hideTimer.current = window.setTimeout(close, HIDE_DELAY))}
        onMouseDown={(e) => e.preventDefault()}
      >
        <a className="link-hover__target" href={href} target={pageId ? undefined : '_blank'} rel="noopener noreferrer">
          {pageId ? <FileText size={13} /> : <ExternalLink size={13} />}
          <span>{pageId ? pageTitle(page, t('common.untitled')) : domainOf(href)}</span>
          {!pageId && <span className="link-hover__path">{href.replace(/^https?:\/\/(www\.)?[^/]+/, '')}</span>}
        </a>
        <span className="link-hover__sep" />
        <button type="button" className="icon-btn icon-btn--sm" title={t('common.edit')} onClick={() => selectLink() && (close(), bridge.setState({ linkEdit: true }))}>
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          title={t('common.copyLink')}
          onClick={async () => {
            const full = pageId ? `${location.origin}${location.pathname}${href}` : href
            try {
              await navigator.clipboard.writeText(full)
              toast({ message: t('common.copied'), kind: 'success' })
            } catch {
              toast(full)
            }
            close()
          }}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          title={t('editor.link.remove')}
          onClick={() => {
            if (selectLink()) editor.chain().unsetLink().run()
            close()
          }}
        >
          <Unlink size={13} />
        </button>
      </div>
    </Popover>
  )
}
