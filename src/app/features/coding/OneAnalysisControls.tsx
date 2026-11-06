import { useLang } from '../../i18n'
import { useTaskLocal, patchTask } from './local'
import { RouteChip } from '../ai/routing/RouteChip'
import { taskContext } from './tasks'
import { refIdsOf } from './refs'

export function OneAnalysisControls({ taskId, one, disabled }: { taskId: string; one: boolean; disabled: boolean }) {
  const de = useLang() === 'de', local = useTaskLocal(taskId), ctx = taskContext(taskId)
  const sources = [taskId, ...(ctx ? refIdsOf(ctx.row) : [])].map(page => ({ page }))
  return <div className="ctk-setup" data-testid="one-analysis-controls">
    <div className="ctk-picks">
      <label>{de ? 'Ausführung' : 'Execution'}{' '}
        <select className="input" aria-label={de ? 'Ausführung' : 'Execution'} disabled={disabled} value={one ? 'one' : 'worker'} onChange={e => void patchTask(taskId, { execution: e.target.value as 'one' | 'worker' })}>
          <option value="one">{de ? 'One-Modell · ohne Worker' : 'One model · no worker'}</option>
          <option value="worker">{de ? 'Lokaler Worker' : 'Local worker'}</option>
        </select>
      </label>
      {one && <RouteChip purpose="agents.run" chip={local.analysisRoute ?? null} onChip={analysisRoute => void patchTask(taskId, { analysisRoute })} sources={sources} reads={de ? 'Aufgabe, verknüpfte Seiten und erlaubte Atlas-Quellen' : 'Task, linked pages and permitted Atlas sources'} disabled={disabled} />}
    </div>
    {one && <p className="ctk-hint">{de ? 'One liest die Aufgabe, verknüpfte Seiten und erlaubte Atlas-Quellen. Ergebnisse werden je Stufe in dieser Aufgabe gespeichert; Freigaben bleiben erhalten. Lass diesen One-Tab während der Ausführung geöffnet.' : 'One reads the task, linked pages and permitted Atlas sources. Each stage saves its document in this task and keeps approval gates. Keep this One tab open while it runs.'}</p>}
  </div>
}
