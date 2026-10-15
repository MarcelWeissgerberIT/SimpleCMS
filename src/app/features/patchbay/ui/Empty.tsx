/**
 * The empty rack (plan §3.3, §6 U11): no cable at all. One sentence, the idle parts still listed by name (servers
 * nobody uses, …), no legend. Primary keys "New agent" and "New automation" (an automation lives in its database: the
 * key asks which one, then opens that database's automations); "Drop a profile here" is secondary.
 */
import { Bot, FileJson, Workflow } from 'lucide-react'
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'
import { handFocusOver } from '../../../ui/focus'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { Screws } from '../../../ui/controls'
import type { Layout } from '../layout'
import type { Model, ModelInput } from '../types'
import type { Words } from './words'

const P = 'features.patchbay'

export function Empty({ model, input, words: w, layout, drop }: { model: Model; input: ModelInput; words: Words; layout: Layout; drop: (() => void) | null }) {
  const t = w.t
  const menu = useMenu()
  const byKey = new Map(model.modules.map((m) => [m.key, m]))
  const idle = layout.slots.flatMap((s) => (s.kind === 'fold' ? s.modules : s.kind === 'module' ? [s.id] : [])).map((k) => byKey.get(k)).filter((m): m is NonNullable<typeof m> => !!m)
  const dbs = input.databases.map((d) => ({ id: d.id, title: input.pages[d.id]?.title.trim() || t(`${P}.untitled`) })).sort((a, b) => a.title.localeCompare(b.title))
  const entries: MenuEntry[] = dbs.length
    ? [{ kind: 'section', label: t(`${P}.empty.pick`) }, ...dbs.map((d) => ({ label: d.title, onSelect: () => useUI.getState().openModal({ type: 'automations', databaseId: d.id }) }))]
    : [{ label: t(`${P}.empty.noDb`), disabled: true }]
  return (
    <section className="pb-empty screw-plate" data-testid="pb-empty">
      <Screws seed="patchbay-empty" />
      <p className="pb-empty__say">{t(`${P}.empty`)}</p>
      {idle.length > 0 && (
        <p className="pb-empty__idle">
          <span className="pb-fold__leds" aria-hidden="true">
            <span className="led" />
            <span className="led" />
            <span className="led" />
          </span>
          <span className="label">{t(`${P}.idle`, { n: idle.length })}</span>
          <span className="pb-empty__names">{idle.map((m) => w.name(m)).join(' · ')}</span>
        </p>
      )}
      <div className="pb-empty__keys">
        <button
          type="button"
          className="btn btn--primary"
          onClick={(e) => {
            handFocusOver(e.currentTarget)
            navigate({ name: 'agents' })
          }}
          data-testid="pb-empty-agent"
        >
          <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
          {t(`${P}.empty.agent`)}
        </button>
        <button type="button" className="btn btn--primary" aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle} data-testid="pb-empty-automation">
          <Workflow size={14} strokeWidth={1.75} aria-hidden="true" />
          {t(`${P}.empty.automation`)}
        </button>
        <Menu {...menu.props} entries={entries} width={260} />
        {drop && (
          <button type="button" className="pb-drop" onClick={drop} data-testid="pb-empty-drop">
            <FileJson size={14} strokeWidth={1.7} aria-hidden="true" />
            {t(`${P}.drop`)}
          </button>
        )}
      </div>
    </section>
  )
}
