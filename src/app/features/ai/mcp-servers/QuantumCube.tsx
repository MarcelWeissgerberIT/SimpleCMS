import {cubeRelations} from '@/shared/quandprofile/cube-relations'
import {useLayoutEffect,useRef,useState} from 'react'
import {RotateCcw,RotateCw} from 'lucide-react'
import type {QuantumStatus} from '@/shared/quandprofile/runtime'
import {useT} from '../../../i18n'

type Point=[number,number,number]
export type CubeReference={key:string;id?:string;label:string;dimensions:string[];status:QuantumStatus}
type Face={points:Point[];kind:'glass'|'nucleus'|'evidence';depth:number;reference?:CubeReference}
const slots:Point[]=[[170,90,-50],[225,-15,40],[145,-115,-50],[-215,75,65],[-215,-65,-40],[15,125,65],[0,-130,45],[230,100,65],[70,-110,-80],[-210,-135,130],[160,140,130],[320,0,-40],[-320,0,-40]]
const positionFor=(i:number):Point=>slots[i]??[Math.cos(i*2.4)*240,Math.sin(i*2.4)*130,(i%3-1)*80]
const center:Point=[-65,0,0]
/** Schematic projection of recorded dimension membership. Geometry encodes no confidence or physical quantum state. */
export function QuantumCube({dimensions,selected,onSelect,label,references=[],coreId,emptyLabel}:{dimensions:string[];selected:string;onSelect:(id:string)=>void;label:string;references?:CubeReference[];coreId?:string;emptyLabel?:string}){
  const t=useT(),ref=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null)
  const [width,setWidth]=useState(600),[angle,setAngle]=useState({yaw:-.48,pitch:.35})
  const [focus,setFocus]=useState('')
  const dimension=dimensions.includes(selected)?selected:dimensions[0]??''
  const related=references.map((reference,index)=>({reference,index,position:positionFor(index)})).filter(({reference})=>reference.dimensions.includes(dimension))
  const edges=cubeRelations(references.map(r=>r.key)),seeds=new Set(related.map(r=>r.reference.key))
  const activeEdges=edges.filter(e=>seeds.has(e.from)||seeds.has(e.to))
  const peerKeys=new Set(activeEdges.flatMap(e=>[e.from,e.to]).filter(k=>!seeds.has(k)))
  const peers=references.map((reference,index)=>({reference,index,position:positionFor(index)})).filter(r=>peerKeys.has(r.reference.key))
  const pick=(key:string)=>{const r=references.find(r=>r.key===key);if(r){setFocus(key);onSelect(r.dimensions.includes(dimension)?dimension:r.dimensions[0])}}
  useLayoutEffect(()=>{const svg=ref.current;if(!svg)return;const ro=new ResizeObserver(()=>setWidth(Math.max(180,svg.getBoundingClientRect().width)));ro.observe(svg);return()=>ro.disconnect()},[])
  const height=320,cx=width/2,cy=height/2
  const vertices=(at:Point,size:number):Point[]=>{const d=size/2;return [[-d,-d,-d],[d,-d,-d],[d,d,-d],[-d,d,-d],[-d,-d,d],[d,-d,d],[d,d,d],[-d,d,d]].map(v=>v.map((n,i)=>n+at[i]) as Point)}
  // Plane identity and the full scene bounds stay independent of the selected dimension.
  const plane=(index:number):Point[]=>{const a=index*Math.PI/Math.max(dimensions.length,1),c=Math.cos(a),s=Math.sin(a);return [[-215,-125],[215,-125],[215,125],[-215,125]].map(([x,y])=>[center[0]+x*c,y,x*s] as Point)}
  const rawProject=([vx,vy,vz]:Point)=>{
    const x=vx*Math.cos(angle.yaw)+vz*Math.sin(angle.yaw),z=-vx*Math.sin(angle.yaw)+vz*Math.cos(angle.yaw),y=vy*Math.cos(angle.pitch)-z*Math.sin(angle.pitch),depth=vy*Math.sin(angle.pitch)+z*Math.cos(angle.pitch),f=1000/(1000-depth)
    return {x:x*f,y:-y*f,z:depth}
  }
  const bounds=[...vertices(center,138),...dimensions.flatMap((_,i)=>plane(i)),...references.flatMap((_,i)=>vertices(positionFor(i),42))].map(rawProject)
  const scale=Math.min(1,(width-32)/(2*Math.max(1,...bounds.map(p=>Math.abs(p.x)))),(height-32)/(2*Math.max(1,...bounds.map(p=>Math.abs(p.y)))))
  const project=(point:Point)=>{const p=rawProject(point);return {x:cx+p.x*scale,y:cy+p.y*scale,z:p.z}}
  const path=(points:Point[],close=false)=>points.map((v,i)=>{const p=project(v);return `${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`}).join(' ')+(close?' Z':'')
  const faces:Face[]=[]
  const cube=(at:Point,size:number,kind:Face['kind'],reference?:CubeReference)=>{
    const corners=vertices(at,size)
    for(const indices of [[0,1,2,3],[4,5,6,7],[0,4,7,3],[1,5,6,2],[3,2,6,7],[0,1,5,4]]){
      const points=indices.map(i=>corners[i]);faces.push({points,kind,reference,depth:points.reduce((sum,v)=>sum+project(v).z,0)/4})
    }
  }
  cube(center,138,'glass');cube(center,40,'nucleus')
  for(const {reference,position} of [...related,...peers])cube(position,42,'evidence',reference)
  faces.sort((a,b)=>a.depth-b.depth)
  return <div className="quantum-cube" data-dimension={dimension} data-focused-reference={focus||undefined}>
    <div className="quantum-cube__caption"><span className="label">{t('features.ai.quantum.core')}{coreId&&<code title={coreId}> · {coreId.slice(0,12)}</code>}</span><span className="label">{t('features.ai.quantum.dimension.'+dimension)} · {related.length} {t('features.ai.quantum.references')}</span></div>
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={label+' · '+t('features.ai.quantum.dimension.'+dimension)} onPointerDown={e=>{if(e.pointerType==='touch')return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,...angle}}} onPointerMove={e=>{const start=drag.current;if(start)setAngle({yaw:Math.max(-1,Math.min(.4,start.yaw+(e.clientX-start.x)/220)),pitch:Math.max(.12,Math.min(.7,start.pitch+(e.clientY-start.y)/350))})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      {dimensions.map((d,i)=><path key={d} className="quantum-cube__plane" data-dimension={d} data-selected={d===dimension} d={path(plane(i),true)}/>)}
      {peers.map(({reference,position})=><path key={reference.key} className="quantum-cube__counter-binding" data-reference={reference.key} d={path([position,center])}/>)}
      {activeEdges.map(edge=>{const a=references.findIndex(r=>r.key===edge.from),b=references.findIndex(r=>r.key===edge.to);return <path key={edge.from+edge.to} className="quantum-cube__edge" data-focused={edge.from===focus||edge.to===focus} d={path([positionFor(a),positionFor(b)])}><title>{t('features.ai.cube.edge.'+edge.label)}</title></path>})}
      {related.map(({reference,position})=><path key={reference.key} className="quantum-cube__binding" data-reference={reference.key} data-status={reference.status} d={path([position,center])}/>)}
      {faces.map((face,i)=><path key={i} className={'quantum-cube__'+face.kind} data-reference={face.reference?.key} data-quantum-id={face.reference?.id} data-status={face.reference?.status} data-focused={face.reference?.key===focus} data-counterpart={!!face.reference&&peerKeys.has(face.reference.key)} d={path(face.points,true)}/>)}
      {[...related,...peers].map(({reference,index,position})=>{const p=project(position);return <text key={reference.key} className="quantum-cube__number" x={p.x} y={p.y+4} textAnchor="middle">{String(index+1).padStart(2,'0')}</text>})}
    </svg>
    <div className="quantum-cube__controls"><span>{t('features.ai.quantum.schematic')}</span><button type="button" className="icon-btn" aria-label={t('features.ai.quantum.rotateLeft')} onClick={()=>setAngle(a=>({...a,yaw:Math.max(-1,a.yaw-.2)}))}><RotateCcw size={16}/></button><button type="button" className="icon-btn" aria-label={t('features.ai.quantum.rotateRight')} onClick={()=>setAngle(a=>({...a,yaw:Math.min(.4,a.yaw+.2)}))}><RotateCw size={16}/></button></div>
    <div className="quantum-inspector__dimensions" role="group" aria-label={t('features.ai.quantum.dimensions')}>
      {dimensions.map(d=><button type="button" key={d} className="btn btn--sm" aria-pressed={dimension===d} onClick={()=>{setFocus('');onSelect(d)}}>{t('features.ai.quantum.dimension.'+d)}</button>)}
    </div>
    <div className="quantum-cube__relations" aria-live="polite">
      {related.length?<ul>{related.map(({reference,index})=><li key={reference.key} data-reference={reference.key} data-status={reference.status}><span className="label">{String(index+1).padStart(2,'0')}</span><span><button type="button" className="quantum-cube__legend-button" aria-pressed={focus===reference.key} onClick={()=>pick(reference.key)}>{reference.label}</button><small>{t('features.ai.quantum.status.'+reference.status)} · {reference.id?<code title={reference.id}>{reference.id.slice(0,12)}</code>:t('features.ai.quantum.noQuantum')}</small></span></li>)}</ul>:<p>{emptyLabel??t('features.ai.quantum.noReferences')}</p>}
    </div>
    <details className="quantum-cube__links" open={!!focus}>
      <summary>{t('features.ai.cube.legend')} · {activeEdges.length}</summary>
      <p>{t('features.ai.cube.legendHelp')}</p>
      <ul>{activeEdges.map(edge=>{const from=references.find(r=>r.key===edge.from)!,to=references.find(r=>r.key===edge.to)!;return <li key={edge.from+edge.to} data-focused={edge.from===focus||edge.to===focus}><span className="label">{t('features.ai.cube.'+edge.kind)}</span><strong>{t('features.ai.cube.edge.'+edge.label)}</strong><div><button type="button" onClick={()=>pick(from.key)}>{from.label}<small>{from.dimensions.map(d=>t('features.ai.quantum.dimension.'+d)).join(' · ')}</small></button><span aria-hidden>↔</span><button type="button" onClick={()=>pick(to.key)}>{to.label}<small>{to.dimensions.map(d=>t('features.ai.quantum.dimension.'+d)).join(' · ')}</small></button></div></li>})}</ul>
      {!activeEdges.length&&<p>{t('features.ai.cube.noEdges')}</p>}
    </details>
  </div>
}
