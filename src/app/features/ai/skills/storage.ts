import {useCloud} from '../../../cloud/state'
import {useWorkspace} from '../../../store/store'
import {isTestAccess} from '../../../cloud/testScope'
import {looksLikeKey} from '@/shared/ai/keys'
import {bindSkill,readSkill,resolveSkills,skillRequest,SkillError,type Skill,type SkillSpec} from '@/shared/ai/skills'
export const skillScope=()=>{const c=useCloud.getState();return c.active.kind==='cloud'?'cloud:'+c.active.id+':'+c.user?.id:'local:'+useWorkspace.getState().epoch}
const check=(scope:string)=>{const c=useCloud.getState();if(scope!==skillScope()||isTestAccess()||c.active.kind==='cloud'&&!c.user?.id)throw new SkillError('scope')}
const key=(scope:string)=>'one.skills.v1:'+scope
export function listSkills(scope=skillScope()):Skill[]{
 check(scope)
 try{const rows=JSON.parse(localStorage.getItem(key(scope))??'[]');if(!Array.isArray(rows)||rows.length>80)throw new SkillError('invalid');const clean=rows.map(readSkill);if(looksLikeKey(JSON.stringify(clean)))throw new SkillError('credentials');return clean}catch(e){if(e instanceof SkillError)throw e;throw new SkillError('storage')}
}
export function requestedSkills(text:string){return skillRequest(text).names.length?resolveSkills(text,listSkills()):[]}
export async function saveSkill(spec:SkillSpec,previous:Skill|null,scope=skillScope()){
 const write=()=>{
  check(scope);const rows=listSkills(scope)
  if(looksLikeKey(JSON.stringify(spec)))throw new SkillError('credentials')
  if(previous){readSkill(previous);if(previous.spec.name!==spec.name||!rows.some(s=>s.id===previous.id&&s.hash===previous.hash&&s.version===previous.version)||Math.max(...rows.filter(s=>s.id===previous.id).map(s=>s.version))!==previous.version)throw new SkillError('changed')}
  else if(rows.some(s=>s.spec.name===spec.name))throw new SkillError('changed')
  if(rows.length>=80)throw new SkillError('limit')
  const next=bindSkill(previous?.id??crypto.randomUUID(),(previous?.version??0)+1,spec)
  try{localStorage.setItem(key(scope),JSON.stringify([next,...rows]))}catch{throw new SkillError('storage')}
  check(scope);return next
 }
 return navigator.locks? navigator.locks.request(key(scope),write):write()
}

export async function importSkillVersion(value:Skill,scope=skillScope()){
 const write=()=>{
  check(scope);const next=readSkill(value),rows=listSkills(scope)
  if(looksLikeKey(JSON.stringify(next)))throw new SkillError('credentials')
  const existing=rows.find(s=>s.id===next.id&&s.version===next.version)
  if(existing){if(existing.hash!==next.hash)throw new SkillError('changed');return existing}
  if(rows.some(s=>s.spec.name===next.spec.name&&s.id!==next.id||s.id===next.id&&s.spec.name!==next.spec.name))throw new SkillError('changed')
  if(rows.length>=80)throw new SkillError('limit')
  try{localStorage.setItem(key(scope),JSON.stringify([next,...rows].sort((a,b)=>b.version-a.version)))}catch{throw new SkillError('storage')}
  check(scope);return next
 }
 return navigator.locks?navigator.locks.request(key(scope),write):write()
}
