import {SkillsHost} from '../skills/dialog'
import {ReviewProfilesHost} from '../profiles/dialog'
import {lazy,Suspense,useSyncExternalStore} from 'react'
import type {ProgramSpec} from '@/shared/quandprofile/program'
let value:{draft?:ProgramSpec;seq:number}|null=null,seq=0
const listeners=new Set<()=>void>(),subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},get=()=>value
export function openPrograms(draft?:ProgramSpec){value={draft,seq:++seq};listeners.forEach(f=>f())}
export function closePrograms(){value=null;listeners.forEach(f=>f())}
const Dialog=lazy(()=>import('./ProgramsDialog'))
export function CompiledProgramsHost(){const v=useSyncExternalStore(subscribe,get,get);return <><SkillsHost/><ReviewProfilesHost/>{v?<Suspense fallback={null}><Dialog key={v.seq} draft={v.draft}/></Suspense>:null}</>}
