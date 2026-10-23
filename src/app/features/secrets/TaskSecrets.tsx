import { useState } from 'react'
import { useLang } from '../../i18n'
import { useUI } from '../../store/ui'
import { personalSelection, personalGrantCurrent, selectPersonalConnections, usePersonalVault } from './store'
import './secrets.css'

export function TaskSecrets({ taskId, capable, worker }: { taskId: string; capable: boolean; worker: string }) {
  const de = useLang() === 'de', tr = (a: string, b: string) => de ? a : b
  const { status, entries } = usePersonalVault()
  const [, render] = useState(0)
  const selected = personalSelection(taskId)
  return <details className="personal-task-secrets" data-testid="task-personal-secrets">
    <summary>{tr('Meine Secrets · Verbindungen für diese Aufgabe', 'My secrets · connections for this task')} ({selected.length})</summary>
    <p>{tr(`Mit Worker 1.28.0 für alle Coding-Agenten. Freigabe nur an den gekoppelten Worker „${worker}“ für diese Aufgabe in dieser Sitzung. Tokens bleiben aus dem Prompt und aus dem Workspace. Externe Schreibwerkzeuge können sofort Änderungen ausführen.`, `With worker 1.28.0 for all coding agents. Grant access only to paired worker “${worker}” for this task in this session. Tokens stay out of the prompt and workspace. External write tools can change data immediately.`)}</p>
    {!capable ? <p>{tr('Worker zuerst aktualisieren; diese Version unterstützt den persönlichen Tresor noch nicht.', 'Update the worker first; this version does not support the personal vault.')}</p> : status !== 'open' ? <p>{tr('Zum Auswählen oder Ausführen zuerst deinen Tresor entsperren.', 'Unlock your vault before selecting connections or running this task.')}</p> : entries.map(e => <label key={e.id}>
      <input type="checkbox" checked={selected.includes(e.id)} onChange={ev => { selectPersonalConnections(taskId, ev.target.checked ? [...selected, e.id] : selected.filter(id => id !== e.id));render(x => x + 1) }} />
      <span>{e.name} · {new URL(e.url).host} · {e.tools.join(', ')}</span>
    </label>)}
    {capable && status === 'open' && selected.length > 0 && !personalGrantCurrent(taskId) && <button className="btn btn--sm" onClick={() => { selectPersonalConnections(taskId, selected);render(x => x + 1) }}>{tr('Worker-Verbindung geändert · Auswahl erneut freigeben', 'Worker connection changed · grant this selection again')}</button>}
    <button className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'secrets' })}>{tr('Meine Secrets öffnen', 'Open my secrets')}</button>
  </details>
}
