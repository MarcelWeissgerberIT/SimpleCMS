import type {Map as YMap} from 'yjs'
import {sanitizeDeskRecords} from '../features/workbench/model'
const PREFIX='workbenchRecord:'
export function writeWorkbench(target:YMap<unknown>,next:unknown,before:unknown={}){
 const previous=sanitizeDeskRecords(before)
 for(const [id,value] of Object.entries(sanitizeDeskRecords(next)))if(JSON.stringify(value)!==JSON.stringify(previous[id]))target.set(PREFIX+id,structuredClone(value))
 // Removal is a per-record tombstone, never deletion of a concurrent collection.
}
export function readWorkbench(target:YMap<unknown>){const raw:Record<string,unknown>={};target.forEach((value,key)=>{if(key.startsWith(PREFIX))raw[key.slice(PREFIX.length)]=value});return sanitizeDeskRecords(raw)}
