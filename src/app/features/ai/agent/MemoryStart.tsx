/** A first-use offer, with no model request or saved memory until the person acts. */
import { useState } from 'react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { HelpLink } from '../../../help'
import { memoryDbId } from '../memory/schema'
import { memorySettings } from '../memory/settings'
import { trivialTask } from '../memory/propose'
import { useAgent } from './state'
import { submitPrompt } from './session'

export function MemoryStart() {
  const t = useT()
  const readOnly = useCloud(s => s.readOnly)
  const available = useWorkspace(s => {
    const m = memorySettings(s.settings)
    return m.enabled && !(m.explicit && !m.proposals) && !memoryDbId()
  })
  const last = useAgent(s => s.turns.at(-1))
  const busy = useAgent(s => s.status === 'running')
  const hasCard = useAgent(s => s.memCards.some(c => c.after === (last?.n ?? 0)))
  const [dismissed, setDismissed] = useState(false)
  if (!available || readOnly || busy || hasCard || dismissed || (last && (last.status !== 'done' || trivialTask(last.task, 0)))) return null
  return (
    <section className="term-review term-memory-start" data-testid="memory-start" aria-label={t('features.memory.start.title')}>
      <h3 className="term-review__title">{t('features.memory.start.title')} <HelpLink id="memory" /></h3>
      <p>{t(last ? 'features.memory.start.after' : 'features.memory.start.before')}</p>
      <div className="term-memory-start__keys">
        <button type="button" className="btn btn--sm btn--ink" onClick={() => {
          if (last) {
            setDismissed(true)
            void submitPrompt('/remember')
          } else {
            useAgent.setState({ draft: t('features.memory.start.draft') })
            document.querySelector<HTMLTextAreaElement>('.term-prompt__input')?.focus()
          }
        }}>{t(last ? 'features.memory.start.propose' : 'features.memory.start.try')}</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDismissed(true)}>{t('features.memory.start.later')}</button>
      </div>
    </section>
  )
}
