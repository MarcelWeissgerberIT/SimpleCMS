import {typedAI,type TypedAI} from './typed-ai.ts'
import {stateHash} from './runtime.ts'
export const REVIEW_DIMENSIONS=['freshness','privacy','permission','provenance','interpretation','data','outcome'] as const
export type ReviewDimension=typeof REVIEW_DIMENSIONS[number]
export type ReviewProfileSpec={typedAI?:TypedAI;name:string;readOnly:boolean;requireOne:boolean;requireAtlas:boolean;onePages:string[];atlasRefs:number[];atlasWriteRefs:number[];beforeEffects:boolean;output:'inherit'|'json';requiredTerms:string[];guidance:Partial<Record<ReviewDimension,string>>}
export type ReviewProfile={id:string;version:number;hash:string;spec:ReviewProfileSpec}
export const blankReviewProfile=():ReviewProfileSpec=>({name:'',readOnly:false,requireOne:false,requireAtlas:false,onePages:[],atlasRefs:[],atlasWriteRefs:[],beforeEffects:true,output:'inherit',requiredTerms:[],guidance:{}})
/** Human-authored data, bounded before it reaches the compiler. No expressions or executable code. */
export function reviewProfileSpec(value:unknown):ReviewProfileSpec {
 const p=value as ReviewProfileSpec
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>![...Object.keys(blankReviewProfile()),'typedAI'].includes(k))||typeof p.name!=='string'||!p.name.trim()||p.name.length>120||!['readOnly','requireOne','requireAtlas','beforeEffects'].every(k=>typeof p[k as keyof ReviewProfileSpec]==='boolean')||!['inherit','json'].includes(p.output))throw Error('Invalid review profile')
 const strings=(v:unknown,max:number,length:number)=>{if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||!x.trim()||x.length>length))throw Error('Invalid profile text');return [...new Set(v.map(x=>x.trim()))] as string[]}
 const onePages=strings(p.onePages,16,100);if(onePages.some(x=>!/^[A-Za-z0-9_-]+$/.test(x)))throw Error('Use ONE page IDs, not URLs')
 const refs=(v:unknown)=>{if(!Array.isArray(v)||v.length>16||v.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('Use positive global Atlas refs');return [...new Set(v)] as number[]}
 if(!p.guidance||typeof p.guidance!=='object'||Array.isArray(p.guidance)||Object.keys(p.guidance).some(k=>!REVIEW_DIMENSIONS.includes(k as ReviewDimension)))throw Error('Invalid guidance dimension')
 const guidance:ReviewProfileSpec['guidance']={};for(const d of REVIEW_DIMENSIONS){const text=p.guidance[d];if(text!==undefined){if(typeof text!=='string'||text.length>1200)throw Error('Keep each guidance point within 1200 characters');if(text.trim())guidance[d]=text.trim()}}
 return {...(p.typedAI?{typedAI:typedAI(p.typedAI)}:{}),name:p.name.trim(),readOnly:p.readOnly,requireOne:p.requireOne,requireAtlas:p.requireAtlas,onePages,atlasRefs:refs(p.atlasRefs),atlasWriteRefs:refs(p.atlasWriteRefs),beforeEffects:p.beforeEffects,output:p.output,requiredTerms:strings(p.requiredTerms,16,160),guidance}
}
export function bindReviewProfile(id:string,version:number,spec:unknown):ReviewProfile {if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!Number.isSafeInteger(version)||version<1||version>100)throw Error('Invalid profile version');const clean=reviewProfileSpec(spec);return {id,version,hash:stateHash(clean),spec:clean}}
export function readReviewProfile(value:unknown):ReviewProfile {const p=value as ReviewProfile,clean=bindReviewProfile(p?.id,p?.version,p?.spec);if(clean.hash!==p.hash)throw Error('Profile hash changed. Open and save a new version.');return clean}
