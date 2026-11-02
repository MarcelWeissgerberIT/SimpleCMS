/** Inference queue only: no coding relay, repository scan, local server or laptop pairing. */
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {SharedModelHost} from '../../mcp/src/worker/shared-model.ts'
import {loadConfig,withPreset} from '../../mcp/src/worker/config.ts'
import {readPreset} from '../../mcp/src/worker/preset.ts'
const file=resolve(process.env.ONE_WORKER_CONFIG!),presetFile=process.env.MODEL_HOST_PRESET_FILE!
if(!process.env.ONE_WORKER_CONFIG||!presetFile)throw new Error('Explicit private host configuration required')
const parsed=readPreset(JSON.parse(readFileSync(presetFile,'utf8')))
if(!parsed.preset?.cloud)throw new Error('A workspace-scoped model host token is required')
const {config,problems}=loadConfig(file)
if(problems.length)throw new Error('Invalid host configuration')
const bound={...withPreset(config,parsed.preset),repos:[],intake:false}
const host=new SharedModelHost(bound,()=>false,line=>process.stdout.write(line+'\n'))
host.start()
let stopping=false
const stop=()=>{
  if(stopping)return;stopping=true;host.drain()
  const timer=setInterval(()=>{if(host.idle){clearInterval(timer);host.stop();process.exit(0)}},250)
  setTimeout(()=>{host.stop();process.exit(1)},195000).unref()
}
process.on('SIGTERM',stop);process.on('SIGINT',stop)
