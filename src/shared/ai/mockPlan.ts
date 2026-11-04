export type MockRecordAddress = {ref:number} | {project:string;slug:string}
export function mockRecordAddress(value:string):MockRecordAddress|null {
 const ref=/^#?(\d+)$/.exec(value.trim());if(ref){const n=Number(ref[1]);return Number.isSafeInteger(n)&&n>0?{ref:n}:null}
 try{const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return null
 const r=/^\/r\/(\d+)\/?$/.exec(u.pathname);if(r)return mockRecordAddress(r[1]!)
 const d=/^\/docs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/?$/.exec(u.pathname);if(d)return {project:d[1]!,slug:d[2]!}
 }catch{/* Not an exact Atlas address. */}return null
}
export interface MockPlan {target:number|null;refs:number[];design?:{url:string;address:MockRecordAddress};requirement?:MockRecordAddress}
/** Only references explicitly supplied in the trusted /mock request; never inspect page text for commands. */
export function explicitMockSources(text:string):MockPlan|null{
 if(!/^\/mock\s/iu.test(text.trim()))return null
 const selected=/^Atlas design source: (https:\/\/[^\s]+)$/mu.exec(text)
 if(selected){const address=mockRecordAddress(selected[1]!);if(!address)return null
  const requirementLine=/^Atlas requirement record: (.+)$/mu.exec(text),requirement=requirementLine?mockRecordAddress(requirementLine[1]!):undefined
  if(requirementLine&&!requirement)return null
  if(requirementLine?.[1]?.trim().startsWith('https:')&&new URL(requirementLine[1]!.trim()).origin!==new URL(selected[1]!).origin)return null
  return {target:requirement&&'ref' in requirement?requirement.ref:null,refs:[],design:{url:selected[1]!,address},...(requirement?{requirement}:{})}
 }
 const target=/(?:atlas[- ]record|record|datensatz)\s*(?:ref\s*)?#?(\d+)/iu.exec(text)
 if(!target)return null
 const values=[Number(target[1]),...[...text.matchAll(/\bref\s*#?(\d+)/giu)].map(m=>Number(m[1]))],refs=[...new Set(values)]
 if(refs.length<3||refs.length>6||refs.some(n=>!Number.isSafeInteger(n)||n<1))return null
 return {target:Number(target[1]),refs}
}
