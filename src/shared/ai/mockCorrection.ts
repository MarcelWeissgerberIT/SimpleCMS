/** Only invalid model drafts enter the one correction round; provider failures propagate. */
export class MockDraftValidationError extends Error {
 readonly draft:unknown
 constructor(draft:unknown,cause:unknown){super(String(cause instanceof Error?cause.message:cause));this.name='MockDraftValidationError';this.draft=draft}
}
export async function checkedMockDraft<D,T>(generate:(input:unknown,error:unknown,repair:boolean)=>Promise<D>,check:(draft:D)=>T,onRepair:()=>void):Promise<T>{
 let input:unknown=null,error:unknown='Initial draft from the exact requested source bodies.'
 for(let i=0;i<2;i++){
  let draft:D|undefined
  try{draft=await generate(input,error,i===1);return check(draft)}catch(e){
   if(i||(!(e instanceof MockDraftValidationError)&&draft===undefined))throw e
   input=e instanceof MockDraftValidationError?e.draft:draft;error=e;onRepair()
  }
 }
 throw Error('No valid mock draft')
}
