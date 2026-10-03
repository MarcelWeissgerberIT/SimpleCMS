/**
 * After pasting a URL on an empty line: keep as link, or turn into a bookmark / embed.
 * The keyboard stays in the editor — typing simply continues (and dismisses the offer),
 * ↑ ↓ pick an option, ↵ applies it (↵ on "Link" is a normal new line), Esc dismisses.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import { AudioLines, Bookmark, Film, Link2, MonitorPlay } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { detectProvider, embedSrc, PROVIDER_LABEL } from '../lib/embeds'
import { posAnchor } from './common'
import { mediaKindOfUrl, mediaNameFromUrl, safeMediaSrc } from '../schema/media'

interface Option {
  id: 'link' | 'bookmark' | 'embed' | 'video' | 'audio'
  label: string
  icon: ReactNode
  run: () => void
}

export function UrlPasteMenu({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const t = useT()
  const paste = useStore(bridge, (s) => s.urlPaste)
  const [active, setActive] = useState(0)
  const close = () => bridge.setState({ urlPaste: null })

  // any further edit (or moving the caret away) dismisses the offer
  useEffect(() => {
    if (!paste) return
    setActive(0)
    const onUpdate = () => close()
    const onSelection = () => editor.state.selection.from !== paste.to && close()
    const id = window.setTimeout(() => {
      editor.on('update', onUpdate)
      editor.on('selectionUpdate', onSelection)
    }, 0)
    return () => {
      window.clearTimeout(id)
      editor.off('update', onUpdate)
      editor.off('selectionUpdate', onSelection)
    }
  }, [paste, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  const anchor = useMemo(() => (paste ? posAnchor(editor, paste.to) : null), [paste, editor])
  const options = useMemo<Option[]>(() => {
    if (!paste) return []
    const { url, from, to } = paste
    const replace = (node: object) => {
      close()
      const $from = editor.state.doc.resolve(from)
      const onlyLink = $from.parent.textContent.trim() === url
      const range = onlyLink ? { from: $from.before(), to: $from.after() } : { from, to }
      editor.chain().focus().insertContentAt(range, node).run()
    }
    const provider = detectProvider(url)
    const out: Option[] = [{ id: 'link', label: t('editor.paste.link'), icon: <Link2 size={15} />, run: close }]
    // a direct link to a media file plays in a video / audio block
    const media = mediaKindOfUrl(url)
    const src = safeMediaSrc(url)
    if (media && src)
      out.push({
        id: media,
        label: t(`editor.paste.${media}`),
        icon: media === 'video' ? <Film size={15} /> : <AudioLines size={15} />,
        run: () => replace({ type: media, attrs: { src, name: mediaNameFromUrl(src) } }),
      })
    out.push({ id: 'bookmark', label: t('editor.paste.bookmark'), icon: <Bookmark size={15} />, run: () => replace({ type: 'bookmark', attrs: { url } }) })
    if (embedSrc(url, provider ?? 'web'))
      out.push({
        id: 'embed',
        label: provider ? t('editor.paste.embedProvider', { provider: PROVIDER_LABEL[provider] }) : t('editor.paste.embed'),
        icon: <MonitorPlay size={15} />,
        run: () => replace({ type: 'embed', attrs: { url, provider: provider ?? 'web' } }),
      })
    return out
  }, [paste, editor, t]) // eslint-disable-line react-hooks/exhaustive-deps

  // keys arrive from the editor (paste extension → bridge)
  useEffect(() => {
    bridge.keyHandlers.urlPaste = (e) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || !options.length) return false
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setActive((a) => (a + dir + options.length) % options.length)
        return true
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const opt = options[active]
        if (!opt || opt.id === 'link') {
          close()
          return false
        }
        opt.run()
        return true
      }
      return false
    }
    return () => {
      delete bridge.keyHandlers.urlPaste
    }
  }, [bridge, options, active]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={!!paste && !!anchor} anchor={anchor} onClose={close} placement="bottom-start" offset={6} autoFocus={false} style={{ width: 240 }} role="listbox" aria-label={t('editor.paste.title')}>
      <div className="paste-menu" onMouseDown={(e) => e.preventDefault()}>
        <div className="menu-section label">{t('editor.paste.title')}</div>
        {options.map((o, i) => (
          <div key={o.id} role="option" aria-selected={i === active} data-active={i === active} className="menu-item" onMouseMove={() => i !== active && setActive(i)} onClick={() => o.run()}>
            <span className="menu-item__icon">{o.icon}</span>
            <span className="menu-item__label">{o.label}</span>
            {i === active && <span className="menu-item__hint">↵</span>}
          </div>
        ))}
        <div className="menu-sep" />
        <div className="paste-menu__foot label">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
          </span>
          <span>
            <kbd className="kbd">esc</kbd> {t('editor.paste.dismiss')}
          </span>
        </div>
      </div>
    </Popover>
  )
}
