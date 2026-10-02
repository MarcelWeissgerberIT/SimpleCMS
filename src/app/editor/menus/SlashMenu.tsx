/**
 * Slash menu — a spec sheet of blocks. Every row shows the Markdown shortcut in mono
 * (the teaching aid), the side panel shows the full spec of the active block.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useStore } from 'zustand'
import Fuse from 'fuse.js'
import { exitSuggestion } from '@tiptap/suggestion'
import { Popover } from '../../ui/Popover'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import type { Bridge } from '../lib/bridge'
import { BLOCKS, GROUPS, type BlockItem } from '../lib/catalog'
import { dismissPlusSlash, SUGGEST_KEYS, type SuggestRun } from '../extensions/suggest'
import { useScrollActive, useSuggestAnchor, useSuggestKeys } from './common'
import { DatabasePicker } from './DatabasePicker'

export function BlockGlyph({ item, size = 16 }: { item: BlockItem; size?: number }) {
  if (item.icon === 'AI') return <span className="ai-glyph">AI</span>
  const Icon = item.icon
  return <Icon size={size} strokeWidth={1.7} />
}

export function SlashMenu({ editor, bridge, pageId }: { editor: Editor; bridge: Bridge; pageId: string }) {
  const t = useT()
  const suggest = useStore(bridge, (s) => (s.suggest?.kind === 'slash' ? s.suggest : null))
  const plusOpened = useStore(bridge, (s) => s.plusOpened)
  const anchor = useSuggestAnchor(editor, suggest)
  const [active, setActive] = useState(0)
  const [picker, setPicker] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const query = suggest?.query.trim().toLowerCase() ?? ''

  const entries = useMemo(
    () =>
      BLOCKS.map((item) => ({
        item,
        label: t(`editor.block.${item.id}`),
        desc: t(`editor.block.${item.id}.desc`),
        keywords: `${item.id} ${item.keywords} ${item.md ?? ''}`,
      })),
    [t],
  )
  const fuse = useMemo(
    () =>
      new Fuse(entries, {
        keys: [
          { name: 'label', weight: 3 },
          { name: 'keywords', weight: 2 },
        ],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [entries],
  )

  const results = useMemo(() => {
    if (!query) return entries
    // tiered ranking: label prefix → word prefix → substring → fuzzy; catalog order within a tier
    const words = (s: string) => s.toLowerCase().split(/[\s/-]+/)
    const tier = (e: (typeof entries)[number]) => {
      const label = e.label.toLowerCase()
      if (label.startsWith(query) || e.item.md === query) return 0
      if (words(label).some((w) => w.startsWith(query)) || words(e.keywords).some((w) => w.startsWith(query))) return 1
      if (label.includes(query) || e.keywords.toLowerCase().includes(query)) return 2
      return 9
    }
    const ranked = entries
      .map((e, i) => ({ e, i, t: tier(e) }))
      .filter((x) => x.t < 9)
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map((x) => x.e)
    return ranked.length ? ranked : fuse.search(query).map((r) => r.item)
  }, [entries, fuse, query])

  // grouped only when not searching
  const rows = useMemo(() => {
    if (query) return results.map((r) => ({ ...r, group: null as string | null }))
    const out: Array<(typeof results)[number] & { group: string | null }> = []
    for (const g of GROUPS) {
      const items = results.filter((r) => r.item.group === g)
      items.forEach((r, i) => out.push({ ...r, group: i === 0 ? g : null }))
    }
    return out
  }, [results, query])

  useEffect(() => setActive(0), [query, !!suggest]) // eslint-disable-line react-hooks/exhaustive-deps
  useScrollActive(listRef, active)

  // no results + trailing space → close like Notion
  useEffect(() => {
    if (suggest && rows.length === 0 && /\s{1,}$/.test(suggest.query) && suggest.query.trim().length > 0) exitSuggestion(editor.view, SUGGEST_KEYS.slash)
  }, [rows.length, suggest, editor])

  const run = (i: number) => {
    const row = rows[i]
    if (!row || !suggest) return
    if (row.item.id === 'dbLinked') {
      const pos = suggest.range.from
      suggest.command(((range) => {
        editor.chain().focus().deleteRange(range).run()
      }) as SuggestRun)
      setPicker(pos)
      return
    }
    suggest.command(((range) => row.item.run({ editor, pageId, range, bridge })) as SuggestRun)
  }

  useSuggestKeys(bridge, 'slash', { count: rows.length, active, setActive, onSelect: run })

  const current = rows[active]
  return (
    <>
      <Popover
        open={!!suggest && !!anchor}
        anchor={anchor}
        onClose={() => {
          if (suggest) dismissPlusSlash(editor.view, bridge, suggest.range)
          exitSuggestion(editor.view, SUGGEST_KEYS.slash)
        }}
        placement="bottom-start"
        offset={6}
        autoFocus={false}
        bare
        className="slash"
        role="listbox"
        aria-label={t('editor.slash.title')}
      >
        <div className="slash__head">
          <span className="slash__prompt">/</span>
          <span className="slash__query">{suggest?.query}</span>
          <span className="slash__caret" />
          <span style={{ flex: 1 }} />
          <span className="label">{t('editor.slash.count', { count: rows.length })}</span>
        </div>
        <div className="slash__body">
          <div className="slash__list" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
            {rows.length === 0 && <div className="slash__empty">{t('editor.slash.empty')}</div>}
            {rows.map((r, i) => (
              <div key={r.item.id}>
                {r.group && (
                  <div className="slash__group label">
                    <span>{String(GROUPS.indexOf(r.item.group) + 1).padStart(2, '0')}</span> {t(`editor.group.${r.group}`)}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className="slash__item"
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(i)}
                >
                  <span className="slash__icon">
                    <BlockGlyph item={r.item} />
                  </span>
                  <span className="slash__name">{r.label}</span>
                  {r.item.md && <span className="slash__md">{r.item.md}</span>}
                </div>
              </div>
            ))}
          </div>
          {current && (
            <aside className="slash__spec" aria-hidden>
              <div className="slash__spec-tile">
                <BlockGlyph item={current.item} size={26} />
              </div>
              <div className="slash__spec-name">{current.label}</div>
              <p className="slash__spec-desc">{current.desc}</p>
              <dl className="slash__spec-table">
                <div>
                  <dt className="label">{t('editor.slash.markdown')}</dt>
                  <dd>{current.item.md ? <kbd className="kbd">{current.item.md === '␣' ? t('editor.slash.space') : `${current.item.md}${current.item.md.length < 4 && current.item.group !== 'inline' ? ' ␣' : ''}`}</kbd> : <span className="faint">—</span>}</dd>
                </div>
                <div>
                  <dt className="label">{t('editor.slash.keys')}</dt>
                  <dd>{current.item.keys ? <kbd className="kbd">{shortcutLabel(current.item.keys)}</kbd> : <span className="faint">—</span>}</dd>
                </div>
                <div>
                  <dt className="label">{t('editor.slash.group')}</dt>
                  <dd className="mono">{t(`editor.group.${current.item.group}`)}</dd>
                </div>
              </dl>
            </aside>
          )}
        </div>
        <div className="slash__foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> {t('editor.slash.navigate')}
          </span>
          <span>
            <kbd className="kbd">↵</kbd> {t('editor.slash.insert')}
          </span>
          <span>
            <kbd className="kbd">esc</kbd> {plusOpened ? t('editor.slash.dismiss') : t('common.close')}
          </span>
        </div>
      </Popover>
      {picker !== null && <DatabasePicker editor={editor} pos={picker} onClose={() => setPicker(null)} />}
    </>
  )
}
