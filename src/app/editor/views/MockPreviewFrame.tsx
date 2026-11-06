import type {MockRegion} from '@/shared/ai/mockRegion'
import {captureMockRegion} from '../lib/mockRegionCapture'
import {useEffect,useRef} from 'react'
import type {MockElement} from '@/shared/ai/mockReview'
/** The host handles selection. Imported markup never receives script permission. */
export function MockPreviewFrame({document:html,title,width,height,marking,onSelect,highlight,highlights=[],locate,areaMarking=false,onRegion,region}:{document:string;title:string;width:number;height:number;marking:boolean;areaMarking?:boolean;region?:MockRegion;onRegion?:(region:MockRegion,element:MockElement)=>void;highlight?:string;highlights?:string[];locate?:number;onSelect:(element:MockElement)=>void}){
 const frame=useRef<HTMLIFrameElement>(null),cleanup=useRef<(()=>void)|null>(null)
 const bind=()=>{
  cleanup.current?.();cleanup.current=null
  const doc=frame.current?.contentDocument;if(!doc?.body)return
  const restores:Array<()=>void>=[]
  if(region){
   for(const s of region.scrolls)try{const el=doc.querySelector(s.path);if(el){el.scrollLeft=s.x;el.scrollTop=s.y}}catch{/* Stored selectors are data. */}
   const box=doc.createElement('div');box.dataset.oneRegion='saved';Object.assign(box.style,{position:'absolute',left:region.x+'px',top:region.y+'px',width:region.width+'px',height:region.height+'px',boxSizing:'border-box',border:'3px solid #ff5a00',background:'rgba(255,90,0,.10)',pointerEvents:'none',zIndex:'2147483646'});doc.documentElement.append(box);restores.push(()=>box.remove())
   if(!marking)doc.defaultView?.scrollTo({left:Math.max(0,region.x-(width-region.width)/2),top:Math.max(0,region.y-(height-region.height)/2)})
  }
  for(const path of new Set([...(highlight?[highlight]:[]),...highlights]))try{const el=doc.querySelector(path) as HTMLElement|null;if(el){const outline=el.style.outline,offset=el.style.outlineOffset;el.style.outline='3px solid #ff5a00';el.style.outlineOffset='2px';restores.push(()=>{el.style.outline=outline;el.style.outlineOffset=offset});if(path===highlight&&!marking)el.scrollIntoView({block:'center',inline:'center'})}}catch{/* Stored selectors are data. */}
  const restore=()=>restores.forEach(f=>f())
  if(!marking){cleanup.current=restore;return}
  const body=doc.body,wasInert=body.hasAttribute('inert');body.removeAttribute('inert')
  if(areaMarking&&onRegion){
   const win=doc.defaultView!,surface=doc.createElement('div'),box=doc.createElement('div')
   surface.dataset.oneRegion='capture';Object.assign(surface.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',touchAction:'none',userSelect:'none'})
   Object.assign(box.style,{position:'absolute',display:'none',boxSizing:'border-box',border:'2px solid #ff5a00',background:'rgba(255,90,0,.12)',pointerEvents:'none'});surface.append(box);doc.documentElement.append(surface)
   let start:{x:number;y:number;scrollX:number;scrollY:number}|null=null
   const stop=(e:Event)=>{e.preventDefault();e.stopPropagation()}
   const point=(e:PointerEvent)=>({x:Math.max(0,Math.min(win.innerWidth,e.clientX)),y:Math.max(0,Math.min(win.innerHeight,e.clientY))})
   const rectangle=(e:PointerEvent)=>{const p=point(e);return {x:Math.min(start!.x,p.x)+start!.scrollX,y:Math.min(start!.y,p.y)+start!.scrollY,width:Math.abs(p.x-start!.x),height:Math.abs(p.y-start!.y)}}
   const down=(e:PointerEvent)=>{if(e.button!==0)return;stop(e);start={...point(e),scrollX:win.scrollX,scrollY:win.scrollY};surface.setPointerCapture(e.pointerId)}
   const move=(e:PointerEvent)=>{if(!start)return;stop(e);const r=rectangle(e);Object.assign(box.style,{display:'block',left:(r.x-start.scrollX)+'px',top:(r.y-start.scrollY)+'px',width:r.width+'px',height:r.height+'px'})}
   const cancel=()=>{start=null;box.style.display='none'}
   const up=(e:PointerEvent)=>{if(!start)return;stop(e);const r=rectangle(e);cancel();if(surface.hasPointerCapture(e.pointerId))surface.releasePointerCapture(e.pointerId);if(r.width<4||r.height<4)return
    const region=captureMockRegion(doc,r)
    onRegion(region,{path:'body',tag:'body',text:(body.textContent??'').trim().slice(0,500),component:'',requirement:'',snippet:body.outerHTML.slice(0,2000)})
   }
   const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){stop(e);cancel()}}
   surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',up);surface.addEventListener('pointercancel',cancel);surface.addEventListener('click',stop);surface.addEventListener('wheel',stop,{passive:false});doc.addEventListener('keydown',key,true)
   cleanup.current=()=>{surface.remove();doc.removeEventListener('keydown',key,true);restore();if(wasInert)body.setAttribute('inert','')}
   return
  }
  let outlined:HTMLElement|null=null,oldOutline='',oldOffset=''
  const clear=()=>{if(outlined){outlined.style.outline=oldOutline;outlined.style.outlineOffset=oldOffset;outlined=null}}
  const target=(e:Event)=>{const el=e.target as Element|null;return el?.nodeType===1?(el.closest('svg,select,input,button,textarea,label')??el):null}
  const move=(e:Event)=>{const el=target(e) as HTMLElement|null;if(!el||el===body||el===outlined)return;clear();outlined=el;oldOutline=el.style.outline;oldOffset=el.style.outlineOffset;el.style.outline='2px solid #ff5a00';el.style.outlineOffset='2px'}
  const block=(e:Event)=>{e.preventDefault();e.stopPropagation()}
  const click=(e:Event)=>{block(e);const el=target(e);if(!el||el===body)return;clear();let node:Element|null=el;const parts:string[]=[];while(node&&node!==body&&parts.length<30){const tag=node.tagName.toLowerCase(),siblings=[...(node.parentElement?.children??[])].filter(s=>s.tagName===node!.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement}
   onSelect({path:'body > '+parts.join(' > '),tag:el.tagName.toLowerCase(),text:(el.textContent??'').trim().slice(0,500),component:el.closest('[data-ds-component]')?.getAttribute('data-ds-component')??'',requirement:el.closest('[data-requirement]')?.getAttribute('data-requirement')??'',snippet:el.outerHTML.slice(0,2000)})
  }
  doc.addEventListener('pointermove',move,true);doc.addEventListener('click',click,true);doc.addEventListener('pointerdown',block,true);doc.addEventListener('keydown',block,true);doc.addEventListener('submit',block,true)
  cleanup.current=()=>{clear();restore();if(wasInert)body.setAttribute('inert','');doc.removeEventListener('pointermove',move,true);doc.removeEventListener('click',click,true);doc.removeEventListener('pointerdown',block,true);doc.removeEventListener('keydown',block,true);doc.removeEventListener('submit',block,true)}
 }
 useEffect(()=>{bind();return()=>cleanup.current?.()},[html,marking,onSelect,highlight,highlights,locate,areaMarking,onRegion,region])
 return <iframe ref={frame} title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={0} srcDoc={html} onLoad={bind} style={{width,height,minHeight:320,pointerEvents:'auto'}}/>
}
