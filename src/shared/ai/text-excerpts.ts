/** UTF-16 offsets, as used by source readers. Move cut boundaries inward so an
 * excerpt never manufactures a lone surrogate from an intact source character. */
export function textExcerpt(text:string,start:number,end:number):string {
 if(start>0&&/[\uDC00-\uDFFF]/.test(text[start]??'')&&/[\uD800-\uDBFF]/.test(text[start-1]??''))start++
 if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]??'')&&/[\uDC00-\uDFFF]/.test(text[end]??''))end--
 return text.slice(start,Math.max(start,end))
}

export function searchSnippet(text:string,query:string):string {
 const flat=text.replace(/\s+/g,' ').trim()
 if(!flat)return ''
 const words=[query,...query.split(/\s+/)].map(w=>w.toLowerCase()).filter(w=>w.length>2)
 const lower=flat.toLowerCase()
 let at=-1
 for(const w of words){at=lower.indexOf(w);if(at>=0)break}
 const start=Math.max(0,at<0?0:at-80)
 return `${start>0?'…':''}${textExcerpt(flat,start,start+220)}${start+220<flat.length?'…':''}`
}
