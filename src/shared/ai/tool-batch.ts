export interface ToolReceipt {type:'tool_result';tool_use_id:string;content:string;is_error?:boolean}
/** Close a model's whole requested batch even when execution stopped part way through.
 * Missing receipts are uncertain, never fabricated evidence of success or non-execution. */
export function closeToolBatch(calls:readonly {id:string}[],completed:readonly ToolReceipt[]):ToolReceipt[]{
 return [...completed,...calls.filter(c=>!completed.some(r=>r.tool_use_id===c.id)).map(c=>({type:'tool_result' as const,tool_use_id:c.id,content:'Stopped without a recorded result for this call. Execution is unverified; do not retry writes automatically.',is_error:true}))]
}
