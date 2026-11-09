/** Early feedback for missing/unknown top-level arguments. The transport still
 * validates the entire current JSON schema; this check never grants execution. */
export function mcpArgumentFeedback(schema:Record<string,any>,args:Record<string,unknown>) {
  const required=Array.isArray(schema.required)?schema.required.filter((key:unknown):key is string=>typeof key==='string'):[]
  const missing=required.filter((key:string)=>!Object.hasOwn(args,key))
  const properties=schema.properties&&typeof schema.properties==='object'?schema.properties:{}
  // Pattern properties may legitimately accept keys absent from properties.
  const unexpected=schema.additionalProperties===false&&!schema.patternProperties?Object.keys(args).filter(key=>!Object.hasOwn(properties,key)):[]
  if(!missing.length&&!unexpected.length)return null
  return {missing,unexpected,error:'MCP arguments do not match the discovered tool schema. No MCP call was dispatched.',
    inputSchema:schema,note:'Correct the missing or unsupported arguments using this schema and IDs observed in source results. Do not guess identifiers, rename version to snapshot without checking its repository, or repeat identical arguments. For Atlas code, discover repo IDs with atlas_code_repos and snapshots for that repo with atlas_code_versions. This is validation feedback, not source evidence.'}
}
