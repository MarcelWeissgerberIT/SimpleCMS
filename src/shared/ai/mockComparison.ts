/** Browser-owned comparison of inert snapshots. Model claims are never comparison evidence. */
import DOMPurify from 'dompurify'
import {mockBlockFrame,type MockBlockPreview} from './mockBlock'
import {mockColorStyle} from './mockBlockProvenance'

export function safeMockPreview(p:MockBlockPreview){return mockBlockFrame(DOMPurify.sanitize(p.document,{WHOLE_DOCUMENT:true,ADD_TAGS:['style'],FORBID_TAGS:['meta','base','script','link','iframe','object','embed','form'],FORBID_ATTR:['src','srcset','action','formaction','href','poster','background']})+mockColorStyle(p.colors??{}))}
export type MockDifference={id:string;label:string;beforePath?:string;afterPath?:string;kind:'added'|'removed'|'changed';details:Array<{property:string;before:string;after:string}>}
type Entry={path:string;matchPath:string;id:string;tag:string;component:string;text:string;label:string;attributes:string;styles:Record<string,string>;allStyles:string;box:string}
export type MockComparisonResult={state:'identical'|'changed'|'unverified';changes:MockDifference[];sources:string[];width:number;height:number;reason?:string}
const properties=['display','visibility','opacity','color','background-color','background-image','font-family','font-size','font-weight','line-height','letter-spacing','text-align','text-decoration','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','gap','row-gap','column-gap','border-top-width','border-top-color','border-top-style','border-radius','box-shadow','transform','filter','overflow','position','grid-template-columns','flex-direction','justify-content','align-items']
export function mockElementPath(el:Element){const parts:string[]=[];let n:Element|null=el;while(n&&n.tagName!=='BODY'){const siblings=[...(n.parentElement?.children??[])].filter(s=>s.tagName===n!.tagName);parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(n)+1)+')');n=n.parentElement}return 'body'+(parts.length?' > '+parts.join(' > '):'')}
const hostWrapper=(e:Element)=>/^one-patch-[a-z0-9-]+$/i.test(e.id)
function matchPath(el:Element):string{const parts:string[]=[];let n:Element|null=el;while(n&&n.tagName!=='BODY'){if(!hostWrapper(n)){let parent=n.parentElement;while(parent&&hostWrapper(parent))parent=parent.parentElement;const flatten=(e:Element):Element[]=>[...e.children].flatMap(c=>hostWrapper(c)?flatten(c):[c]);const siblings=parent?flatten(parent).filter(s=>s.tagName===n!.tagName):[];parts.unshift(n.tagName.toLowerCase()+':'+siblings.indexOf(n))}n=n.parentElement}return parts.join('/')}
const normal=(text:string)=>text.replace(/\s+/g,' ').trim()
function snapshot(frame:HTMLIFrameElement):Entry[]{
 const doc=frame.contentDocument!,win=frame.contentWindow!,elements=[doc.body,...doc.body.querySelectorAll('*')].filter(e=>!['STYLE','SCRIPT','META','TITLE'].includes(e.tagName)&&!hostWrapper(e))
 if(elements.length>1800)throw Error('Zu viele Elemente für einen vollständigen Vergleich. Keine Gleichheit bestätigt.')
 return elements.map(el=>{
  const css=win.getComputedStyle(el),rect=el.getBoundingClientRect(),styles=Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)]))
  const pseudos:string[]=[]
  for(const p of ['::before','::after']){const s=win.getComputedStyle(el,p),active=s.content!=='none'&&s.content!=='normal';styles[p+' content']=active?s.content:'';for(const k of properties)styles[p+' '+k]=active?s.getPropertyValue(k):'';if(active)pseudos.push(JSON.stringify([...s].filter(k=>!k.startsWith('--')).map(k=>[k,s.getPropertyValue(k)])))}
  const text=normal([...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent??'').join(' ')),component=el.getAttribute('data-ds-component')??''
  const label=(component||el.closest('[data-ds-component]')?.getAttribute('data-ds-component')||el.tagName.toLowerCase())+' · '+normal(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').slice(0,90)
  const attributes=JSON.stringify([...el.attributes].filter(a=>!['class','style','id','data-mock-id','data-ds-component','data-requirement','inert'].includes(a.name)).map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b)))
  const allStyles=JSON.stringify([[...css].filter(p=>!p.startsWith('--')).map(p=>[p,css.getPropertyValue(p)]),pseudos])
  return {path:mockElementPath(el),matchPath:matchPath(el),id:el.getAttribute('data-mock-id')||el.id,tag:el.tagName.toLowerCase(),component,text,label,attributes,styles,allStyles,box:[rect.x,rect.y,rect.width,rect.height].map(n=>Math.round(n*100)/100).join(', ')}
 })
}
function differences(a:Entry[],b:Entry[]):MockDifference[]{
 const remaining=new Set(b),out:MockDifference[]=[],oldIds=new Set(a.map(e=>e.id).filter(Boolean))
 for(const old of a){
  // Prefer stable instance identity, then exact semantic content, then position (legacy mocks).
  const unique=(test:(n:Entry)=>boolean)=>{const found=[...remaining].filter(test);return found.length===1?found[0]:undefined}
  const next=(old.id?unique(n=>n.id===old.id):undefined)??(old.text?unique(n=>n.tag===old.tag&&n.text===old.text&&n.component===old.component):undefined)??unique(n=>n.matchPath===old.matchPath&&(!n.id||n.id===old.id||!oldIds.has(n.id)))
  if(!next){out.push({id:'removed-'+old.path,label:old.label,beforePath:old.path,kind:'removed',details:[{property:'element',before:old.tag,after:'—'}]});continue}
  remaining.delete(next)
  const details:MockDifference['details']=[]
  const add=(property:string,before:string,after:string)=>{if(before!==after)details.push({property,before,after})}
  add('component',old.component,next.component);add('element',old.tag,next.tag);add('text',old.text,next.text);add('attributes',old.attributes,next.attributes);add('position / size',old.box,next.box)
  for(const p of Object.keys(old.styles))add(p,old.styles[p],next.styles[p])
  if(old.allStyles!==next.allStyles&&!details.length){const [oldCss,oldPseudo]=JSON.parse(old.allStyles),[newCss,newPseudo]=JSON.parse(next.allStyles),values=Object.fromEntries(newCss);for(const [key,value]of oldCss)add(key,value,values[key]??'');if(JSON.stringify(oldPseudo)!==JSON.stringify(newPseudo))add('other pseudo styles','previous pseudo-element styles','changed pseudo-element styles')}
  if(details.length)out.push({id:'changed-'+old.path,label:next.label,beforePath:old.path,afterPath:next.path,kind:'changed',details})
 }
 for(const next of remaining)out.push({id:'added-'+next.path,label:next.label,afterPath:next.path,kind:'added',details:[{property:'element',before:'—',after:next.tag}]})
 return out
}
export function mockSourceChanges(before:MockBlockPreview,after:MockBlockPreview):string[]{
 const a=before.provenance?.sources??[],b=after.provenance?.sources??[],keys=[...new Set([...a,...b].map(s=>s.server+' '+s.url))]
 const fingerprint=(p:MockBlockPreview,key:string)=>{const receipt=p.provenance,d=receipt?.draft;return JSON.stringify((receipt?.sources??[]).filter(s=>s.server+' '+s.url===key).map(s=>{
  const citations=d?[['design',[d.design]],['authority',d.authority?[d.authority]:[]],['requirements',d.requirements],['tokens',d.tokens],['components',d.components]].map(([role,items])=>[role,(items as Array<{source:string;quote:string}>).filter(c=>c.source===s.id).map(({source,...c})=>JSON.stringify(c)).sort()]):[]
  return JSON.stringify([s.hash,s.stateHash,citations])
 }).sort())}
 return keys.flatMap(key=>fingerprint(before,key)!==fingerprint(after,key)?[(b.find(s=>s.server+' '+s.url===key)??a.find(s=>s.server+' '+s.url===key))!.url]:[])

}
async function rendered(html:string,width:number,height:number,signal?:AbortSignal):Promise<HTMLIFrameElement>{
 signal?.throwIfAborted()
 const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.referrerPolicy='no-referrer';frame.style.cssText=`position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;opacity:0;`;frame.title='Mock comparison measurement'
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>done(Error('Vorschau konnte nicht vollständig verglichen werden.')),8000),abort=()=>done(signal?.reason??Error('Aborted'));const done=(error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);frame.onload=null;error?reject(error):resolve()};signal?.addEventListener('abort',abort,{once:true});frame.onload=()=>{if(!frame.contentDocument?.body)return;void frame.contentDocument.fonts.ready.then(()=>done(),done)};frame.srcdoc=html;document.body.append(frame)});signal?.throwIfAborted();return frame}catch(e){frame.remove();throw e}
}
/** Identical means same measured DOM semantics, computed styles and geometry at this viewport, not a pixel-perfect claim. */
export async function compareMockPreviews(before:MockBlockPreview,after:MockBlockPreview,signal?:AbortSignal,width=before.width):Promise<MockComparisonResult>{
 const height=Math.max(before.height,after.height),sources=mockSourceChanges(before,after),frames:HTMLIFrameElement[]=[]
 try{
  const a=await rendered(safeMockPreview(before),width,height,signal);frames.push(a)
  const b=await rendered(safeMockPreview(after),width,height,signal);frames.push(b)
  const changes=differences(snapshot(a),snapshot(b))
  if(before.width!==after.width||before.height!==after.height)changes.unshift({id:'viewport',label:'Viewport',kind:'changed',details:[{property:'original viewport',before:`${before.width} × ${before.height}`,after:`${after.width} × ${after.height}`}]})
  return {state:changes.length?'changed':'identical',changes,sources,width,height}
 }catch(e){signal?.throwIfAborted();return {state:'unverified',changes:[],sources,width,height,reason:e instanceof Error?e.message:String(e)}}finally{frames.forEach(f=>f.remove())}
}
