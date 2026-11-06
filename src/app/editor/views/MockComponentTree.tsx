import type {MockProvenance} from '@/shared/ai/mockBlockProvenance'
import type {MockElement} from '@/shared/ai/mockReview'
import {useMemo,useState} from 'react'
import {MockPreviewFrame} from './MockPreviewFrame'

type ComponentNode={path:string;name:string;label:string;children:ComponentNode[]}
/** Paths identify instances, including repeated components and unmarked wrapper elements. */
export function mockComponentTree(html:string):ComponentNode[]{
 const doc=new DOMParser().parseFromString(html,'text/html'),roots:ComponentNode[]=[],byElement=new Map<Element,ComponentNode>()
 for(const el of doc.body.querySelectorAll('[data-ds-component]')){
  const name=el.getAttribute('data-ds-component')?.trim();if(!name)continue
  const parts:string[]=[];let current:Element|null=el
  while(current&&current!==doc.body){const siblings=Array.from(current.parentElement!.children).filter(s=>s.tagName===current!.tagName);parts.unshift(current.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(current)+1)+')');current=current.parentElement}
  const label=(el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,90)
  const node:ComponentNode={path:'body > '+parts.join(' > '),name,label,children:[]}
  let parent=el.parentElement;while(parent&&!byElement.has(parent))parent=parent.parentElement
  ;(parent?byElement.get(parent)!.children:roots).push(node);byElement.set(el,node)
 }
 return roots
}

/** Inspection is mounted only inside its own tab; it never intercepts preview clicks. */
export function MockComponentTree({html,title,width,height,de,provenance,onReplace}:{html:string;title:string;width:number;height:number;de:boolean;provenance?:MockProvenance;onReplace?:(element:MockElement)=>void}){
 const nodes=useMemo(()=>mockComponentTree(html),[html]),[selected,setSelected]=useState(''),[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set())
 const [locate,setLocate]=useState(0)
 const el=useMemo(()=>{try{return new DOMParser().parseFromString(html,'text/html').querySelector(selected)}catch{return null}},[html,selected])
 const name=el?.getAttribute('data-ds-component'),citations=provenance?.draft.components.filter(c=>c.name===name)??[]
 const replacement=()=>{if(el)onReplace?.({path:selected,tag:el.tagName.toLowerCase(),text:(el.textContent??'').slice(0,500),component:name??'',requirement:el.getAttribute('data-requirement')??'',snippet:el.outerHTML.slice(0,2000)})}
 const items=(list:ComponentNode[])=>list.map(node=><li key={node.path}>
  <div className="mock-components__row">
   {node.children.length?<button type="button" className="mock-components__toggle" aria-label={(collapsed.has(node.path)?(de?'Aufklappen: ':'Expand: '):(de?'Zuklappen: ':'Collapse: '))+node.name} aria-expanded={!collapsed.has(node.path)} onClick={()=>setCollapsed(previous=>{const next=new Set(previous);if(next.has(node.path))next.delete(node.path);else next.add(node.path);return next})}>{collapsed.has(node.path)?'▸':'▾'}</button>:<span className="mock-components__toggle"/>}
   <button type="button" className="mock-components__item" aria-current={selected===node.path?'true':undefined} onClick={()=>{setSelected(node.path);setLocate(n=>n+1)}}><strong>{node.name}</strong>{node.label&&<small>{node.label}</small>}</button>
  </div>
  {!!node.children.length&&!collapsed.has(node.path)&&<ul>{items(node.children)}</ul>}
 </li>)
 return <section className="mock-components">
  <p className="faint">{de?'Verwendete Komponenten in ihrer Verschachtelung. Ein Klick im Baum zeigt die konkrete Stelle im Mock.':'Used components in their nesting order. Select a tree entry to locate that instance in the mock.'}</p>
  {!nodes.length&&<p>{de?'Diese Vorschau enthält noch keine Komponenten-Markierungen. Nach einer KI-Überarbeitung mit Komponenten-Zuordnung kann hier ihr Baum angezeigt werden.':'This preview has no component markers yet. An AI revision with component annotations can make its tree available here.'}</p>}
  {el&&<section className="mock-component-detail"><h4>{name}</h4>{citations.map((c,i)=>{const source=provenance?.sources.find(s=>s.id===c.source);return <div key={i}>{source&&<a href={source.url} target="_blank" rel="noreferrer">{source.title} · #{source.ref}</a>}<blockquote>{c.quote}</blockquote><details><summary>{de?'Tokens aus derselben Quelle':'Tokens from the same source'}</summary><ul>{provenance?.draft.tokens.filter(t=>t.source===c.source).map(t=><li key={t.name}><code>{t.name}</code>: {t.value}</li>)}</ul></details></div>})}{!citations.length&&<p>{de?'Für diese Instanz ist kein Quellennachweis gespeichert.':'No source receipt is saved for this instance.'}</p>}{el.getAttribute('data-requirement')&&<p>Requirements: {el.getAttribute('data-requirement')}</p>}{onReplace&&<button type="button" className="btn btn--sm" onClick={replacement}>{de?'Alternative im Katalog suchen':'Find catalogue alternative'}</button>}<p className="faint">{de?'Die KI liest passende Katalogeinträge und erstellt einen Austauschvorschlag für diese Instanz.':'AI reads matching catalogue entries and proposes a replacement for this instance.'}</p></section>}<div className="mock-components__layout">
   {!!nodes.length&&<nav aria-label={de?'Verwendete Komponenten':'Used components'}><ul>{items(nodes)}</ul></nav>}
   <div className="mock-block__viewport"><MockPreviewFrame document={html} title={title} width={width} height={height} marking={false} highlight={selected} locate={locate} onSelect={()=>{}}/></div>
  </div>
 </section>
}
