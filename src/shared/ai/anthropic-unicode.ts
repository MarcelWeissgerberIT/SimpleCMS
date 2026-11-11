import type {Middleware} from '@anthropic-ai/sdk'

/** JSON.stringify escapes lone UTF-16 surrogates, but Claude rejects those
 * escapes. Repair decoded string values only, including old tool receipts.
 * Unicode mode preserves intact pairs; literal backslash-u text stays literal.
 * Source documents and the conversation itself are never mutated. */
export const claudeUnicodeMiddleware:Middleware=async(request,next)=>{
 if(typeof request.body==='string'&&request.headers.get('content-type')?.includes('application/json')){
  const body=JSON.stringify(JSON.parse(request.body),(_key,value)=>typeof value==='string'?value.replace(/[\uD800-\uDFFF]/gu,'\uFFFD'):value)
  if(body!==request.body){
   const headers=new Headers(request.headers);headers.delete('content-length')
   return next({...request,headers,body})
  }
 }
 return next(request)
}
