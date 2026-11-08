import {BudgetOverview} from './BudgetOverview'
import {useState} from 'react'
import {useLang} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {isEffectivelyTrashed,inTemplate} from '../../../store/selectors'
import {useRoute} from '../../../lib/router'
import {readableContent} from '../../../editor'
import {useAgent} from '../agent/state'
import {contextPageId} from '../agent/session'
import {precheck} from '../core/gate'
import {openBudgets} from '../../governor'
import './workflow.css'
/** Editable preview using the terminal's actual context chips. Exclusion is not an access policy. */
export function RunPreflight(){
 const de=useLang()==='de',draft=useAgent(s=>s.draft),route=useAgent(s=>s.route),refs=useAgent(s=>s.refs),mentions=useAgent(s=>s.mentions),running=useAgent(s=>s.status==='running'),off=useAgent(s=>s.pageOff)
 const pages=useWorkspace(s=>s.pages);useWorkspace(s=>s.settings);useWorkspace(s=>s.ai);useRoute()
 const [query,setQuery]=useState('')
 if(!draft.trim()||running||draft.trim().startsWith('/'))return null
 const page=contextPageId(),sources=[...new Set([...(page&&page!==off?[page]:[]),...refs.map(r=>r.pageId),...mentions.filter(m=>draft.includes('@'+m.title)).map(m=>m.id)])].filter(id=>!!pages[id]&&!isEffectivelyTrashed(pages,id))
 const available=Object.values(pages).filter(p=>!sources.includes(p.id)&&!isEffectivelyTrashed(pages,p.id)&&!inTemplate(pages,p.id)&&p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,12)
 const remove=(id:string)=>{const s=useAgent.getState(),titles=s.mentions.filter(m=>m.id===id).map(m=>m.title);useAgent.setState({pageOff:page===id?id:s.pageOff,refs:s.refs.filter(r=>r.pageId!==id),mentions:s.mentions.filter(m=>m.id!==id),draft:titles.reduce((d,title)=>d.split('@'+title).join(title),s.draft)})}
 const add=(id:string)=>{const s=useAgent.getState(),p=pages[id];useAgent.setState({mentions:[...s.mentions.filter(m=>m.id!==id),{id,title:p.title,kind:'page'}],draft:s.draft+' @'+p.title})}
 const chars=draft.length+sources.reduce((n,id)=>n+readableContent(id).plain.length,0)+refs.reduce((n,r)=>n+r.markdown.length,0)
 let model='',band:{low:number;high:number}|null=null,error=''
 try{const p=precheck({purpose:'terminal.task',sources:sources.map(page=>({page})),typed:draft,route,size:{promptChars:chars,maxTokens:4000,bandOut:1000},run:{mode:'manual'}});model=p.label;band=p.estimated??null}catch(e){error=e instanceof Error?e.message:String(e)}
 return <details className="term-preflight"><summary>{de?'Vor dem Start':'Before starting'} · {sources.length} {de?'ausgewählte Quellen':'selected sources'} · {Math.ceil(chars/4).toLocaleString()} {de?'geschätzte Text-Token':'estimated text tokens'}</summary>
 <ul>{sources.map(id=><li key={id}><strong>{pages[id].title}</strong> · {de?'One-Seite':'One page'} <button type="button" className="term-key" aria-label={(de?'Quelle entfernen: ':'Remove source: ')+pages[id].title} onClick={()=>remove(id)}>{de?'Entfernen':'Remove'}</button>{refs.filter(r=>r.pageId===id).map(r=><div key={r.id}>{r.file?.name??(r.image?(de?'Bild':'Image'):(de?'Textauswahl':'Text selection'))} <button type="button" className="term-key" onClick={()=>useAgent.setState(s=>({refs:s.refs.filter(x=>x.id!==r.id)}))}>{de?'Auswahl entfernen':'Remove selection'}</button></div>)}</li>)}</ul>
 {!sources.length&&<p>{de?'Nur deine Eingabe':'Your prompt only'}</p>}
 <label>{de?'Quelle hinzufügen':'Add source'} <input type="search" aria-label={de?'Quellen suchen':'Search sources'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={de?'Seite, Anforderung oder Designregeln …':'Page, requirement or design rules …'}/></label>
 {query&&<ul>{available.map(p=><li key={p.id}><button className="term-key" type="button" onClick={()=>{add(p.id);setQuery('')}}>{p.title}</button></li>)}</ul>}
 <p>{de?'Seiten, Anforderungen und Designregeln über ihre One-Seite hinzufügen. Datei- und Textauswahlen erscheinen einzeln. Entfernen nimmt die Quelle aus diesem Startkontext; vorhandener Verlauf und erlaubte spätere Werkzeugabrufe bleiben verfügbar.':'Add pages, requirements and design rules through their One page. File and text selections appear individually. Removing a source excludes it from this starting context; existing history and permitted later tool reads remain available.'}</p>
 <p>{model}{band?` · ≈ $${band.low.toFixed(4)}–$${band.high.toFixed(4)}`:''}</p><p>{de?'Orientierung für den bekannten Text mit 1.000–4.000 Ausgabe-Token. Verlauf, Werkzeugdefinitionen, Dateien und weitere Abrufe kommen hinzu. Das ist kein Gesamtpreis und keine feste Obergrenze.':'Orientation for known text with 1,000–4,000 output tokens. History, tool definitions, files and further reads add cost. This is not a total price or a hard cap.'}</p>{error&&<p>{error}</p>}<BudgetOverview/><button className="term-key" type="button" onClick={()=>openBudgets()}>{de?'Budget einstellen':'Set budget'}</button></details>
}
