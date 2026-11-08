import {teamRequest,useCloud} from '../../cloud'
export function teamScope(){const c=useCloud.getState();return c.active.kind==='cloud'?c.active.id:null}
export function team<T>(ws:string,path:string,method='GET',body?:unknown){return teamRequest<T>(method,`api/workspaces/${encodeURIComponent(ws)}/${path}`,body)}
export interface Review {page_id:string;title?:string;owner_id:string;due_at:number|null;verified_at:number|null;version:number;stale?:boolean;expired?:boolean}
export interface PageReview {review:Review|null;source:{title:string;hash:string};stale:boolean;expired:boolean}
