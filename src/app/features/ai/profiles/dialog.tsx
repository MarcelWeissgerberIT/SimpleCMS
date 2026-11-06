import {lazy,Suspense,useSyncExternalStore} from 'react'
let open=false
const listeners=new Set<()=>void>(),subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},get=()=>open
export function openReviewProfiles(){open=true;listeners.forEach(f=>f())}
export function closeReviewProfiles(){open=false;listeners.forEach(f=>f())}
const Dialog=lazy(()=>import('./ReviewProfilesDialog'))
export function ReviewProfilesHost(){const value=useSyncExternalStore(subscribe,get,get);return value?<Suspense fallback={null}><Dialog/></Suspense>:null}
