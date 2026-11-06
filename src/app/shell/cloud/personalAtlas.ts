/** Account-bound, device-only Atlas credential reuse. Never workspace content, export or model context. */
import {createStore,get,set,del} from 'idb-keyval'
import {sealSecret,openSecret,clearSecret} from '../../lib/vault'
import {useCloud} from '../../cloud'
const db=createStore('one-personal-atlas','kv')
const endpoint='https://aj-atlas.com/api/atlas/mcp'
type Saved={person:string;url:string;at:number}
const scope=(user:string)=>'personal-atlas:'+user
const key=(user:string)=>user+'|'+endpoint
const allowed=(user:string,url:string)=>useCloud.getState().active.kind==='cloud'&&useCloud.getState().user?.id===user&&url===endpoint
export async function savedPersonalAtlas(user:string,url:string):Promise<Saved|null>{
 if(!allowed(user,url))return null
 const value=await get<Saved>(key(user),db)
 return allowed(user,url)&&value?.url===endpoint?value:null
}
export async function rememberPersonalAtlas(user:string,url:string,token:string,person:string){
 if(!allowed(user,url)||!token||!person.trim())throw Error('Personal Atlas scope changed')
 await sealSecret('atlas-token',token,scope(user));if(!allowed(user,url)){await clearSecret('atlas-token',scope(user));throw Error('Personal Atlas account changed')}
 await set(key(user),{person:person.slice(0,160),url: endpoint,at:Date.now()} satisfies Saved,db)
}
export async function reusePersonalAtlas(user:string,url:string){
 if(!allowed(user,url)||!await savedPersonalAtlas(user,url))throw Error('No personal Atlas access for this account and endpoint')
 const token=await openSecret('atlas-token',scope(user));if(!allowed(user,url)||!token)throw Error('Saved Atlas access is unavailable; enter your own token again')
 return token
}
export async function forgetPersonalAtlas(user:string,url:string){
 if(!allowed(user,url))throw Error('Personal Atlas account changed')
 await clearSecret('atlas-token',scope(user));await del(key(user),db)
}
