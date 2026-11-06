import {readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join,relative} from 'node:path'
const root=fileURLToPath(new URL('..',import.meta.url)),rust=join(root,'runtime/quandprofile'),out=join(root,'src/shared/quandprofile')
const hash=b=>createHash('sha256').update(b).digest('hex')
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)])
const inputs=[...walk(join(rust,'src')),join(rust,'Cargo.toml'),join(rust,'Cargo.lock'),join(rust,'quantum-catalog.json')].sort()
const sources=Object.fromEntries(inputs.map(p=>[relative(rust,p),hash(readFileSync(p))]))
if(!process.argv.includes('--check')){
 const r=spawnSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','--lib','--manifest-path',join(rust,'Cargo.toml')],{stdio:'inherit'})
 if(r.status!==0)process.exit(r.status??1)
 copyFileSync(join(rust,'target/wasm32-unknown-unknown/release/quandprofile.wasm'),join(out,'quandprofile.wasm'))
 writeFileSync(join(out,'manifest.json'),JSON.stringify({abi:1,sourceHash:hash(JSON.stringify(sources)),wasmHash:hash(readFileSync(join(out,'quandprofile.wasm'))),sources},null,2)+'\n')
}else{
 const manifest=JSON.parse(readFileSync(join(out,'manifest.json')))
 if(manifest.sourceHash!==hash(JSON.stringify(sources))||manifest.wasmHash!==hash(readFileSync(join(out,'quandprofile.wasm'))))throw Error('Compiler artifact is stale. Run npm run build:quandprofile.')
 console.log('QuandProfile source/artifact hashes verified')
}
