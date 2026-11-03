import {test} from 'node:test'
import assert from 'node:assert/strict'
import {atlasQueryProblem} from '../../src/shared/mcp/aql.ts'
test('the observed tags equality error is held without rewriting scope or guessing an operator',()=>{
 const aql='project = flux-part-cnsx AND (kind = requirement OR tags = "requirement" OR tags = "urs")'
 const args={aql,tenant:'analytik-jena',limit:100}
 for(const tool of ['atlas_search','atlas_query'])assert.match(atlasQueryProblem(tool,args)??'',/tags is an array.*No server call was sent/)
 assert.equal(args.aql,aql)
 for(const args of [{q:'tags = requirement'},{aql:'project = flux-part-cnsx AND title = "tags = requirement"'},{aql:"title = 'tags = requirement'"},{aql:'custom.tags = x'},{aql:'tagship = x'},{aql:'project = flux-part-cnsx'}])assert.equal(atlasQueryProblem('atlas_search',args),null)
 assert.equal(atlasQueryProblem('atlas_update',{aql:'tags = x'}),null)
})
