import {addInboxItems,useInbox,type InboxItem} from './state'
/** Do not reset a read or archived reminder when the next periodic check sees it again. */
export async function knowledgeReminders(workspaceId:string,items:Array<Omit<InboxItem,'kind'>>){
 const ws='cloud:'+workspaceId,state=useInbox.getState();if(state.ws!==ws||!state.loaded)return
 const seen=new Set(state.data.items.map(i=>i.id));await addInboxItems(ws,items.filter(i=>!seen.has(i.id)).map(i=>({...i,kind:'reminder'})))
}
