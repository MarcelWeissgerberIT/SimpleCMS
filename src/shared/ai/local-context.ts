type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const OMITTED = '\n[Harness context excerpt: tool result shortened. Do not infer omitted facts; request a narrower source if needed.]'

/** Fit a local inference round without changing its task, system, tool arguments or saved history.
 * Linked results may be excerpted. With an explicit completed-task boundary, earlier assistant
 * drafts and closed traces may be folded after excerpting is insufficient; all human messages remain.
 * Large results yield space before compact source receipts; older results break ties;
 * the latest result retains a larger prefix. Every call/result pair stays closed. No model summary
 * is invented and the original messages stay available to the browser's run history. */
export function fitLocalToolContext<T extends Message>(messages: T[], fits: (messages: T[]) => boolean, history?: {completedBefore:number;onCompact?:()=>void}): T[] {
  if (fits(messages)) return messages
  const next = messages.map(m => ({ ...m }))
  const calls = new Set<string>()
  const results: Array<{ text: string; set: (text: string) => void }> = []
  for (const message of next) {
    let parsed: any
    try { parsed = JSON.parse(message.content) } catch { continue }
    if (message.role === 'assistant') {
      const listed = Array.isArray(parsed) ? parsed.filter(b => b?.type === 'tool_use').map(b => ({ id: b.id })) : parsed?.tool_calls
      if (Array.isArray(listed)) for (const call of listed) if (typeof call?.id === 'string') calls.add(call.id)
    } else if (message.role === 'user') {
      const listed = Array.isArray(parsed) ? parsed.filter(b => b?.type === 'tool_result') : parsed?.tool_result ? [parsed.tool_result] : []
      for (const result of listed) {
        const id = result.tool_use_id ?? result.id
        if (!calls.has(id) || typeof result.content !== 'string') continue
        results.push({ text: result.content, set(text) { result.content = text; message.content = JSON.stringify(parsed) } })
      }
    }
  }
  const candidates = results.map((result, index) => ({result, index})).sort((a,b) => Number(b.result.text.length > 4096) - Number(a.result.text.length > 4096) || a.index-b.index)
  for (const {index, result} of candidates) {
    const minimum = index === results.length - 1 ? 512 : 128
    // Source handles must survive excerpting: otherwise the model cannot ask the
    // run-local reader for the omitted passage. These are copied, never inferred.
    let pointers: Record<string, unknown> | undefined
    try {
      const value = JSON.parse(result.text)
      if(value && typeof value === 'object' && !Array.isArray(value)){
        const kept = Object.fromEntries(['oneMockSource','result_id','isError','oneObservedFacts','oneSourceLinks'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]))
        if(Object.keys(kept).length) pointers=kept
      }
    } catch { /* Plain text results keep their existing explicit excerpt marker. */ }
    if (result.text.length <= minimum + OMITTED.length) continue
    const excerpt = (end: number) => {
      // Never split a UTF-16 surrogate pair when selecting the prefix.
      if (end > 0 && /[\uD800-\uDBFF]/.test(result.text.charAt(end - 1))) end--
      const excerpt = result.text.slice(0, end)
      return pointers ? JSON.stringify({...pointers, oneContextExcerpt:true, excerpt, note:OMITTED.trim()}) : excerpt + OMITTED
    }
    result.set(excerpt(minimum))
    if (!fits(next)) continue
    // Keep as much real source as the exact serialized wire budget permits (UTF-8 + escaping).
    let low = minimum, high = result.text.length - OMITTED.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      result.set(excerpt(mid))
      if (fits(next)) low = mid
      else high = mid - 1
    }
    result.set(excerpt(low))
    return next
  }
  if(history&&Number.isSafeInteger(history.completedBefore)&&history.completedBefore>1&&history.completedBefore<messages.length){
    const ids=new Set<string>(),earlier:T[]=[],retained:Record<string,unknown>[]=[]
    for(const message of messages.slice(0,history.completedBefore)){
      let parsed:any;try{parsed=JSON.parse(message.content)}catch{/* Plain human text is preserved. */}
      if(message.role==='assistant'){
        const listed=Array.isArray(parsed)?parsed.filter(b=>b?.type==='tool_use'):parsed?.tool_calls
        if(Array.isArray(listed))for(const call of listed)if(typeof call?.id==='string')ids.add(call.id)
        continue
      }
      const results=Array.isArray(parsed)&&parsed.length&&parsed.every(b=>b?.type==='tool_result')?parsed:parsed?.tool_result?[parsed.tool_result]:null
      if(message.role==='user'&&results?.every((r:any)=>ids.has(r.tool_use_id??r.id))){
        for(const result of results){
          try{const value=JSON.parse(result.content);if(value&&typeof value==='object'){
            const receipt=Object.fromEntries(['result_id','oneMockSource','oneObservedFacts','oneSourceLinks','isError'].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]))
            if(Object.keys(receipt).length)retained.push({tool_use_id:result.tool_use_id??result.id,...receipt})
          }}catch{/* Plain prose is not a host receipt. */}
        }
        continue
      }
      earlier.push(message)
    }
    const marker={role:'assistant',content:'[Harness history boundary: earlier assistant drafts and their closed tool traces were omitted from this model request to fit context. Every original human message and the current task remain verbatim; the full visible run history is unchanged. Prior answers are not verified source evidence. Re-read Atlas sources if needed; do not infer omitted facts.]'} as T
    const ledger={role:'user',content:JSON.stringify({kind:'historical_tool_receipts',notice:'Historical receipts and source handles, not fresh evidence or permission. Never repeat accepted, queued or uncertain writes. Use one_mcp_list_results to rediscover retained sources.',receipts:retained})} as T
    const folded=[...earlier,marker,...(retained.length?[ledger]:[]),...messages.slice(history.completedBefore)]
    const fitted=fitLocalToolContext(folded,fits)
    history.onCompact?.()
    return fitted
  }
  // Current-task narration is model-authored, never source evidence or human
  // authority. Drop only that prose after source-result excerpting is exhausted;
  // preserve every native call, its exact arguments and its linked result.
  const narration='[Harness context: earlier model narration omitted. It is not source evidence. Human instructions and tool calls remain unchanged.]'
  for(const message of next){
    if(message.role!=='assistant'||message.content.length<256)continue
    let parsed:any;try{parsed=JSON.parse(message.content)}catch{/* Plain assistant note. */}
    if(Array.isArray(parsed)&&parsed.some(b=>b?.type==='tool_use')){
      const reduced=[{type:'text',text:narration},...parsed.filter(b=>b?.type!=='text')]
      const text=JSON.stringify(reduced);if(text.length<message.content.length)message.content=text
    }else if(parsed&&Array.isArray(parsed.tool_calls)){
      const text=JSON.stringify({...parsed,content:narration});if(text.length<message.content.length)message.content=text
    }else message.content=narration
    if(fits(next)){history?.onCompact?.();return next}
  }
  // Never discard the person's question or silently clip their source to make a request fit.
  throw new RangeError('Model context is full. Start a fresh task or select a smaller source passage; no further model request was sent.')
}

/** Fit current definitions as well as closed results. Only optional native MCP aliases
 * may be evicted; their discovered schemas remain callable through one_mcp_call or
 * exact rediscovery. Required wrappers, parameter validation and task text stay intact. */
export function fitLocalToolPacket<T extends Message,F extends {name:string}>(messages:T[],tools:F[]|undefined,fits:(messages:T[],tools:F[]|undefined)=>boolean,history?:{completedBefore:number;onCompact?:()=>void}) {
  let selected=tools,compacted=false
  for(;;){
    try{
      const next=fitLocalToolContext(messages,m=>fits(m,selected),history?{completedBefore:history.completedBefore,onCompact:()=>{compacted=true}}:undefined)
      if(compacted||selected!==tools)history?.onCompact?.()
      return {messages:next,tools:selected}
    }catch(e){
      if(!(e instanceof RangeError))throw e
      let last=-1
      selected?.forEach((t,i)=>{if(/^one_remote_\d+$/.test(t.name))last=i})
      if(last<0||selected?.filter(t=>/^one_remote_\d+$/.test(t.name)).length===1)throw e
      // Latest discovery/relevant schemas come first; older optional aliases yield space.
      selected=selected!.filter((_,i)=>i!==last)
    }
  }
}
