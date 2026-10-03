/**
 * Emoji picker panel (the /emoji popover): the full emoji set via frimousse — search field focused,
 * categories, skin tone, and the emoji used last on this device as the first category.
 * Searching shows one ranked list instead of frimousse's per-category results, so the best match
 * comes first ("rocket" → 🚀, not 🧑‍🚀); German search also finds the English names.
 * Keyboard: type to search, arrows move, ↵ picks; Esc is the popover's.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { EmojiPicker, defaultEmojiDataResolver, useSkinTone, type EmojiData, type EmojiDataResolver, type SkinTone } from 'frimousse'
import { resolveAssetUrl } from '../../lib/files'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useLang, useT } from '../../i18n'

const RECENT_KEY = 'one.emojiRecent'
const TONE_KEY = 'one.emojiSkinTone'
const RECENT_MAX = 16
/** Category index of "Recent" (emojibase groups are 0–9). */
const RECENT = -1
const TONES: SkinTone[] = ['none', 'light', 'medium-light', 'medium', 'medium-dark', 'dark']
const COLS = 8
const MAX_RESULTS = 240
const EMOJIBASE = () => resolveAssetUrl('vendor/emojibase-data')
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

type EmojiEntry = EmojiData['emojis'][number]

function readRecent(): string[] {
  try {
    const list = JSON.parse(safeLocalGet(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Remember an emoji as used last on this device. */
export function pushRecentEmoji(emoji: string) {
  safeLocalSet(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX)))
}

/** Every spelling of an emoji (skin tones included) → its entry. */
function indexByEmoji(emojis: EmojiEntry[]): Map<string, EmojiEntry> {
  const map = new Map<string, EmojiEntry>()
  for (const e of emojis) {
    map.set(e.emoji, e)
    for (const s of Object.values(e.skins ?? {})) map.set(s, e)
  }
  return map
}

/** Emojibase data with the recent emoji as an extra first category. */
function withRecent(recent: string[], label: string): EmojiDataResolver {
  return async (locale, options) => {
    const data = await defaultEmojiDataResolver(locale, options)
    if (!recent.length) return data
    const byEmoji = indexByEmoji(data.emojis)
    const picks = [...new Set(recent.map((r) => byEmoji.get(r)).filter((e) => !!e))].map((e) => ({ ...e!, category: RECENT }))
    if (!picks.length) return data
    return { ...data, categories: [{ index: RECENT, label }, ...data.categories], emojis: [...picks, ...data.emojis] }
  }
}

interface SearchEntry {
  entry: EmojiEntry
  label: string
  words: string[]
  text: string
}

/** The emoji list to search: the UI language, plus the English names when that is German. */
function useSearchList(lang: string): SearchEntry[] | null {
  const [list, setList] = useState<SearchEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    const opts = { emojibaseUrl: EMOJIBASE() }
    const load = (l: string) => Promise.resolve(defaultEmojiDataResolver(l, opts))
    Promise.all([load(lang), lang === 'en' ? null : load('en').catch(() => null)])
      .then(([data, en]) => {
        if (!alive) return
        const english = en ? new Map(en.emojis.map((e) => [e.emoji, e])) : null
        setList(
          data.emojis.map((entry) => {
            const other = english?.get(entry.emoji)
            const label = norm(entry.label)
            const words = [...entry.tags, ...(other ? [other.label, ...other.tags] : [])].map(norm)
            return { entry, label, words, text: `${label} ${words.join(' ')}` }
          }),
        )
      })
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [lang])
  return list
}

/**
 * Best first: label = query → a label word = query → label prefix → a label word prefix → a tag →
 * a tag prefix → anywhere. Ties: recent ones, then the shorter label ("red heart" before "heart with arrow").
 */
function rankEmoji(list: SearchEntry[], query: string, recent: string[]): EmojiEntry[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const q = words[0]
  const scored: Array<{ e: EmojiEntry; s: number; r: number; n: number; i: number }> = []
  list.forEach((x, i) => {
    if (!words.every((w) => x.text.includes(w))) return
    const parts = x.label.split(/[\s:-]+/)
    const s =
      x.label === q
        ? 0
        : parts.includes(q)
          ? 1
          : x.label.startsWith(q)
            ? 2
            : parts.some((w) => w.startsWith(q))
              ? 3
              : x.words.includes(q)
                ? 4
                : x.words.some((w) => w.startsWith(q))
                  ? 5
                  : 6
    const r = recent.indexOf(x.entry.emoji)
    scored.push({ e: x.entry, s, r: r < 0 ? RECENT_MAX : r, n: x.label.length, i })
  })
  return scored
    .sort((a, b) => a.s - b.s || a.r - b.r || a.n - b.n || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map((x) => x.e)
}

/** Keeps the chosen skin tone for the next time (frimousse holds it while the picker is open). */
function RememberTone() {
  const [tone] = useSkinTone()
  useEffect(() => {
    safeLocalSet(TONE_KEY, tone === 'none' ? null : tone)
  }, [tone])
  return null
}

export function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useT()
  const lang = useLang()
  // read once per opening: recent emoji, skin tone
  const recent = useMemo(readRecent, [])
  const resolver = useMemo(() => withRecent(recent, t('editor.emojiPicker.recent')), []) // eslint-disable-line react-hooks/exhaustive-deps
  const tone = useMemo<SkinTone>(() => {
    const saved = safeLocalGet(TONE_KEY) as SkinTone | null
    return saved && TONES.includes(saved) ? saved : 'none'
  }, [])
  const pick = (emoji: string) => {
    pushRecentEmoji(emoji)
    onPick(emoji)
  }
  return (
    <EmojiPicker.Root
      className="ipk ipk--emoji"
      locale={lang}
      columns={COLS}
      skinTone={tone}
      emojibaseUrl={EMOJIBASE()}
      resolveEmojiData={resolver}
      onEmojiSelect={({ emoji }) => pick(emoji)}
    >
      <RememberTone />
      <EmojiBody recent={recent} onPick={pick} />
    </EmojiPicker.Root>
  )
}

function EmojiBody({ recent, onPick }: { recent: string[]; onPick: (emoji: string) => void }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const [tone] = useSkinTone()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useSearchList(lang)
  const gridRef = useRef<HTMLDivElement>(null)
  const searching = !!query.trim()
  const results = useMemo(() => (searching && list ? rankEmoji(list, query, recent) : []), [searching, list, query, recent])
  const shown = (e: EmojiEntry) => (tone !== 'none' && e.skins?.[tone]) || e.emoji
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // while searching the arrows and ↵ are ours (preventDefault keeps frimousse's handler out)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!searching || e.nativeEvent.isComposing) return
    const n = results.length
    const move = (d: number) => {
      e.preventDefault()
      if (n) setActive((a) => Math.min(n - 1, Math.max(0, a + d)))
    }
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(COLS)
    else if (e.key === 'ArrowUp') move(-COLS)
    else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) onPick(shown(hit))
    }
  }

  const cur = results[active]
  return (
    <>
      <div className="ipk__head">
        <span className="ipk__title label">{t('editor.emojiPicker.title')}</span>
        <span style={{ flex: 1 }} />
        <EmojiPicker.SkinToneSelector className="icon-btn icon-btn--sm ipk__tone" aria-label={t('editor.emojiPicker.skinTone')} title={t('editor.emojiPicker.skinTone')} />
      </div>
      <div className="ipk__search">
        <EmojiPicker.Search
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('editor.emojiPicker.search')}
          aria-label={t('editor.emojiPicker.search')}
          aria-controls={searching ? `${uid}-results` : undefined}
          aria-activedescendant={searching && cur ? `${uid}-${active}` : undefined}
          data-autofocus=""
          autoFocus
        />
      </div>
      <EmojiPicker.Viewport className="ipk-emoji__viewport" hidden={searching}>
        <EmojiPicker.Loading className="ipk__msg">{t('common.loading')}</EmojiPicker.Loading>
        <EmojiPicker.Empty className="ipk__msg">{t('editor.emojiPicker.empty')}</EmojiPicker.Empty>
        <EmojiPicker.List
          className="ipk-emoji__list"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div className="ipk-emoji__category label" {...props}>
                {category.label}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button className="ipk-emoji__emoji" {...props}>
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
      {searching && (
        <div ref={gridRef} id={`${uid}-results`} role="listbox" aria-label={t('editor.emojiPicker.title')} className="ipk-emoji__results" onMouseDown={(e) => e.preventDefault()}>
          {results.map((e, i) => (
            <div
              key={e.emoji}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={e.label}
              title={e.label}
              data-index={i}
              className="ipk-emoji__emoji"
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => onPick(shown(e))}
            >
              {shown(e)}
            </div>
          ))}
          {!list && <div className="ipk__msg">{t('common.loading')}</div>}
          {list && results.length === 0 && <div className="ipk__msg">{t('editor.emojiPicker.empty')}</div>}
        </div>
      )}
      {searching ? (
        <div className="ipk__foot" aria-hidden>
          <span className="ipk__preview ipk__preview--emoji">{cur ? shown(cur) : ''}</span>
          <span className="ipk__name">{cur?.label ?? '—'}</span>
          <kbd className="kbd">↵</kbd>
        </div>
      ) : (
        <EmojiPicker.ActiveEmoji>
          {({ emoji }) => (
            <div className="ipk__foot" aria-hidden>
              {emoji ? (
                <>
                  <span className="ipk__preview ipk__preview--emoji">{emoji.emoji}</span>
                  <span className="ipk__name">{emoji.label}</span>
                </>
              ) : (
                <span className="ipk__name ipk__hint">{t('editor.iconPicker.hint')}</span>
              )}
              <kbd className="kbd">↵</kbd>
            </div>
          )}
        </EmojiPicker.ActiveEmoji>
      )}
    </>
  )
}
