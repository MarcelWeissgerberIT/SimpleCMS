import {useId,useLayoutEffect,useRef,useState} from 'react'
import {RotateCcw,RotateCw} from 'lucide-react'
import {useT} from '../../../i18n'

type Point=[number,number,number]
type Face={points:Point[];kind:'glass'|'nucleus'|'evidence';depth:number}
/** Perspective is schematic. Size and distance encode no confidence, score or physical quantum state. */
export function QuantumCube({dimensions,selected,onSelect,label}:{dimensions:string[];selected:string;onSelect:(id:string)=>void;label:string}){
  const t=useT(),id=useId(),ref=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null)
  const [width,setWidth]=useState(600),[angle,setAngle]=useState({yaw:-.48,pitch:.35})
  useLayoutEffect(()=>{const svg=ref.current;if(!svg)return;const ro=new ResizeObserver(()=>setWidth(Math.max(180,svg.getBoundingClientRect().width)));ro.observe(svg);return()=>ro.disconnect()},[])
  const height=280,scale=Math.min(width/640,1),cx=width/2,cy=height/2
  const project=([vx,vy,vz]:Point)=>{
    const x=vx*Math.cos(angle.yaw)+vz*Math.sin(angle.yaw),z=-vx*Math.sin(angle.yaw)+vz*Math.cos(angle.yaw),y=vy*Math.cos(angle.pitch)-z*Math.sin(angle.pitch),depth=vy*Math.sin(angle.pitch)+z*Math.cos(angle.pitch),f=1000/(1000-depth)
    return {x:cx+x*scale*f,y:cy-y*scale*f,z:depth}
  }
  const path=(points:Point[],close=false)=>points.map((v,i)=>{const p=project(v);return `${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`}).join(' ')+(close?' Z':'')
  const faces:Face[]=[]
  const cube=(center:Point,size:number,kind:Face['kind'])=>{
    const d=size/2,vertices:Point[]=[[-d,-d,-d],[d,-d,-d],[d,d,-d],[-d,d,-d],[-d,-d,d],[d,-d,d],[d,d,d],[-d,d,d]].map(v=>v.map((n,i)=>n+center[i]) as Point)
    for(const indices of [[0,1,2,3],[4,5,6,7],[0,4,7,3],[1,5,6,2],[3,2,6,7],[0,1,5,4]]){
      const points=indices.map(i=>vertices[i]);faces.push({points,kind,depth:points.reduce((sum,v)=>sum+project(v).z,0)/4})
    }
  }
  cube([-35,0,0],148,'glass');cube([-35,0,0],46,'nucleus');cube([205,60,-15],66,'evidence')
  faces.sort((a,b)=>a.depth-b.depth)
  const planes:Point[][]=[[[0,-150,-125],[0,150,-125],[0,150,125],[0,-150,125]],[[-210,0,-125],[240,0,-125],[240,0,125],[-210,0,125]],[[-210,-150,0],[240,-150,0],[240,150,0],[-210,150,0]]]
  return <div className="quantum-cube">
    <div className="quantum-cube__caption"><span className="label">{t('features.ai.quantum.core')}</span><span className="label">{t('features.ai.quantum.evidence')}</span></div>
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-labelledby={id} onPointerDown={e=>{if(e.pointerType==='touch')return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,...angle}}} onPointerMove={e=>{const start=drag.current;if(start)setAngle({yaw:Math.max(-1,Math.min(.4,start.yaw+(e.clientX-start.x)/220)),pitch:Math.max(.12,Math.min(.7,start.pitch+(e.clientY-start.y)/350))})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      <title id={id}>{label}</title>
      {dimensions.slice(0,3).map((dimension,i)=><path key={dimension} className="quantum-cube__plane" data-selected={dimension===selected} d={path(planes[i],true)}/>)}
      <path className="quantum-cube__binding" d={path([[205,60,-15],[70,15,0],[-35,0,0]])}/>
      {faces.map((face,i)=><path key={i} className={'quantum-cube__'+face.kind} d={path(face.points,true)}/>)}
    </svg>
    <div className="quantum-cube__controls"><span>{t('features.ai.quantum.schematic')}</span><button type="button" className="icon-btn" aria-label={t('features.ai.quantum.rotateLeft')} onClick={()=>setAngle(a=>({...a,yaw:Math.max(-1,a.yaw-.2)}))}><RotateCcw size={16}/></button><button type="button" className="icon-btn" aria-label={t('features.ai.quantum.rotateRight')} onClick={()=>setAngle(a=>({...a,yaw:Math.min(.4,a.yaw+.2)}))}><RotateCw size={16}/></button></div>
    <div className="quantum-inspector__dimensions" role="group" aria-label={t('features.ai.quantum.dimensions')}>
      {dimensions.map(d=><button type="button" key={d} className="btn btn--sm" aria-pressed={selected===d} onClick={()=>onSelect(d)}>{t('features.ai.quantum.dimension.'+d)}</button>)}
    </div>
  </div>
}
