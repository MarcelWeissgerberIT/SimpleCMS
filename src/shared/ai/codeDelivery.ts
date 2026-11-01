/** Narrow deterministic C++ checks; never a substitute for a compiler, tests or security review. */
export const CODE_DELIVERY_RULES='Code is unverified until actual compiler/test evidence exists. Include every directly required standard header, never rely on transitive includes. For ASCII digit parsing use explicit byte ranges; never pass negative signed char to cctype. Check overflow before arithmetic and use the domain upper bound when possible. Do not claim an unexecuted build/test.'
export function codeDeliveryIssues(goal:string,text:string):string[]{
 if(/^\s*(?:explain|what|why|erkläre|erklaere|warum|was)\b/iu.test(goal))return []
 if(!/\b(?:implement\w*|header|function|funktion|generat\w*)\b/iu.test(goal))return []
 const blocks=[...text.matchAll(/```(?:cpp|c\+\+|cxx)\s*\n([\s\S]*?)```/giu)].map(m=>m[1]);const issues:string[]=[]
 for(const code of blocks){
  if(/\b(?:UINT_MAX|INT_MAX|INT_MIN|ULONG_MAX|LONG_MAX|CHAR_BIT)\b/u.test(code)&&!/#\s*include\s*[<"](?:climits|limits\.h)[>"]/u.test(code))issues.push('C++ uses an integer-limit macro without directly including <climits> or <limits.h>.')
  if(/\b(?:ascii|ASCII)\b/u.test(goal)&&/std::is(?:digit|alnum|alpha)\s*\(/u.test(code))issues.push('The requested ASCII-only parser uses locale-sensitive cctype classification. Use explicit byte ranges.')
  for(const match of code.matchAll(/for\s*\(\s*(?:const\s+)?char\s+(\w+)\s*:/gu))if(new RegExp('std::is(?:digit|alnum|alpha|space)\\s*\\(\\s*'+match[1]+'\\s*\\)').test(code))issues.push('C++ passes a possibly negative signed char directly to cctype; behavior is undefined for such bytes.')
 }
 return [...new Set(issues)]
}
