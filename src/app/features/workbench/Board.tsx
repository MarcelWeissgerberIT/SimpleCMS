import {useRef,useState,useEffect} from 'react'
import {SOURCE_DRAG,CARD_DRAG,QUESTION_DRAG,type Point} from './drag'
import {useLang} from '../../i18n'
import {levels,levelsEn,type Card,type Link} from './model'
export function Board({cards,links,resolvedIds,size,selected,readOnly,onSelect,onOpen,onMove,onDropOverview,onDropSource,onDropQuestion,onConnect}:{onConnect:(a:string,b:string)=>void;cards:Card[];links:Link[];resolvedIds:string[];size:number;selected:string[];readOnly:boolean;onSelect:(id:string)=>void;onOpen:(id:string)=>void;onMove:(id:string,x:number,y:number)=>void;onDropOverview:(pageId:string,itemId:string,point:Point)=>void;onDropSource:(token:string,point:Point)=>void;onDropQuestion:(id:string)=>void}){
 const de=useLang()==='de',scale=(Math.max(44,size)+24)/280,host=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number}|null>(null)
 const width=Math.max(320,...cards.map(c=>c.x*scale+Math.max(44,size)+32)),height=Math.max(300,...cards.map(c=>c.y*scale+Math.max(44,size)+80+links.length*24)),byId=new Map(cards.map(c=>[c.id,c]))
 const suppressWireClick=useRef(false)
 const wireDrag=useRef<{id:string;x:number;y:number;moved:boolean}|null>(null)
 const [over,setOver]=useState(false),[connecting,setConnecting]=useState(''),[target,setTarget]=useState(''),[pointer,setPointer]=useState<{x:number;y:number}|null>(null)
 const finish=(id:string)=>{if(connecting&&connecting!==id)onConnect(connecting,id);setConnecting('');setPointer(null);setTarget('')}
 useEffect(()=>{const end=()=>{setOver(false);setConnecting('');setPointer(null);setTarget('')};window.addEventListener('dragend',end);return()=>window.removeEventListener('dragend',end)},[])
 const accepts=(types:readonly string[])=>types.some(t=>[CARD_DRAG,SOURCE_DRAG,QUESTION_DRAG,'application/x-one-overview'].includes(t))
 return <div className="wb-map" data-drop-active={over} ref={host} aria-label={de?'Kartenlandkarte':'Card map'} onDragOver={e=>{if(!readOnly&&accepts(e.dataTransfer.types)){e.preventDefault();e.dataTransfer.dropEffect=e.dataTransfer.types.includes(CARD_DRAG)?'move':'copy';setOver(true)}}} onKeyDown={e=>{if(e.key==='Escape'){wireDrag.current=null;setConnecting('');setPointer(null);setTarget('')}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(false)}} onDrop={e=>{
  setOver(false);if(readOnly||!accepts(e.dataTransfer.types))return;e.preventDefault();e.stopPropagation()
  const id=e.dataTransfer.getData(CARD_DRAG),r=e.currentTarget.getBoundingClientRect(),offset=byId.has(id)?drag.current:null
  const point={x:Math.max(0,(e.clientX-r.left+e.currentTarget.scrollLeft-16-(offset?.x??0))/scale),y:Math.max(0,(e.clientY-r.top+e.currentTarget.scrollTop-16-(offset?.y??0))/scale)}
  if(byId.has(id)){onMove(id,point.x,point.y);return}
  const question=e.dataTransfer.getData(QUESTION_DRAG);if(question){onDropQuestion(question);return}
  const token=e.dataTransfer.getData(SOURCE_DRAG);if(token){onDropSource(token,point);return}
  try{const v=JSON.parse(e.dataTransfer.getData('application/x-one-overview'));if(typeof v.pageId==='string'&&typeof v.itemId==='string')onDropOverview(v.pageId,v.itemId,point)}catch{}
 }}>
  {connecting&&<div className="wb-wire-hint" role="status">{de?'Anschluss der zweiten Karte wählen · Esc zum Abbrechen':'Choose the second card’s connector · Esc to cancel'}</div>}
  {!cards.length&&<div className="wb-board-empty"><span aria-hidden="true">＋</span><strong>{de?'Deine Arbeitsfläche':'Your workspace'}</strong><p>{de?'Ziehe eine Aussage aus den Quellen hierher.':'Drag a statement from the sources here.'}</p></div>}
  <div className="wb-world" style={{width,height}}>
   <svg className="wb-threads" width={width} height={height} aria-hidden="true">{links.map((l,i)=>{const a=byId.get(l.a),b=byId.get(l.b);if(!a||!b)return null;const ax=a.x*scale+Math.max(size,44)+16,ay=a.y*scale+Math.max(size,44)/2+16,bx=b.x*scale+16,by=b.y*scale+Math.max(size,44)/2+16,bend=bx>ax?Math.min(24,(bx-ax)/3):24,route=Math.max(ay,by)+Math.max(size,44)/2+40+i*24;return <g key={l.id} data-relation={l.relation} data-resolved={resolvedIds.includes(l.id)}><path d={`M${ax},${ay} C${ax+bend},${ay} ${ax+bend},${route} ${ax+bend},${route} L${bx-bend},${route} C${bx-bend},${route} ${bx-bend},${by} ${bx},${by}`}/><path d={`M${bx-6},${by-4} L${bx},${by} L${bx-6},${by+4}`}/><text x={(ax+bx)/2} y={route-8} textAnchor="middle">{(de?{supports:'stützt',conflict:'Widerspruch?',depends:'hängt ab'}:{supports:'supports',conflict:'conflict?',depends:'depends on'})[l.relation]}</text></g>})}{connecting&&pointer&&byId.has(connecting)&&<path className="wb-wire-preview" d={`M${byId.get(connecting)!.x*scale+Math.max(size,44)+16},${byId.get(connecting)!.y*scale+Math.max(size,44)/2+16} L${pointer.x},${pointer.y}`}/>}</svg>
   {cards.map((c,i)=><div key={c.id} className="wb-map-card" style={{left:c.x*scale+16,top:c.y*scale+16,width:Math.max(size,44),minHeight:Math.max(size,44)}}>
    <button className="wb-card-hit" style={{width:Math.max(44,size),height:Math.max(44,size)}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)} draggable={!readOnly} aria-label={`${c.title} · ${(de?levels:levelsEn)[c.level]}`} title={c.title} onDragStart={e=>{const r=e.currentTarget.getBoundingClientRect();drag.current={x:e.clientX-r.left,y:e.clientY-r.top};e.dataTransfer.setData(CARD_DRAG,c.id);e.dataTransfer.effectAllowed='move'}} onDragEnd={()=>setOver(false)} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.altKey&&!readOnly&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();onMove(c.id,Math.max(0,c.x+(e.key==='ArrowRight'?280:e.key==='ArrowLeft'?-280:0)),Math.max(0,c.y+(e.key==='ArrowDown'?280:e.key==='ArrowUp'?-280:0)))}}}>
     <span className="wb-card" style={{width:size,height:size}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)}>
     {size>=32&&<span className="wb-number">{String(i+1).padStart(2,'0')}</span>}{size>=64&&<strong>{c.title}</strong>}{size>=256&&<span className="wb-card-context">{c.detail}</span>}{size>=128&&<small>{c.group||(de?levels:levelsEn)[c.level]}</small>}
     </span>
    </button>
    {!readOnly&&size>=64&&<><button className="wb-port wb-port-in" data-connect-target={c.id} data-active={target===c.id} aria-label={(de?'Verbinden mit: ':'Connect to: ')+c.title} title={de?'Verbindung hier ablegen':'Drop connection here'} onClick={()=>finish(c.id)}>●</button><button className="wb-port wb-port-out" data-active={connecting===c.id} aria-label={(de?'Verbindung starten: ':'Start connection: ')+c.title} title={de?'Zur anderen Karte ziehen oder klicken':'Drag to another card or click'}
     onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus({preventScroll:true});wireDrag.current={id:c.id,x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);setConnecting(c.id)}}
     onPointerMove={e=>{const d=wireDrag.current,r=host.current?.getBoundingClientRect();if(!d||!r)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5)d.moved=true;if(d.moved){setPointer({x:e.clientX-r.left+host.current!.scrollLeft,y:e.clientY-r.top+host.current!.scrollTop});setTarget(document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-connect-target]')?.getAttribute('data-connect-target')??'')}}}
     onPointerUp={e=>{const d=wireDrag.current;if(!d)return;if(d.moved){const to=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-connect-target]')?.getAttribute('data-connect-target');if(to&&byId.has(to)&&to!==d.id)onConnect(d.id,to);setConnecting('')}suppressWireClick.current=d.moved;wireDrag.current=null;setPointer(null);setTarget('');e.currentTarget.releasePointerCapture(e.pointerId)}}
     onPointerCancel={()=>{wireDrag.current=null;setConnecting('');setPointer(null);setTarget('')}}
     onClick={()=>{if(suppressWireClick.current){suppressWireClick.current=false;return}setConnecting(c.id)}}>＋</button></>}
    <input className="wb-card-pick" type="checkbox" aria-label={(de?'Auswählen: ':'Select: ')+c.title} checked={selected.includes(c.id)} onChange={()=>onSelect(c.id)}/>
   </div>)}
  </div>
 </div>
}
