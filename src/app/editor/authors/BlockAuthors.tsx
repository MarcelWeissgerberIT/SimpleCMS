import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { X } from 'lucide-react'
import type { ContentDocHandle } from '../../cloud'
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { Popover, pointAnchor } from '../../ui/Popover'
import { BLOCK_CHANGES, PAGE_AREA, isBlockChange, type BlockChange } from '../../../shared/blockChanges'
import { textOf, wordRuns } from '../../features/history/docDiff'
import { ReadOnlyDoc } from '../ReadOnlyDoc'
import { useBlockAuthors } from './preference'
import './authors.css'

const key = new PluginKey('oneBlockAuthors')
type Picked = { area: string; title: string; actor: string; name: string; anchor: ReturnType<typeof pointAnchor> }

export function BlockAuthors({ editor, handle, pageId }: { editor: Editor; handle: ContentDocHandle; pageId: string }) {
  const enabled = useBlockAuthors(s => s.enabled)
  const shared = useCloud(s => s.active.kind === 'cloud' && !!s.supports?.includes('block-authors:1'))
  const isPrivate = useWorkspace(s => !!s.pages[pageId]?.private)
  const people = useWorkspace(s => s.people)
  const user = useCloud(s => s.user)
  const lang = useLang()
  const t = useT()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [revision, setRevision] = useState(0)
  const [limit, setLimit] = useState(20)
  const on = enabled && shared && !isPrivate
  const changes = handle.doc.getMap<BlockChange>(BLOCK_CHANGES)
  const history = useMemo(() => [...changes.values()].filter(isBlockChange), [handle, revision])
  useEffect(() => {
    if (!on || editor.isDestroyed) return
    const stamps = handle.doc.getMap<{ actor: string; at: number }>('blockEditorsV1')
    const nameOf = (actor: string) => actor === '@unverified' ? '' :
      (actor === user?.id ? user.name : '') || people.find(p => p.id === actor)?.name || (actor === user?.id ? user.email.split('@')[0] : '')
    editor.registerPlugin(new Plugin({
      key,
      props: { decorations(state) {
        const areas = new Map<string, { pos: number; title: string; actors: Map<string, number> }>()
        let area = PAGE_AREA
        state.doc.forEach((node, pos) => {
          if (node.type.name === 'heading' && node.attrs.id) area = node.attrs.id
          let group = areas.get(area)
          if (!group) {
            group = { pos: node.type.name === 'heading' ? pos + node.nodeSize : pos, title: node.type.name === 'heading' ? node.textContent : t('shell.blockAuthors.area'), actors: new Map() }
            areas.set(area, group)
          }
          const stamp = stamps.get(node.attrs.id)
          if (stamp?.actor && nameOf(stamp.actor)) group.actors.set(stamp.actor, Math.max(group.actors.get(stamp.actor) ?? 0, stamp.at))
        })
        // Keep a contributor available even when someone else edited their block afterwards.
        for (const value of changes.values()) {
          if (!isBlockChange(value) || !nameOf(value.actor)) continue
          const group = areas.get(value.area)
          if (group) group.actors.set(value.actor, Math.max(group.actors.get(value.actor) ?? 0, value.at))
        }
        const decorations: Decoration[] = []
        for (const [area, group] of areas) {
          const authors = [...group.actors].map(([actor, at]) => ({ actor, at, name: nameOf(actor) })).sort((a, b) => a.name.localeCompare(b.name))
          if (!authors.length) continue
          decorations.push(Decoration.widget(group.pos, () => {
            const row = document.createElement('span')
            row.className = 'block-authors-row'
            row.contentEditable = 'false'
            for (const author of authors) {
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'block-author'
              button.textContent = author.name
              const time = new Date(author.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')
              button.title = `${t('shell.blockAuthors.open')}: ${author.name} · ${time}`
              button.setAttribute('aria-label', `${t('shell.blockAuthors.open')}: ${author.name}`)
              button.setAttribute('aria-haspopup', 'dialog')
              button.setAttribute('data-testid', 'block-author')
              button.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation()
                const rect = button.getBoundingClientRect()
                setLimit(20)
                setPicked({ area, title: group.title, actor: author.actor, name: author.name, anchor: pointAnchor(rect.left, rect.bottom) })
              })
              row.append(button)
            }
            return row
          }, { side: -1, key: `${area}:${authors.map(a => `${a.actor}:${a.at}:${a.name}`).join('|')}`, stopEvent: () => true, ignoreSelection: true }))
        }
        return DecorationSet.create(state.doc, decorations)
      } },
    }))
    const refresh = () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta('addToHistory', false))
    }
    let queued = false, alive = true
    const changed = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => { queued = false; if (alive) { setRevision(r => r + 1); refresh() } })
    }
    stamps.observe(changed)
    changes.observe(changed)
    setRevision(r => r + 1)
    refresh()
    return () => { alive = false; stamps.unobserve(changed); changes.unobserve(changed); if (!editor.isDestroyed) editor.unregisterPlugin(key) }
  }, [on, editor, handle, people, user, lang, t])
  useEffect(() => { if (!on) setPicked(null) }, [on])
  const groups = useMemo(() => {
    const byBlock = new Map<string, BlockChange[]>()
    for (const change of history.filter(c => c.actor === picked?.actor && c.area === picked?.area).sort((a, b) => a.from - b.from || a.seq - b.seq)) {
      const group = byBlock.get(change.block) ?? []
      group.push(change)
      byBlock.set(change.block, group)
    }
    return [...byBlock]
  }, [history, picked])
  if (!on) return null
  return <>
    <div className="block-authors-note" role="status">{t('shell.blockAuthors.note')}</div>
    <Popover open={!!picked} anchor={picked?.anchor ?? null} onClose={() => setPicked(null)} className="block-changes" role="dialog" aria-label={t('shell.blockAuthors.dialog')} placement="bottom-start" resizable="block-changes">
      {picked && <>
        <header className="block-changes__head">
          <div><span className="label">{t('shell.blockAuthors.dialog')}</span><h3>{picked.name}</h3><p>{picked.title}</p></div>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setPicked(null)}><X size={16} /></button>
        </header>
        <p className="block-changes__hint">{t('shell.blockAuthors.summary')}</p>
        {!groups.length && <p className="block-changes__empty">{t('shell.blockAuthors.noHistory')}</p>}
        {groups.slice(0, limit).map(([block, entries], index) => <section key={block} className="block-changes__group" data-testid="block-change-group">
          <div className="label">{t('shell.blockAuthors.part', { n: index + 1 })}</div>
          {entries.map(entry => <Change key={entry.id} entry={entry} />)}
        </section>)}
        {groups.length > limit && <button className="btn" onClick={() => setLimit(n => n + 20)}>{t('shell.blockAuthors.more', { n: groups.length - limit })}</button>}
      </>}
    </Popover>
  </>
}

/** Only changed text is shown. Context and formatting details stay folded in this ONE panel. */
function Change({ entry }: { entry: BlockChange }) {
  const t = useT()
  const lang = useLang()
  const [expanded, setExpanded] = useState(false)
  const before = textOf(entry.before)
  const after = textOf(entry.after)
  const runs = wordRuns(before, after).filter(run => run.op !== 'same')
  const unchanged = JSON.stringify(entry.before) === JSON.stringify(entry.after)
  return <div className="block-changes__entry">
    <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}</time>
    {runs.length ? <div className="block-changes__snippets">{runs.map((run, i) => run.op === 'del'
      ? <div key={i} data-change="removed"><span aria-hidden>− </span><del>{run.text}</del></div>
      : <div key={i} data-change="added"><span aria-hidden>+ </span><ins>{run.text}</ins></div>)}</div>
      : <p>{t(unchanged ? 'shell.blockAuthors.noNet' : 'shell.blockAuthors.format')}</p>}
    <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>{t('shell.blockAuthors.details')}</summary>
      {expanded && <div className="block-changes__comparison"><div><strong>{t('shell.blockAuthors.before')}</strong>{entry.before ? <ReadOnlyDoc content={{ type: 'doc', content: [entry.before] }} /> : <p>—</p>}</div>
        <div><strong>{t('shell.blockAuthors.after')}</strong>{entry.after ? <ReadOnlyDoc content={{ type: 'doc', content: [entry.after] }} /> : <p>—</p>}</div></div>}
    </details>
  </div>
}
