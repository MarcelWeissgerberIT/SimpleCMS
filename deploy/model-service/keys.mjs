/** Administrative CLI. Secrets go to an explicitly named private file, never stdout. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import {dirname} from 'node:path'
import {keyHash} from './gateway.mjs'
const [action,...args]=process.argv.slice(2),arg=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined}
const file=arg('--store')??'/etc/atlas-flow/api-keys.json'
let store;try{store=JSON.parse(readFileSync(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;store={keys:[]}}
const save=()=>{mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(store,null,2)+'\n',{mode:0o600})}
if(action==='create'){
 const out=arg('--out'),label=arg('--label');if(!out||!label)throw new Error('create requires --out and --label')
 const secret='af_'+randomBytes(32).toString('base64url'),id=randomUUID()
 mkdirSync(dirname(out),{recursive:true,mode:0o700});writeFileSync(out,JSON.stringify({id,apiKey:secret,baseURL:'https://onecms.eh-atlas.com/model/v1',model:'atlas-flow:latest'},null,2)+'\n',{mode:0o600,flag:'wx'})
 store.keys.push({id,label:label.slice(0,100),hash:keyHash(secret),enabled:true,createdAt:Date.now()});save();console.log(JSON.stringify({id,label,savedTo:out}))
}else if(action==='revoke'){
 const row=store.keys.find(k=>k.id===arg('--id'));if(!row)throw new Error('Unknown key id');row.enabled=false;row.revokedAt=Date.now();save();console.log(JSON.stringify({id:row.id,revoked:true}))
}else if(action==='list')console.log(JSON.stringify(store.keys.map(({hash,...r})=>r),null,2))
else throw new Error('Use create, revoke or list')
