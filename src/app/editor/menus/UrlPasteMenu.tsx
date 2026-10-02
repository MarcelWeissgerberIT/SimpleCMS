/** After pasting a URL on an empty line: keep as link, or turn into a bookmark / embed. */
import { useEffect, useMemo } from 'react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import { Bookmark, Link2, MonitorPlay, X } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { detectProvider, embedSrc, PROVIDER_LABEL } from '../lib/embeds'
import { posAnchor } from './common'

export function UrlPasteMenu({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const t = useT()
  const paste = useStore(bridge, (s) => s.urlPaste)
  const close = () => bridge.setState({ urlPaste: null })

  // any further edit dismisses the offer
  useEffect(() => {
    if (!paste) return
    const onUpdate = () => close()
    const id = window.setTimeout(() => editor.on('update', onUpdate), 0)
    return () => {
      window.clearTimeout(id)
      editor.off('update', onUpdate)
    }
  }, [paste, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  const anchor = useMemo(() => (paste ? posAnchor(editor, paste.to) : null), [paste, editor])
  const entries = useMemo<MenuEntry[]>(() => {
    if (!paste) return []
    const { url, from, to } = paste
    const replace = (node: object) => {
      const $from = editor.state.doc.resolve(from)
      const para = $from.parent
      const onlyLink = para.textContent.trim() === url
      const range = onlyLink ? { from: $from.before(), to: $from.after() } : { from, to }
      editor.chain().focus().insertContentAt(range, node).run()
    }
    const provider = detectProvider(url)
    const items: MenuEntry[] = [
      { kind: 'section', label: t('editor.paste.title') },
      { label: t('editor.paste.link'), icon: <Link2 size={15} />, onSelect: () => editor.commands.focus() },
      { label: t('editor.paste.bookmark'), icon: <Bookmark size={15} />, onSelect: () => replace({ type: 'bookmark', attrs: { url } }) },
    ]
    if (embedSrc(url, provider ?? 'web'))
      items.push({
        label: provider ? t('editor.paste.embedProvider', { provider: PROVIDER_LABEL[provider] }) : t('editor.paste.embed'),
        icon: <MonitorPlay size={15} />,
        onSelect: () => replace({ type: 'embed', attrs: { url, provider: provider ?? 'web' } }),
      })
    items.push({ kind: 'separator' }, { label: t('editor.paste.dismiss'), icon: <X size={15} />, hint: 'esc', onSelect: () => editor.commands.focus() })
    return items
  }, [paste, editor, t])

  return (
    <Popover open={!!paste && !!anchor} anchor={anchor} onClose={close} placement="bottom-start" offset={6} style={{ width: 240 }}>
      <MenuList entries={entries} onClose={close} />
    </Popover>
  )
}
