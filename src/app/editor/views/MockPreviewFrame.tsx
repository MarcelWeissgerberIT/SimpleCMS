import {useEffect,useRef} from 'react'
import type {MockElement} from '@/shared/ai/mockReview'
/** The host handles selection. Imported markup never receives script permission. */
export function MockPreviewFrame({document:html,title,width,height,marking,onSelect,highlight}:{document:string;title:string;width:number;height:number;marking:boolean;highlight?:string;onSelect:(element:MockElement)=>void}){
 const frame=useRef<HTMLIFrameElement>(null),cleanup=useRef<(()=>void)|null>(null)
 const bind=()=>{
  cleanup.current?.();cleanup.current=null
  const doc=frame.current?.contentDocument;if(!doc?.body)return
  if(!marking){if(highlight)try{const el=doc.querySelector(highlight) as HTMLElement|null;if(el){el.style.outline='3px solid #ff5a00';el.style.outlineOffset='2px';el.scrollIntoView({block:'center'})}}catch{/* Stored selectors are data, never executable. */}return}
  const body=doc.body,wasInert=body.hasAttribute('inert');body.removeAttribute('inert')
  let outlined:HTMLElement|null=null,oldOutline='',oldOffset=''
  const clear=()=>{if(outlined){outlined.style.outline=oldOutline;outlined.style.outlineOffset=oldOffset;outlined=null}}
  const target=(e:Event)=>{const el=e.target as Element|null;return el?.nodeType===1?(el.closest('svg,select,input,button,textarea,label')??el):null}
  const move=(e:Event)=>{const el=target(e) as HTMLElement|null;if(!el||el===body||el===outlined)return;clear();outlined=el;oldOutline=el.style.outline;oldOffset=el.style.outlineOffset;el.style.outline='2px solid #ff5a00';el.style.outlineOffset='2px'}
  const block=(e:Event)=>{e.preventDefault();e.stopPropagation()}
  const click=(e:Event)=>{block(e);const el=target(e);if(!el||el===body)return;clear();let node:Element|null=el;const parts:string[]=[];while(node&&node!==body&&parts.length<30){const tag=node.tagName.toLowerCase(),siblings=[...(node.parentElement?.children??[])].filter(s=>s.tagName===node!.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement}
   onSelect({path:'body > '+parts.join(' > '),tag:el.tagName.toLowerCase(),text:(el.textContent??'').trim().slice(0,500),component:el.closest('[data-ds-component]')?.getAttribute('data-ds-component')??'',requirement:el.closest('[data-requirement]')?.getAttribute('data-requirement')??'',snippet:el.outerHTML.slice(0,2000)})
  }
  doc.addEventListener('pointermove',move,true);doc.addEventListener('click',click,true);doc.addEventListener('pointerdown',block,true);doc.addEventListener('keydown',block,true);doc.addEventListener('submit',block,true)
  cleanup.current=()=>{clear();if(wasInert)body.setAttribute('inert','');doc.removeEventListener('pointermove',move,true);doc.removeEventListener('click',click,true);doc.removeEventListener('pointerdown',block,true);doc.removeEventListener('keydown',block,true);doc.removeEventListener('submit',block,true)}
 }
 useEffect(()=>{bind();return()=>cleanup.current?.()},[html,marking,onSelect,highlight])
 return <iframe ref={frame} title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={marking?0:-1} srcDoc={html} onLoad={bind} style={{width,height,minHeight:320,pointerEvents:marking?'auto':'none'}}/>
}
