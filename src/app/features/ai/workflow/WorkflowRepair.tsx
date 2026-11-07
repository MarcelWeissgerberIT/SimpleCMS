import {useLang} from '../../../i18n'
import {navigate} from '../../../lib/router'
import {workflowRepair} from '@/shared/ai/workflowRepair'
export function WorkflowRepair({message}:{message:string}){
 const de=useLang()==='de',repair=workflowRepair(message,de)
 return <div className="term-repair"><p>{repair.text}</p>{['budget','connection'].includes(repair.kind)&&<button type="button" className="btn btn--sm" onClick={()=>navigate({name:repair.kind==='budget'?'regler':'mcp'})}>{repair.kind==='budget'?(de?'Verbrauch & Budget prüfen':'Review usage & budget'):(de?'Verbindung prüfen':'Check connection')}</button>}</div>
}
