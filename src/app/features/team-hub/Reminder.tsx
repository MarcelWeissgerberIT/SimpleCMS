import {useEffect} from 'react'
import {useCloud} from '../../cloud'
import {useT} from '../../i18n'
import {team,type Review} from './api'
import {knowledgeReminders} from '../inbox'
export function KnowledgeReminders(){
 const cloud=useCloud(),t=useT(),ws=cloud.active.kind==='cloud'?cloud.active.id:null,user=cloud.user?.id
 useEffect(()=>{if(!ws||!user)return;let live=true;const check=async()=>{try{const r=await team<Review[]>(ws,'knowledge');if(live&&useCloud.getState().active.id===ws)await knowledgeReminders(ws,r.filter(v=>v.owner_id===user&&(v.expired||v.stale)).map(v=>({id:`knowledge:${v.page_id}:${v.version}:${v.stale?'changed':'due'}`,pageId:v.page_id,at:v.due_at??Date.now(),excerpt:t(v.stale?'team.stale':'team.expired')+' · '+v.title})))}catch{/* Cloud errors remain visible in the team hub; never invent a successful review. */}};void check();const timer=setInterval(()=>void check(),300000);return()=>{live=false;clearInterval(timer)}},[ws,user,t])
 return null
}
