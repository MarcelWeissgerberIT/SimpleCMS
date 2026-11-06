import type {MockBlockPreview} from '@/shared/ai/mockBlock'
import {mockNoteElements,type MockFeedback} from '@/shared/ai/mockReview'
import type {DesignMock,MockDraft,MockCitation} from '@/shared/ai/designMock'
import {sha256Hex} from '@/shared/mcp/sha256'
import {mockProvenance} from '@/shared/ai/mockBlockProvenance'
export function elementPath(el:Element):string{
 const parts:string[]=[];let n:Element|null=el
 while(n&&n.tagName!=='BODY'){const siblings=[...(n.parentElement?.children??[])].filter(s=>s.tagName===n!.tagName);parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(n)+1)+')');n=n.parentElement}
 return 'body'+(parts.length?' > '+parts.join(' > '):'')
}
/** Resolve saved selectors only against the hash-checked base. A stale annotation is never guessed. */
export function focusedMockRegion(preview:MockBlockPreview,notes:MockFeedback[]){
 const doc=new DOMParser().parseFromString(preview.document,'text/html')
 if(!preview.provenance||notes.some(n=>n.scenario))return null
 const elements=notes.flatMap(mockNoteElements).map(element=>{const el=doc.querySelector(element.path);if(!el||el.tagName.toLowerCase()!==element.tag.toLowerCase()||(el.textContent??'').trim().slice(0,500)!==element.text||(el.closest('[data-ds-component]')?.getAttribute('data-ds-component')??'')!==element.component)throw Error('Die markierte Stelle hat sich geändert. Bitte erneut markieren.');return el.closest('[data-ds-component]')??el})
 let root:Element=elements[0]!
 while(!elements.every(e=>root.contains(e))&&root.parentElement)root=root.parentElement
 if(root===doc.body||root===doc.documentElement)return null
 if(root.outerHTML.length>24000)throw Error('Markiere eine kleinere Komponente für diese gezielte Änderung.')
 return {path:elementPath(root),html:root.outerHTML,hash:sha256Hex(root.outerHTML)}
}
/** CSS of a replacement cannot target siblings, ancestors or change their token values. */
export function scopedMockCss(css:string,id:string):string{
 const sheet=new CSSStyleSheet();sheet.replaceSync(css)
 const render=(rules:CSSRuleList):string=>[...rules].map(rule=>{
  if(rule instanceof CSSStyleRule){
   const selector=rule.selectorText.replace(/(^|[\s,>+~])(?:body|html|:root)(?=$|[\s,.#:[>+~])/g,'$1#'+id)
   return '@scope (#'+id+'){'+selector+'{'+rule.style.cssText+'}}'
  }
  if(rule instanceof CSSMediaRule)return '@media '+rule.conditionText+'{'+render(rule.cssRules)+'}'
  if(rule instanceof CSSSupportsRule)return '@supports '+rule.conditionText+'{'+render(rule.cssRules)+'}'
  throw Error('Unsupported global CSS rule in a focused revision.')
 }).join('')
 return render(sheet.cssRules)
}
export function mergeMockRegion(base:MockBlockPreview,region:NonNullable<ReturnType<typeof focusedMockRegion>>,fragment:DesignMock,draft:MockDraft):DesignMock{
 const old=base.provenance;if(!old)throw Error('Missing base source receipt')
 const doc=new DOMParser().parseFromString(base.document,'text/html'),target=doc.querySelector(region.path)
 if(!target||sha256Hex(target.outerHTML)!==region.hash)throw Error('The marked component changed.')
 const id='one-patch-'+fragment.id.slice(0,8),prefix='--p'+fragment.id.slice(0,6)+'-'
 const names=new Map(draft.tokens.map((t,i)=>[t.name,old.draft.tokens.some(o=>o.name===t.name&&o.value===t.value)?t.name:prefix+i+'-'+t.name.slice(2,40)]))
 const rename=(s:string)=>s.replace(/--[a-z][a-z0-9-]*/g,n=>names.get(n)??n)
 const container=doc.createElement('div');container.id=id;container.innerHTML=new DOMParser().parseFromString(fragment.document,'text/html').body.innerHTML
 const reqs=[...old.draft.requirements],sourceMap=new Map<string,string>()
 const sources=old.sources.map(s=>({...s,id:'old-'+s.id}));const oldCitation=<T extends MockCitation>(c:T):T=>({...c,source:'old-'+c.source})
 for(const s of fragment.sources){const match=sources.find(o=>o.url===s.url&&o.hash===s.hash&&o.stateHash===s.stateHash);sourceMap.set(s.id,match?.id??s.id);if(!match)sources.push(s)}
 const cite=<T extends MockCitation>(c:T):T=>({...c,source:sourceMap.get(c.source)??c.source})
 const requirements=reqs.map(oldCitation)
 draft.requirements.forEach((r,i)=>{const c=cite(r);let at=requirements.findIndex(q=>q.source===c.source&&q.quote===c.quote);if(at<0){at=requirements.length;requirements.push(c)}container.querySelectorAll('[data-requirement]').forEach(el=>el.setAttribute('data-requirement',(el.getAttribute('data-requirement')??'').split(/\s+/).map(v=>v==='R'+(i+1)?'TEMP'+(at+1):v).join(' ')))})
 container.querySelectorAll('[data-requirement]').forEach(el=>el.setAttribute('data-requirement',el.getAttribute('data-requirement')!.replace(/TEMP/g,'R')))
 // Preserve the identity of a replaced instance, including a change of component type.
 const instance=target.getAttribute('data-mock-id'),replacement=container.children.length===1?container.firstElementChild:null
 if(instance&&replacement)replacement.setAttribute('data-mock-id',instance)
 const instanceIds=new Set<string>()
 for(const el of [...doc.querySelectorAll('[data-mock-id]')].filter(e=>!target.contains(e)).concat([...container.querySelectorAll('[data-mock-id]')])){const key=el.getAttribute('data-mock-id')!;if(instanceIds.has(key))throw Error('Duplicate mock instance identity in revision.');instanceIds.add(key)}
 target.replaceWith(container)
 const style=doc.createElement('style');style.textContent='#'+id+'{display:contents;'+draft.tokens.map(t=>names.get(t.name)+':'+(base.colors?.[t.name]??t.value)).join(';')+'}'+scopedMockCss(rename(draft.css),id);doc.head.append(style)
 const used=new Set([...doc.querySelectorAll('[data-ds-component]')].map(e=>e.getAttribute('data-ds-component')))
 const components=[...old.draft.components.map(oldCitation),...draft.components.map(cite)].filter((c,i,all)=>used.has(c.name)&&all.findIndex(q=>q.name===c.name&&q.source===c.source)===i)
 const merged={...old.draft,design:oldCitation(old.draft.design),authority:old.draft.authority?oldCitation(old.draft.authority):null,target:old.draft.target?'old-'+old.draft.target:null,requirements,components,tokens:[...old.draft.tokens.map(oldCitation),...draft.tokens.filter(t=>!old.draft.tokens.some(o=>o.name===names.get(t.name))).map(t=>({...cite(t),name:names.get(t.name)!}))],notes:[...draft.notes,'Gezielte Änderung: '+region.path].slice(0,12)}
 doc.querySelector('meta[name="one-mock-sources"]')?.setAttribute('content',JSON.stringify(sources))
 doc.querySelector('meta[name="one-mock-status"]')?.setAttribute('content','proposal; human review open')
 const document='<!doctype html>'+doc.documentElement.outerHTML
 const result:DesignMock={...fragment,id:old.id,title:base.title,width:base.width,height:base.height,document,htmlHash:sha256Hex(document),sources,draft:merged,target:sources.find(s=>s.id===merged.target)??null,atlasContext:old.atlasContext,atlasDestination:old.atlasDestination??old.atlasSaved,colorAdjustments:base.colors}
 if(document.length>160000||!mockProvenance({...result,document:undefined}))throw Error('Der kombinierte Mock überschreitet die Grenzen für Quellen oder Komponenten. Bitte einen eigenen Mock-Block verwenden.')
 return result
}
