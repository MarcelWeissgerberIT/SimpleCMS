import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ContentDocHandle } from '../../cloud'
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { useBlockAuthors } from './preference'
import './authors.css'

const key = new PluginKey('oneBlockAuthors')

export function BlockAuthors({ editor, handle }: { editor: Editor; handle: ContentDocHandle }) {
  const enabled = useBlockAuthors(s => s.enabled)
  const people = useWorkspace(s => s.people)
  const user = useCloud(s => s.user)
  const lang = useLang()
  const t = useT()
  useEffect(() => {
    if (!enabled || editor.isDestroyed) return
    const stamps = handle.doc.getMap<{ actor: string; at: number }>('blockEditorsV1')
    editor.registerPlugin(new Plugin({
      key,
      props: { decorations(state) {
        const decorations: Decoration[] = []
        state.doc.forEach((node, pos) => {
          if (!node.attrs.id) return
          const stamp = stamps.get(node.attrs.id)
          const actor = stamp && typeof stamp.actor === 'string' ? stamp.actor : ''
          const known = actor && actor !== '@unverified'
          const name = (actor === user?.id ? user.name : '') || people.find(p => p.id === actor)?.name || (actor === user?.id ? user.email.split('@')[0] : '')
          // No placeholder or widget spacing when the editor cannot be identified.
          if (!known || !name?.trim()) return
          const label = name
          const time = stamp && Number.isFinite(stamp.at) ? new Date(stamp.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB') : ''
          decorations.push(Decoration.widget(pos, () => {
            const plate = document.createElement('span')
            plate.className = 'block-author'
            plate.contentEditable = 'false'
            plate.tabIndex = 0
            plate.textContent = label
            plate.title = `${t('shell.blockAuthors.last')}: ${label}${time ? ` · ${time}` : ''}`
            plate.setAttribute('aria-label', plate.title)
            plate.setAttribute('data-testid', 'block-author')
            return plate
          }, { side: -1, key: `${node.attrs.id}:${actor}:${stamp?.at}:${label}` }))
        })
        return DecorationSet.create(state.doc, decorations)
      } },
    }))
    const refresh = () => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta('addToHistory', false)) }
    // Don't dispatch a PM transaction from inside the current Y sync transaction.
    let queued = false, alive = true
    const changed = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (alive) refresh() }) } }
    stamps.observe(changed)
    refresh()
    return () => { alive = false; stamps.unobserve(changed); if (!editor.isDestroyed) editor.unregisterPlugin(key) }
  }, [enabled, editor, handle, people, user, lang, t])
  return enabled ? <div className="block-authors-note" role="status">{t('shell.blockAuthors.note')}</div> : null
}
