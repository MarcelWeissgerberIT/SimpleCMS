import {lazy,Suspense,useSyncExternalStore} from 'react'
import type {Skill} from '@/shared/ai/skills'
let value:{use:(skill:Skill)=>void;seq:number;query:string}|null=null,seq=0
const listeners=new Set<()=>void>(),subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},get=()=>value
export const useSkillsOpen=()=>!!useSyncExternalStore(subscribe,get,get)
export function openSkills(use:(skill:Skill)=>void,query=''){value={use,seq:++seq,query};listeners.forEach(f=>f())}
export function closeSkills(){value=null;listeners.forEach(f=>f())}
const Dialog=lazy(()=>import('./SkillsDialog'))
export function SkillsHost(){const v=useSyncExternalStore(subscribe,get,get);return v?<Suspense fallback={null}><Dialog key={v.seq} onUse={v.use} initialQuery={v.query}/></Suspense>:null}
