/** The same preview route that an ai_task button pins; descriptive page properties never select a model. */
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {routeFor} from '../core/gate'
import {useWorkerModels} from '../core/workerModels'
import {useCentralAI} from '../core/centralAI'
import './prepared-model.css'
export default function PreparedTaskModel(){
 const t=useT(),pin=useWorkspace(s=>s.ai?.routes?.['*']?.[0])
 useWorkspace(s=>s.settings)
 useWorkerModels();useCentralAI()
 const preview=routeFor('terminal.task',{route:pin??null}),source=pin?'workspace':preview.level
 return <div className="prepared-model" role="note" aria-label={t('features.ai.routeSource.preview')}><span>{t('features.ai.routeSource.preview')}: <strong>{preview.label}</strong></span><small>{t('features.ai.routeSource.'+source)} · {t(preview.available?'features.ai.routeSource.recheck':'features.ai.routeSource.unavailable')}</small></div>
}
