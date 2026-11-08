import {KnowledgeReminders} from './Reminder'
import {lazy,Suspense,useSyncExternalStore} from 'react'
let shown=false
const listeners=new Set<()=>void>()
const subscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}}
export function openTeamHub(){shown=true;listeners.forEach(f=>f())}
function close(){shown=false;listeners.forEach(f=>f())}
const Hub=lazy(()=>import('./TeamHub'))
export function TeamHubHost(){const open=useSyncExternalStore(subscribe,()=>shown,()=>false);return <><KnowledgeReminders/>{open&&<Suspense fallback={null}><Hub onClose={close}/></Suspense>}</>}
export {KnowledgePageControl} from './Knowledge'

export {CompanySignIn,ConnectedCalendars} from './Company'
