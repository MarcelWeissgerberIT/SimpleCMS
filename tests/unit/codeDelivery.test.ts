import {test} from 'node:test'
import assert from 'node:assert/strict'
import {codeDeliveryIssues} from '../../src/shared/ai/codeDelivery.ts'
const cpp=(s:string)=>'```cpp\n'+s+'\n```'
test('missing direct limits header is a concrete portable-code defect',()=>{assert(codeDeliveryIssues('Implement a C++ function',cpp('unsigned n=UINT_MAX;')).length);assert.deepEqual(codeDeliveryIssues('Implement a C++ function',cpp('#include <climits>\nunsigned n=UINT_MAX;')),[])})
test('ASCII requirement rejects locale-sensitive digit classification',()=>assert(codeDeliveryIssues('Implement ASCII function',cpp('std::isdigit(c);')).some(x=>x.includes('ASCII'))))
test('negative signed char to cctype is rejected, explicit unsigned-char cast is not',()=>{assert(codeDeliveryIssues('Implement function',cpp('for(char c : input) { std::isdigit(c); }')).some(x=>x.includes('negative')));assert.deepEqual(codeDeliveryIssues('Implement function',cpp('for(char c : input) { std::isdigit(static_cast<unsigned char>(c)); }')),[])})
test('unrelated quoted code and other languages are not rewritten by this narrow check',()=>{assert.deepEqual(codeDeliveryIssues('Explain what UINT_MAX means',cpp('unsigned n=UINT_MAX;')),[]);assert.deepEqual(codeDeliveryIssues('Implement a function','```python\nUINT_MAX\n```'),[])})
