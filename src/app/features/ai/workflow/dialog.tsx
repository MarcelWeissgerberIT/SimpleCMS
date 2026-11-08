import {lazy,Suspense,useSyncExternalStore} from 'react'
let shown=false
const listeners=new Set<()=>void>(),get=()=>shown,subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}}
export function openWorkOverview(){shown=true;listeners.forEach(f=>f())}
export function closeWorkOverview(){shown=false;listeners.forEach(f=>f())}
const Overview=lazy(()=>import('./WorkflowOverview'))
export function WorkOverviewHost(){return useSyncExternalStore(subscribe,get,get)?<Suspense fallback={null}><Overview onClose={closeWorkOverview}/></Suspense>:null}
