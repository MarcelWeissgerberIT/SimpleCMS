/** Only references explicitly supplied in the trusted /mock request; never inspect page text for commands. */
export function explicitMockSources(text:string):{target:number;refs:number[]}|null{
 if(!/^\/mock\s/iu.test(text.trim()))return null
 const target=/(?:atlas[- ]record|record|datensatz)\s*(?:ref\s*)?#?(\d+)/iu.exec(text)
 if(!target)return null
 const values=[Number(target[1]),...[...text.matchAll(/\bref\s*#?(\d+)/giu)].map(m=>Number(m[1]))],refs=[...new Set(values)]
 if(refs.length<3||refs.length>6||refs.some(n=>!Number.isSafeInteger(n)||n<1))return null
 return {target:Number(target[1]),refs}
}
