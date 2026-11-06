import DOMPurify from 'dompurify'
import type {Component,Tree} from '@/shared/uiInstructions/spec'
import type {UIProject} from '@/shared/uiInstructions/project'
const properties=['color','background-color','font-family','font-size','font-weight','line-height','padding','gap','border-radius','border','box-shadow','display','grid-template-columns']
/** Local static HTML measurement: no scripts, network, cookies, model, or worker. */
export async function analyzeHTML(html:string,title:string,signal:AbortSignal,onProgress:(text:string)=>void):Promise<UIProject>{
 if(new TextEncoder().encode(html).length>2_000_000)throw new Error('HTML überschreitet 2 MB. Bitte eine einzelne Ansicht importieren.')
 const source=new DOMParser().parseFromString(html,'text/html')
 const styles=[...source.querySelectorAll('style')].map(s=>s.textContent??'').join('\n')
 const clean=DOMPurify.sanitize(source.body.innerHTML,{FORBID_TAGS:['style','script','iframe','object','embed','link','base','meta','form','video','audio','source'],FORBID_ATTR:['srcset','src','href','action','formaction','autofocus']})
 const defs:Component[]=[],trees:Tree[]=[],documents:Record<string,string>={},seen=new Map<string,string>()
 for(const width of [1440,768,390]){
  if(signal.aborted)throw new DOMException('Aborted','AbortError')
  onProgress(`${width}px`)
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1
  Object.assign(frame.style,{position:'fixed',left:'-20000px',top:'0',width:width+'px',height:'900px',visibility:'hidden'})
  const csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'"
  // Style text cannot close its element. No source script can run in this sandbox.
  frame.srcdoc=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${styles.replace(/<\/style/gi,'<\\/style')}</style></head><body>${clean}</body></html>`
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('HTML-Vorschau konnte nicht geladen werden.')),10000);const abort=()=>done(new DOMException('Aborted','AbortError'));const done=(error?:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);frame.onload=null;error?reject(error):resolve()};frame.onload=()=>done();signal.addEventListener('abort',abort,{once:true});document.body.append(frame)})
   if(signal.aborted)throw new DOMException('Aborted','AbortError')
   const doc=frame.contentDocument!,win=frame.contentWindow!
   const candidates=[...doc.body.querySelectorAll('main,section,article,header,footer,nav,aside,button,a,input,select,textarea,table,ul,ol,fieldset,[role],h1,h2,h3')]
   if(candidates.length>2000)throw new Error('Mehr als 2.000 Elemente in einer Ansicht. Bitte die Referenz aufteilen.')
   const nodes:Tree['nodes']=[],ids=new Map<Element,string>()
   for(const el of candidates){
    const css=win.getComputedStyle(el),rect=el.getBoundingClientRect();if(css.display==='none'||css.visibility==='hidden'||!rect.width||!rect.height)continue
    const kind=el.getAttribute('role')||el.tagName.toLowerCase(),label=(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||kind).trim().replace(/\s+/g,' ').slice(0,100)
    const style=Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),key=JSON.stringify([kind,el.className,style]);let componentId=seen.get(key)
    if(!componentId){componentId='C'+String(defs.length+1).padStart(3,'0');seen.set(key,componentId);defs.push({id:componentId,name:label||kind,kind,style,evidence:'dom'});documents[componentId]=`# ${label||kind}\n\nKomponenten-ID: ${componentId}\nKategorie: ${kind}\n\n## Quelle\nStatische HTML-Referenz: ${title.replace(/[\r\n]/g,' ')}. Lokal im One-Browser gemessen; Skripte und externe Ressourcen wurden nicht geladen.\n\n## Visuelle Vorgaben\n${Object.entries(style).map(([p,v])=>'- '+p+': '+v).join('\n')}\n\n## Verhalten und offene Punkte\nNur der initiale Zustand wurde gemessen. Aktionen, Hover, Fokus, Fehlerzustände und fachliche Wirkung wurden nicht getestet. Vor der Umsetzung klären.\n\n## Umsetzung in One\nBestehende One-Komponenten, Schriftarten und Design-Tokens verwenden; Referenzwerte auf One-Tokens abbilden.\n`}
    let parent=el.parentElement;while(parent&&!ids.has(parent))parent=parent.parentElement
    const id=`V${width}N${nodes.length+1}`;ids.set(el,id);nodes.push({id,componentId,parentId:parent?ids.get(parent)!:null,label,selector:el.tagName.toLowerCase()+(el.id?'#'+el.id:''),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}})
   }
   trees.push({id:'V'+width,name:title,width,evidence:'dom',nodes})
  }finally{frame.remove()}
 }
 if(!defs.length)throw new Error('Keine sichtbaren semantischen Komponenten gefunden.')
 const markdown=`# UI Instructions\n\nProjekt: ${title.replace(/[\r\n]/g,' ')}\n\nStatische HTML-Analyse in One. Externe Bilder, Schriften, Stylesheets und Skripte fehlen. Kein Nachweis interaktiven Verhaltens.\n\n`+Object.entries(documents).map(([id,doc])=>`<!-- ui-component:${id}:start -->\n${doc}\n<!-- ui-component:${id}:end -->`).join('\n\n')+'\n\n<!-- ui-manifest:start -->\n```json\n'+JSON.stringify({version:1,definitions:defs,trees},null,2)+'\n```\n<!-- ui-manifest:end -->\n'
 return {format:'component-studio-project',version:1,markdown,settings:{project:title},savedAt:new Date().toISOString()}
}
