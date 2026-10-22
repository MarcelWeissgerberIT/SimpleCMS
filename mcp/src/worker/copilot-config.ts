/** Worker-local model preference only. Copilot credentials belong to Copilot CLI, never this file or One. */
import { constants, existsSync, openSync, readFileSync, closeSync, fstatSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { validCopilotModel } from './copilot.ts'
export const copilotFile=(workerFile:string)=>join(dirname(workerFile),'copilot.json')
export function readCopilot(workerFile:string,env:NodeJS.ProcessEnv=process.env):{model:string}{
 let raw:any={};const file=copilotFile(workerFile)
 if(existsSync(file)){
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>4096||(process.platform!=='win32'&&(stat.mode&0o077)))throw new Error('Copilot settings must be a private file (chmod 600).');raw=JSON.parse(readFileSync(fd,'utf8'))}finally{closeSync(fd)}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='model')||!validCopilotModel(raw.model))throw new Error('Invalid Copilot settings. Save the model again on the worker setup page.')
 }
 const model=env.ONE_COPILOT_MODEL?.trim()||raw.model||'auto'
 if(!validCopilotModel(model))throw new Error('Invalid Copilot model ID.')
 return {model}
}
export function copilotStatus(workerFile:string){try{return {...readCopilot(workerFile),environment:!!process.env.ONE_COPILOT_MODEL?.trim()}}catch{return {model:'auto',environment:false,error:'Copilot model settings could not be read. Save them again.'}}}
export function saveCopilot(workerFile:string,value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='model')||!validCopilotModel((value as any).model))throw new Error('Enter a Copilot model ID or auto. No tokens belong in this field.')
 const file=copilotFile(workerFile),temp=file+'.'+randomBytes(8).toString('hex')+'.tmp'
 mkdirSync(dirname(file),{recursive:true,mode:0o700})
 try{writeFileSync(temp,JSON.stringify({model:(value as any).model})+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file)}finally{if(existsSync(temp))unlinkSync(temp)}
}
