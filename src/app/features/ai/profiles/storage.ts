import {resolveTypedAI} from '@/shared/quandprofile/typed-ai'
import {createStore,get,update} from 'idb-keyval'
import {blankReviewProfile,bindReviewProfile,readReviewProfile,type ReviewProfile,type ReviewProfileSpec} from '@/shared/quandprofile/review-profile'
import {looksLikeKey} from '@/shared/ai/keys'
import {programScope} from '../programs/storage'
import {useCloud} from '../../../cloud/state'
import {isTestAccess} from '../../../cloud/testScope'
export {blankReviewProfile}
type Library={active:{id:string;version:number}|null;rows:ReviewProfile[]}
const database=createStore('one-cube-profiles','profiles')
const empty=():Library=>({active:null,rows:[]})
export const profileScope=()=>programScope().key
const check=(scope:string)=>{const c=useCloud.getState();if(profileScope()!==scope||isTestAccess()||c.active.kind==='cloud'&&!c.user?.id)throw Error('Workspace or account changed. Reopen the profile editor.')}
export async function reviewProfiles(){const scope=profileScope();check(scope);const value=await get<Library>(scope,database)??empty();check(scope);return {active:value.active,rows:value.rows.map(readReviewProfile)}}
export async function activeReviewProfile(){if(isTestAccess())return null;const value=await reviewProfiles();if(!value.active)return null;const profile=value.rows.find(p=>p.id===value.active!.id&&p.version===value.active!.version);if(!profile)throw Error('Selected review profile is unavailable. Open the profile editor.');return profile}
export async function saveReviewProfile(spec:ReviewProfileSpec,previous:ReviewProfile|null,activate:boolean){const scope=profileScope();check(scope);const next=bindReviewProfile(previous?.id??crypto.randomUUID(),(previous?.version??0)+1,spec);if(activate&&spec.typedAI){const plan=resolveTypedAI(spec.typedAI);if(plan.issues.length)throw Error('Typed AI: '+plan.issues.map(i=>i.code+': '+i.detail).join('; '))}if(looksLikeKey(JSON.stringify(spec)))throw Error('Keep credentials out of review profiles.');await update<Library>(scope,current=>{check(scope);const value=current??empty(),latest=Math.max(0,...value.rows.filter(p=>p.id===next.id).map(p=>p.version));if(latest!==(previous?.version??0))throw Error('A newer version exists. Reopen the profile.');if(value.rows.length>=60)throw Error('Profile library limit: 60 saved versions.');return {active:activate?{id:next.id,version:next.version}:value.active,rows:[next,...value.rows]}},database);check(scope);return next}
export async function selectReviewProfile(profile:ReviewProfile|null){if(profile?.spec.typedAI){const p=resolveTypedAI(profile.spec.typedAI);if(p.issues.length)throw Error('Typed AI: '+p.issues.map(i=>i.code+': '+i.detail).join('; '))}const scope=profileScope();check(scope);await update<Library>(scope,current=>{check(scope);const value=current??empty();if(profile&&!value.rows.some(p=>p.id===profile.id&&p.version===profile.version&&p.hash===profile.hash))throw Error('Profile version not found.');return {...value,active:profile?{id:profile.id,version:profile.version}:null}},database);check(scope)}
