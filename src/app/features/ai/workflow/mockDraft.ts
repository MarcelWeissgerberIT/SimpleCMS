import type {MockElement,MockFeedback} from '@/shared/ai/mockReview'
import type {MockRegion} from '@/shared/ai/mockRegion'
export interface MockDraft {text:string;intent:MockFeedback['intent'];scope:MockFeedback['scope'];selection:MockElement[];version:string;region?:MockRegion}
export const freshMockDraft=():MockDraft=>({text:'',intent:'check',scope:'check',selection:[],version:''})
export const validMockDraft=(v:unknown):v is MockDraft=>{
 const x=v as MockDraft
 return !!x&&typeof x.text==='string'&&x.text.length<=3000&&['check','fix','replace'].includes(x.intent)&&['check','mock','design-system'].includes(x.scope)&&typeof x.version==='string'&&Array.isArray(x.selection)&&x.selection.length<=12&&x.selection.every(e=>e&&['path','tag','text','component','requirement','snippet'].every(k=>typeof (e as any)[k]==='string'))&&(!x.region||['x','y','width','height','viewportWidth','viewportHeight'].every(k=>Number.isFinite((x.region as any)[k])&&(x.region as any)[k]>=0))
}
