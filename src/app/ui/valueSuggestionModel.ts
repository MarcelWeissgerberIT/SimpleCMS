/** Ranking only: comparison keys never replace a person's stored spelling. */
export type ValueSuggestion={value:string;label?:string;detail?:string;uses?:number}
export const spellingKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase()
export function similarSpelling(option:ValueSuggestion,value:string){return option.value!==value&&!!value.trim()&&spellingKey(option.value)===spellingKey(value)}
export function suggestionOptions(options:readonly ValueSuggestion[]){return [...new Map(options.filter(o=>o.value.trim()).map(o=>[o.value,o])).values()]}
export function matchingSuggestions(options:readonly ValueSuggestion[],value:string){
 const unique=suggestionOptions(options),q=spellingKey(value),exact=unique.some(o=>o.value===value)
 return unique.filter(o=>!q||exact||spellingKey(o.label??o.value).includes(q)||spellingKey(o.value).includes(q))
  .map((option,index)=>({option,index,rank:option.value===value?2:similarSpelling(option,value)?0:1}))
  .sort((a,b)=>a.rank-b.rank||a.index-b.index).map(o=>o.option).slice(0,12)
}
