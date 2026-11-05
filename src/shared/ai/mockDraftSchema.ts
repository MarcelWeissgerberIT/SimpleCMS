import {MOCK_SCHEMA} from './designMock.ts'

/** Fresh JSON tree: structuredClone preserves the shared citation nodes in MOCK_SCHEMA. */
export function mockDraftSchema(ids:string[],selectedDesign:string|null,target:string|null){
 const schema=JSON.parse(JSON.stringify(MOCK_SCHEMA)) as Record<string,any>
 schema.properties.design.properties.source.enum=selectedDesign?[selectedDesign]:ids
 schema.properties.authority.anyOf[0].properties.source.enum=ids
 for(const field of ['requirements','tokens','components'])schema.properties[field].items.properties.source.enum=ids
 if(target)schema.properties.target={type:'string',enum:[target]}
 else if(selectedDesign){
  schema.properties.target={type:'null'}
  schema.properties.requirements.maxItems=0
 }else schema.properties.target.enum=[null,...ids]
 return schema
}
