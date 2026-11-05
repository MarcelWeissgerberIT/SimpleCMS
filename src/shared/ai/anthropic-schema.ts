/** Anthropic's constrained decoder supports a subset of JSON Schema. Only the wire copy
 * is reduced; callers must validate the answer against the unchanged original schema.
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations
 */
export function anthropicOutputSchema(schema:Record<string,unknown>):Record<string,unknown>{
 const unsupported=new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','maxItems','uniqueItems','contains','minContains','maxContains','minProperties','maxProperties'])
 const visit=(s:Record<string,unknown>):Record<string,unknown>=>{
  const out:Record<string,unknown>={},hints:Record<string,unknown>={}
  for(const [key,value]of Object.entries(s)){
   if(unsupported.has(key)||key==='minItems'&&value!==0&&value!==1){hints[key]=value;continue}
   if(['properties','$defs','definitions'].includes(key)&&value&&typeof value==='object'&&!Array.isArray(value))out[key]=Object.fromEntries(Object.entries(value).map(([name,child])=>[name,visit(child as Record<string,unknown>)]))
   else if(['anyOf','oneOf','allOf'].includes(key)&&Array.isArray(value))out[key]=value.map(child=>visit(child as Record<string,unknown>))
   else if(['items','additionalProperties'].includes(key)&&value&&typeof value==='object'&&!Array.isArray(value))out[key]=visit(value as Record<string,unknown>)
   else out[key]=structuredClone(value)
  }
  if(s.type==='object'&&out.additionalProperties===undefined)out.additionalProperties=false
  if(Object.keys(hints).length)out.description=(typeof out.description==='string'?out.description+'\n':'')+'ONE validates these constraints after generation: '+JSON.stringify(hints)
  // Claude rejects enum values against a type array even when they match a member
  // (observed: enum [null], type ["string","null"]). Partition by scalar type.
  if(Array.isArray(out.type)&&Array.isArray(out.enum)){
   const values=out.enum,variants=out.type.map(type=>({type,enum:values.filter(v=>type==='null'?v===null:type==='integer'?Number.isSafeInteger(v):type==='array'?Array.isArray(v):type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):typeof v===type)})).filter(v=>v.enum.length)
   if(variants.length){
    delete out.type;delete out.enum
    if(variants.length===1)Object.assign(out,variants[0])
    else if(out.anyOf||out.allOf||out.oneOf){out.allOf=[...(Array.isArray(out.allOf)?out.allOf:[]),{anyOf:variants}]}
    else out.anyOf=variants
   }
  }
  return out
 }
 return visit(schema)
}
