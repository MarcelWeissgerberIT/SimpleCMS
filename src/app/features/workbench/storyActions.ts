import {saveRecords,stamp,writable,sourcePage} from './actions'
import {sanitizeDeskRecords,slideLayouts,type SlideLayout,type StoryFrame} from './model'
import {framesOf,capacity,slideLimit} from './story'
export function addFrame(deskId:string,layout:SlideLayout,cardId?:string){
 const frames=framesOf(sanitizeDeskRecords(writable(deskId).workbenchRecords))
 if(!slideLayouts.includes(layout)||frames.length>=slideLimit)throw Error('Maximum 30 slides.')
 if(cardId){const card=writable(deskId).workbenchRecords?.[cardId];if(card?.type!=='card'||card.removed)throw Error('Statement unavailable.');sourcePage(deskId,card.source.pageId)}
 const id=crypto.randomUUID();saveRecords(deskId,[{type:'slide',id,...stamp(),layout,title:'',caption:'',metric:'',cards:cardId?[cardId]:[],order:(frames.at(-1)?.order??-1)+1}]);return id
}
export function updateFrame(deskId:string,id:string,patch:Partial<Pick<StoryFrame,'title'|'caption'|'metric'|'cards'|'content'|'removed'>>){
 const records=sanitizeDeskRecords(writable(deskId).workbenchRecords),frame=records[id]
 if(frame?.type!=='slide'||frame.removed)return
 if(patch.cards){if(patch.cards.length>capacity(frame.layout))return;for(const cid of patch.cards){const c=records[cid];if(c?.type!=='card'||c.removed)return;sourcePage(deskId,c.source.pageId)}}
 saveRecords(deskId,[{...frame,...patch,...(patch.cards&&frame.content?{content:frame.content.filter(c=>patch.cards!.includes(c.card))}:{}),...stamp()}],{[id]:JSON.stringify(frame)})
}
export function moveFrame(deskId:string,id:string,beforeId:string){
 const frames=framesOf(sanitizeDeskRecords(writable(deskId).workbenchRecords)),frame=frames.find(f=>f.id===id)
 if(!frame||id===beforeId)return
 const ordered=frames.filter(f=>f.id!==id),to=ordered.findIndex(f=>f.id===beforeId);ordered.splice(to<0?ordered.length:to,0,frame)
 saveRecords(deskId,ordered.map((f,i)=>({...f,order:i,...stamp()})),Object.fromEntries(frames.map(f=>[f.id,JSON.stringify(f)])))
}
