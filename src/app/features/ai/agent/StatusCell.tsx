/**
 * Status bar cell of the AI terminal: "AI ⌘J" at rest; while the terminal is hidden its LED shows a
 * task running in the background ("AI · working"), proposals waiting ("AI · 3 changes to review")
 * or a result nobody has seen yet. A click shows / hides the terminal.
 */
import { useT } from '../../../i18n'
import { shortcutLabel } from '../../../ui/controls'
import { toggleAgent, useAgent } from './state'
import './cell.css'

export function AgentStatusCell() {
  const t = useT()
  const open = useAgent((s) => s.open)
  const running = useAgent((s) => s.status === 'running')
  const pending = useAgent((s) => s.changes.filter((c) => c.status === 'pending').length)
  const unseen = useAgent((s) => s.unseen)
  let text = t('features.agent.cell.idle', { key: shortcutLabel('Mod+J') })
  let led = 'led'
  if (!open && running) {
    text = t('features.agent.cell.working')
    led = 'led led--on term-cell__blink'
  } else if (!open && pending) {
    text = t(`features.agent.cell.review.${pending === 1 ? 'one' : 'other'}`, { count: pending })
    led = 'led led--on'
  } else if (!open && unseen) {
    text = t(unseen === 'error' ? 'features.agent.cell.error' : 'features.agent.cell.done')
    led = unseen === 'error' ? 'led term-cell__err' : 'led led--ok'
  } else if (running) led = 'led led--on'
  const title = `${open ? t('features.agent.close') : t('features.agent.open')} (${shortcutLabel('Mod+J')})`
  return (
    <button type="button" className="status__cell term-cell" data-state={!open && (running || pending || unseen) ? 'lit' : undefined} aria-expanded={open} onClick={toggleAgent} title={title} aria-label={`${text} — ${title}`}>
      <span className={led} aria-hidden />
      {text}
    </button>
  )
}
