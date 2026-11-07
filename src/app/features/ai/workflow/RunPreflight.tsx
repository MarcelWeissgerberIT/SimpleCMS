import {useLang} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {useRoute} from '../../../lib/router'
import {readableContent} from '../../../editor'
import {useAgent} from '../agent/state'
import {contextPageId} from '../agent/session'
import {precheck} from '../core/gate'
import {ReglerRestLine,openBudgets} from '../../governor'
import './workflow.css'
/** A local, explicit preview. No model call and no reservation; tool/history overhead is not predicted. */
export function RunPreflight(){
 const de=useLang()==='de',draft=useAgent(s=>s.draft),route=useAgent(s=>s.route),refs=useAgent(s=>s.refs),mentions=useAgent(s=>s.mentions),running=useAgent(s=>s.status==='running'),off=useAgent(s=>s.pageOff)
 const pages=useWorkspace(s=>s.pages);useWorkspace(s=>s.settings);useWorkspace(s=>s.ai);useRoute()
 if(!draft.trim()||running||draft.trim().startsWith('/'))return null
 const page=contextPageId(),sources=[...new Set([...(page&&page!==off?[page]:[]),...refs.map(r=>r.pageId),...mentions.filter(m=>draft.includes('@'+m.title)).map(m=>m.id)])].filter(id=>!!pages[id])
 const chars=draft.length+sources.reduce((n,id)=>n+readableContent(id).plain.length,0)+refs.reduce((n,r)=>n+r.markdown.length,0)
 let model='',band:{low:number;high:number}|null=null,error=''
 try{const p=precheck({purpose:'terminal.task',sources:sources.map(page=>({page})),typed:draft,route,size:{promptChars:chars,maxTokens:4000,bandOut:1000},run:{mode:'manual'}});model=p.label;band=p.estimated??null}catch(e){error=e instanceof Error?e.message:String(e)}
 return <details className="term-preflight"><summary>{de?'Vor dem Start':'Before starting'} · {sources.length} {de?'ausgewählte Quellen':'selected sources'} · {Math.ceil(chars/4).toLocaleString()} {de?'geschätzte Text-Token':'estimated text tokens'}</summary><p>{sources.map(id=>pages[id].title).join(' · ')|| (de?'Nur deine Eingabe':'Your prompt only')}</p><p>{model}{band?` · ≈ $${band.low.toFixed(4)}–$${band.high.toFixed(4)}`:''}</p><p>{de?'Orientierung für den bekannten Text mit 1.000–4.000 Ausgabe-Token. Verlauf, Werkzeugdefinitionen, Dateien und weitere Abrufe kommen hinzu. Das ist kein Gesamtpreis und keine feste Obergrenze.':'Orientation for known text with 1,000–4,000 output tokens. History, tool definitions, files and further reads add cost. This is not a total price or a hard cap.'}</p>{error&&<p>{error}</p>}<ReglerRestLine/><button className="term-key" type="button" onClick={()=>openBudgets()}>{de?'Budget einstellen':'Set budget'}</button></details>
}
