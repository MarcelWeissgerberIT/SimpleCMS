import {contentKey} from '../../history/snapshots'
import {PageReadBuffer} from '@/shared/ai/sourcePassages'
import {STANDARD_READ,SMALL_READ,type ReadBudget} from '@/shared/ai/readPlanning'
import type {AgentTool} from './tools'
import {withPageReadBudget} from './toolScope'
import {useWorkspace} from '../../../store/store'

/** Run-local coverage, never persisted as an authority to read a source again. */
export function sourceReadSession(){
 const pages=new Map<string,PageReadBuffer>()
 const pins=new Map<string,string>()
 const fingerprint=(id:string)=>{const p=useWorkspace.getState().pages[id];return JSON.stringify([p?.title,p?.trashed,contentKey(p?.content)])}
 let reads=0,delivered=0,revisions=0,small=false
 return {
  configure(context:number,local:boolean){small=local||context<64_000},
  wrap(tools:AgentTool[]):AgentTool[]{return tools.map(tool=>tool.name!=='read_page'?tool:{...tool,async run(input,stage){
   const budget:ReadBudget=small?SMALL_READ:STANDARD_READ
   const before=fingerprint(stage.resolve(String(input.id??'')))
   const out=await withPageReadBudget(budget,()=>tool.run(input,stage))
   const w=out.pageRead
   if(!w||out.state!=='ok')return out
   const pin=fingerprint(w.pageId)
   if(pin!==before)throw Error('Source changed while reading; the returned window was not accepted.')
   if(pins.has(w.pageId)&&pins.get(w.pageId)!==pin)throw Error('A source changed during this run. Start a fresh read in a new run.')
   pins.set(w.pageId,pin)
   reads++;delivered+=w.characters
   const key=JSON.stringify([w.pageId,w.version??null,w.partial])
   let buffer=pages.get(key)
   if(!buffer){buffer=new PageReadBuffer();pages.set(key,buffer);if([...pages.keys()].filter(k=>JSON.parse(k)[0]===w.pageId).length>1)revisions++}
   buffer.add(w,out.content)
   const coverage=buffer.coverage(),de=useWorkspace.getState().settings.language==='de'
   const status=coverage.complete?(w.partial?(de?'Auswahl vollständig':'Selection complete'):(de?'Vollständig bereitgestellt':'Fully provided')):(de?'Ausschnitt bereitgestellt':'Excerpt provided')
   return {...out,sourceComplete:coverage.complete,summary:`${status} · ${coverage.uniqueCharacters.toLocaleString()} / ${w.totalCharacters.toLocaleString()} ${de?'Zeichen':'characters'}${coverage.duplicateCharacters?` · ${coverage.duplicateCharacters.toLocaleString()} ${de?'erneut gelesen':'reread'}`:''}`}
  }})},
  assertCurrent(){for(const [id,pin] of pins)if(fingerprint(id)!==pin)throw Error('Task or sources changed. Read the current sources in a new run before accepting the result.')},
  metrics(){const values=[...pages.values()].map(p=>p.coverage());return {reads,uniqueCharacters:values.reduce((n,p)=>n+p.uniqueCharacters,0),duplicateCharacters:values.reduce((n,p)=>n+p.duplicateCharacters,0),providedCharacters:delivered,sourceVersions:values.length,completeVersions:values.filter(p=>p.complete).length,revisions}},
 }
}
