/** Detect only the observed page-AI case: a named document analysis with no supplied body.
 * Never search other pages or import content outside the person's selected scope. */
export function missingDocumentSource(request:{action:string;instruction?:string;input:string;context?:string}):boolean{
 if(request.action!=='custom')return false
 const goal=request.instruction??''
 if(!/\.(?:docx|pdf|xlsx|csv)\b/iu.test(goal)||!/zusammenfass|fasse\b[\s\S]{0,180}\bzusammen|summari[sz]|analys|analy[sz]|extrah|extract/iu.test(goal))return false
 // An explicit external lookup is a different request; its normal source checks apply.
 if(/https:\/\/|\batlas\b|\bpolarion\b/iu.test(goal))return false
 const body=[request.input,request.context??''].join('\n').split('\n').filter(line=>!/^\s{0,3}#{1,6}\s/u.test(line)).join('\n').trim()
 return !body
}
