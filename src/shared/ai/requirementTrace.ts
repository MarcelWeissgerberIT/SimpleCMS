/** Minimum negative checks only: origin and obvious example leakage do not prove entailment. */
export function requirementTraceIssues(statement:string,acceptance:string,target:string,method:string):string[]{
 const issues:string[]=[],normal=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()
 if(normal(method).includes(normal(statement))&&!normal(target).includes(normal(statement)))issues.push('A method-source example was copied as a project requirement. Derive behavior from the original project passage instead.')
 if(/(?:korrekte verwendung|richtige verwendung|correct use|correct usage).{0,65}(?:ears|syntax)|(?:ears|syntax).{0,40}(?:beinhalten|enthalten|beinhaltet)/iu.test(acceptance))issues.push('The acceptance check only tests the notation. Specify an observable behavior check grounded in the project, and label missing thresholds as open.')
 if(/⟦b\d+⟧/u.test(statement))issues.push('Internal block labels are not requirement text.')
 return issues
}
