/** ":" emoji shortcode menu — a compact grid with the active shortcode spelled out in mono. */
import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import { exitSuggestion } from '@tiptap/suggestion'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { loadEmojis, searchEmojis, type EmojiEntry } from '../lib/emoji'
import { SUGGEST_KEYS, type SuggestRun } from '../extensions/suggest'
import { useSuggestAnchor, useSuggestKeys } from './common'

const COLS = 8

export function EmojiMenu({ editor, bridge }: { editor: Editor; bridge: Bridge }) {
  const t = useT()
  const suggest = useStore(bridge, (s) => (s.suggest?.kind === 'emoji' ? s.suggest : null))
  const anchor = useSuggestAnchor(editor, suggest)
  const [list, setList] = useState<EmojiEntry[] | null>(null)
  const [active, setActive] = useState(0)
  const open = !!suggest
  useEffect(() => {
    if (open && !list) void loadEmojis().then(setList)
  }, [open, list])
  const query = suggest?.query ?? ''
  const results = useMemo(() => (list ? searchEmojis(list, query, 32) : []), [list, query])
  useEffect(() => setActive(0), [query])

  const select = (i: number) => {
    const e = results[i]
    if (e && suggest) suggest.command(((range) => editor.chain().focus().insertContentAt(range, e.emoji).run()) as SuggestRun)
  }
  useSuggestKeys(bridge, 'emoji', { count: results.length, active, setActive, onSelect: select, columns: COLS })
  // nothing matches → let the user keep typing normally
  const visible = open && !!anchor && (!list || results.length > 0)
  const cur = results[active]
  return (
    <Popover
      open={visible}
      anchor={anchor}
      onClose={() => exitSuggestion(editor.view, SUGGEST_KEYS.emoji)}
      placement="bottom-start"
      offset={6}
      autoFocus={false}
      className="emoji-menu"
      role="listbox"
    >
      {!list ? (
        <div className="menu-section faint">{t('common.loading')}</div>
      ) : (
        <>
          <div className="emoji-menu__grid" onMouseDown={(e) => e.preventDefault()}>
            {results.map((e, i) => (
              <button
                key={e.name}
                type="button"
                role="option"
                aria-selected={i === active}
                className="emoji-menu__cell"
                title={`:${e.shortcodes[e.shortcodes.length - 1]}:`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => select(i)}
              >
                {e.emoji}
              </button>
            ))}
          </div>
          <div className="emoji-menu__foot">
            <span className="emoji-menu__big">{cur?.emoji}</span>
            <span className="mono">:{cur ? cur.shortcodes[cur.shortcodes.length - 1] : query}:</span>
          </div>
        </>
      )}
    </Popover>
  )
}
