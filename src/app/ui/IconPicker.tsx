import { useEffect, useState } from 'react'
import { EmojiPicker } from 'frimousse'
import { Shuffle, Trash2 } from 'lucide-react'
import type { PageIcon } from '../store/types'
import { resolveAssetUrl } from '../lib/files'
import { useLang, useT } from '../i18n'
import './icon-picker.css'

export interface IconManifestEntry {
  name: string
  label: string
  webp: string
}

let manifestPromise: Promise<IconManifestEntry[]> | null = null
export function loadIconManifest(): Promise<IconManifestEntry[]> {
  manifestPromise ??= fetch(resolveAssetUrl('assets/icons/manifest.json'))
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  return manifestPromise
}

export function useIconManifest(): IconManifestEntry[] {
  const [list, setList] = useState<IconManifestEntry[]>([])
  useEffect(() => {
    loadIconManifest().then(setList)
  }, [])
  return list
}

const RANDOM = ['📘', '🧭', '🚀', '🧪', '📌', '🗂️', '🛠️', '🎯', '📈', '🧠', '💡', '🗓️', '✍️', '📦', '🏁']

/** Emoji + "One icons" picker. Render inside a <Popover bare>. */
export function IconPicker({ onSelect, onRemove }: { onSelect: (icon: PageIcon) => void; onRemove?: () => void }) {
  const t = useT()
  const lang = useLang()
  const [tab, setTab] = useState<'emoji' | 'icons'>('emoji')
  const icons = useIconManifest()
  return (
    <div className="icon-picker popover" style={{ padding: 0 }}>
      <div className="icon-picker__tabs">
        <button className="icon-picker__tab" aria-pressed={tab === 'emoji'} onClick={() => setTab('emoji')}>
          Emoji
        </button>
        <button className="icon-picker__tab" aria-pressed={tab === 'icons'} onClick={() => setTab('icons')}>
          {t('ui.iconPicker.icons')}
        </button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn icon-btn--sm" title={t('ui.iconPicker.random')} onClick={() => onSelect({ type: 'emoji', value: RANDOM[Math.floor(Math.random() * RANDOM.length)] })}>
          <Shuffle size={14} />
        </button>
        {onRemove && (
          <button className="icon-btn icon-btn--sm" title={t('common.remove')} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {tab === 'emoji' ? (
        <EmojiPicker.Root
          className="emoji-picker"
          locale={lang}
          columns={9}
          emojibaseUrl={resolveAssetUrl('vendor/emojibase-data')}
          onEmojiSelect={({ emoji }) => onSelect({ type: 'emoji', value: emoji })}
        >
          <EmojiPicker.Search className="input emoji-picker__search" placeholder={t('common.search')} autoFocus />
          <EmojiPicker.Viewport className="emoji-picker__viewport">
            <EmojiPicker.Loading className="emoji-picker__msg">{t('common.loading')}</EmojiPicker.Loading>
            <EmojiPicker.Empty className="emoji-picker__msg">{t('ui.iconPicker.none')}</EmojiPicker.Empty>
            <EmojiPicker.List
              className="emoji-picker__list"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div className="emoji-picker__category label" {...props}>
                    {category.label}
                  </div>
                ),
                Emoji: ({ emoji, ...props }) => (
                  <button className="emoji-picker__emoji" {...props}>
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      ) : (
        <div className="icon-picker__grid">
          {icons.map((i) => (
            <button key={i.name} className="icon-picker__asset" title={i.label} onClick={() => onSelect({ type: 'asset', value: i.name })}>
              <img src={resolveAssetUrl(`assets/icons/${i.webp}`)} alt={i.label} width={40} height={40} />
            </button>
          ))}
          {icons.length === 0 && <div className="emoji-picker__msg">{t('common.loading')}</div>}
        </div>
      )}
    </div>
  )
}
