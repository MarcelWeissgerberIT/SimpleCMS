/** Larger, narrowly typed Atlas attachment calls; ordinary MCP arguments keep their 20K bound. */
export function mcpArgumentsWithinLimit(name:string,args:Record<string,unknown>):boolean{
 const size=JSON.stringify(args).length
 if(size<=20000)return true
 if(name!=='atlas_attach'||size>850000||Object.keys(args).some(k=>!['ref','filename','mime','text','contentBase64'].includes(k)))return false
 if(!Number.isSafeInteger(args.ref)||Number(args.ref)<1||typeof args.filename!=='string'||args.filename.length>160||/[\x00-\x1f/\\]/.test(args.filename))return false
 if(args.mime==='image/png')return typeof args.contentBase64==='string'&&args.contentBase64.length<=800000&&/^[A-Za-z0-9+/]+={0,2}$/.test(args.contentBase64)&&args.text===undefined
 return ['text/html','application/json'].includes(String(args.mime))&&typeof args.text==='string'&&new TextEncoder().encode(args.text).length<=600000&&args.contentBase64===undefined
}
