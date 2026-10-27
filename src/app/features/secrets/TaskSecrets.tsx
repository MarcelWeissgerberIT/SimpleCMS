import { useState } from 'react'
import { useLang } from '../../i18n'
import { useUI } from '../../store/ui'
import { personalSelection, personalGrantCurrent, selectPersonalConnections, usePersonalVault } from './store'
import { taskAtlasChoices, taskAtlasGrantCurrent, taskAtlasSelection, selectTaskAtlas } from './deviceTask'
import { useWorkspace } from '../../store/store'
import './secrets.css'

export function TaskSecrets({ taskId, capable, worker }: { taskId: string; capable: boolean; worker: string }) {
  const de = useLang() === 'de', tr = (a: string, b: string) => de ? a : b
  const { status, entries } = usePersonalVault()
  const [, render] = useState(0)
  const selected = personalSelection(taskId)
  useWorkspace(s=>s.settings.mcpServers)
  const atlas=taskAtlasSelection(taskId),choices=taskAtlasChoices()
  const [error,setError]=useState('')
  return <details className="personal-task-secrets" data-testid="task-personal-secrets">
    <summary>{tr('Meine Secrets · Verbindungen für diese Aufgabe', 'My secrets · connections for this task')} ({selected.length+(atlas?1:0)})</summary>
    <p>{tr(`Mit Worker 1.28.0 für alle Coding-Agenten. Freigabe nur an den gekoppelten Worker „${worker}“ für diese Aufgabe in dieser Sitzung. Tokens bleiben aus dem Prompt und aus dem Workspace. Externe Schreibwerkzeuge können sofort Änderungen ausführen.`, `With worker 1.28.0 for all coding agents. Grant access only to paired worker “${worker}” for this task in this session. Tokens stay out of the prompt and workspace. External write tools can change data immediately.`)}</p>
    {capable&&choices.length>0&&<div data-testid="task-configured-atlas"><strong>{tr('Dein bereits eingerichteter Atlas-Zugang','Your configured Atlas access')}</strong><p>{tr('Für diese Aufgabe und ihren gewählten Coding-Anbieter MCP-Ergebnisse zum Lesen erlauben: Identität, Suche, Record und Kontext. Kein erneutes Kopieren des Tokens. Die Freigabe gehört nur dir und gilt in dieser Sitzung; externe Schreibwerkzeuge bleiben hier aus.','Allow read MCP results for this task and its selected coding provider: identity, search, record and context. No copying of the token again. The grant belongs only to you and lasts for this session; external write tools stay off here.')}</p>{choices.map(s=><label key={s.id}><input type="checkbox" checked={atlas===s.id} onChange={ev=>{try{selectTaskAtlas(taskId,ev.target.checked?s.id:null);setError('')}catch(e){setError(e instanceof Error?e.message:String(e))}render(n=>n+1)}}/><span>{s.name} · {new URL(s.url).host} · {tr('Atlas für diese Aufgabe nutzen','Use Atlas for this task')}</span></label>)}{atlas&&!taskAtlasGrantCurrent(taskId)&&<button className="btn btn--sm" onClick={()=>{try{selectTaskAtlas(taskId,atlas);setError('')}catch(e){setError(String(e))}render(n=>n+1)}}>{tr('Atlas-Freigabe erneut bestätigen','Confirm Atlas grant again')}</button>}</div>}
    {error&&<p role="alert">{error}</p>}
    {!capable ? <p>{tr('Worker zuerst aktualisieren; diese Version unterstützt den persönlichen Tresor noch nicht.', 'Update the worker first; this version does not support the personal vault.')}</p> : status !== 'open' ? <p>{tr('Weitere Verbindungen aus dem separaten Tresor: bei Bedarf „Meine Secrets“ öffnen und entsperren.', 'For additional connections from the separate vault, open My secrets and unlock it when needed.')}</p> : entries.map(e => <label key={e.id}>
      <input type="checkbox" checked={selected.includes(e.id)} onChange={ev => { selectPersonalConnections(taskId, ev.target.checked ? [...selected, e.id] : selected.filter(id => id !== e.id));render(x => x + 1) }} />
      <span>{e.name} · {new URL(e.url).host} · {e.tools.join(', ')}</span>
    </label>)}
    {capable && status === 'open' && selected.length > 0 && !personalGrantCurrent(taskId) && <button className="btn btn--sm" onClick={() => { selectPersonalConnections(taskId, selected);render(x => x + 1) }}>{tr('Worker-Verbindung geändert · Auswahl erneut freigeben', 'Worker connection changed · grant this selection again')}</button>}
    <button className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'secrets' })}>{tr('Meine Secrets öffnen', 'Open my secrets')}</button>
  </details>
}
