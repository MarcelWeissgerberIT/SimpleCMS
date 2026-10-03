import { useEffect, useMemo, useState } from 'react'
import { EmojiPicker } from 'frimousse'
import { Shuffle, Trash2 } from 'lucide-react'
import type { PageIcon } from '../store/types'
import { resolveAssetUrl } from '../lib/files'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useLang, useT } from '../i18n'
import { PageIcon as PageIconView, loadLucideIcons, useLucideIcons } from './PageIcon'
import './icon-picker.css'

export interface IconManifestEntry {
  name: string
  label: string
  label_de?: string
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

type Tab = 'emoji' | 'icons' | 'symbols'
const TAB_KEY = 'one.iconPickerTab'
const pick = <T,>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)]
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Emoji + "One icons" (generated) + optional symbols (lucide glyphs). Render inside a <Popover bare>.
 * `symbols`: offer lucide glyphs — only where the caller stores a full PageIcon (page icons).
 */
export function IconPicker({ onSelect, onRemove, symbols = false }: { onSelect: (icon: PageIcon) => void; onRemove?: () => void; symbols?: boolean }) {
  const t = useT()
  const lang = useLang()
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = safeLocalGet(TAB_KEY)
    return saved === 'icons' || (saved === 'symbols' && symbols) ? saved : 'emoji'
  })
  const setTab = (next: Tab) => {
    setTabState(next)
    safeLocalSet(TAB_KEY, next)
  }
  const icons = useIconManifest()
  const random = () => {
    if (tab === 'icons') {
      const i = pick(icons)
      if (i) onSelect({ type: 'asset', value: i.name })
    } else if (tab === 'symbols') {
      void loadLucideIcons().then((m) => onSelect({ type: 'lucide', value: pick(m.LUCIDE_ICONS)!.name }))
    } else onSelect({ type: 'emoji', value: pick(RANDOM)! })
  }
  const tabs: Array<[Tab, string]> = [
    ['emoji', t('ui.iconPicker.emoji')],
    ['icons', t('ui.iconPicker.icons')],
    ...(symbols ? ([['symbols', t('ui.iconPicker.symbols')]] as Array<[Tab, string]>) : []),
  ]
  return (
    <div className="icon-picker popover" style={{ padding: 0 }}>
      <div className="icon-picker__tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className="icon-picker__tab" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn icon-btn--sm" title={t('ui.iconPicker.random')} aria-label={t('ui.iconPicker.random')} onClick={random}>
          <Shuffle size={14} />
        </button>
        {onRemove && (
          <button type="button" className="icon-btn icon-btn--sm" title={t('common.remove')} aria-label={t('common.remove')} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {tab === 'emoji' && (
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
      )}
      {tab === 'icons' && <AssetGrid icons={icons} onSelect={onSelect} />}
      {tab === 'symbols' && <SymbolGrid onSelect={onSelect} />}
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT()
  return <input className="input emoji-picker__search" placeholder={t('common.search')} aria-label={t('common.search')} value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
}

/** The generated ceramic icons (public/assets/icons/manifest.json), searchable by label. */
function AssetGrid({ icons, onSelect }: { icons: IconManifestEntry[]; onSelect: (icon: PageIcon) => void }) {
  const t = useT()
  const lang = useLang()
  const [q, setQ] = useState('')
  const label = (i: IconManifestEntry) => (lang === 'de' && i.label_de ? i.label_de : i.label)
  const shown = useMemo(() => {
    const needle = norm(q.trim())
    return needle ? icons.filter((i) => norm(`${i.name} ${i.label} ${i.label_de ?? ''}`).includes(needle)) : icons
  }, [icons, q])
  return (
    <div className="icon-picker__pane">
      <SearchField value={q} onChange={setQ} />
      <div className="icon-picker__grid">
        {shown.map((i) => (
          <button key={i.name} type="button" className="icon-picker__asset" title={label(i)} aria-label={label(i)} onClick={() => onSelect({ type: 'asset', value: i.name })}>
            <img src={resolveAssetUrl(`assets/icons/${i.webp}`)} alt="" width={40} height={40} draggable={false} />
          </button>
        ))}
        {icons.length === 0 && <div className="emoji-picker__msg">{t('common.loading')}</div>}
        {icons.length > 0 && shown.length === 0 && <div className="emoji-picker__msg">{t('ui.iconPicker.none')}</div>}
      </div>
    </div>
  )
}

/** Lucide glyphs (a curated set, ui/lucideIcons.ts), searchable in English and German. */
function SymbolGrid({ onSelect }: { onSelect: (icon: PageIcon) => void }) {
  const t = useT()
  const lucide = useLucideIcons()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    if (!lucide) return []
    const needle = norm(q.trim())
    return needle ? lucide.LUCIDE_ICONS.filter((g) => norm(`${lucide.lucideWords(g.name)} ${g.de}`).includes(needle)) : lucide.LUCIDE_ICONS
  }, [lucide, q])
  return (
    <div className="icon-picker__pane">
      <SearchField value={q} onChange={setQ} />
      <div className="icon-picker__grid icon-picker__grid--symbols">
        {shown.map((g) => {
          const name = lucide!.lucideWords(g.name)
          return (
            <button key={g.name} type="button" className="icon-picker__symbol" title={name} aria-label={name} onClick={() => onSelect({ type: 'lucide', value: g.name })}>
              <PageIconView icon={{ type: 'lucide', value: g.name }} size={18} />
            </button>
          )
        })}
        {!lucide && <div className="emoji-picker__msg">{t('common.loading')}</div>}
        {lucide && shown.length === 0 && <div className="emoji-picker__msg">{t('ui.iconPicker.none')}</div>}
      </div>
    </div>
  )
}
