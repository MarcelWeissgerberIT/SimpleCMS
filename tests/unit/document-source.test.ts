import {test} from 'node:test'
import assert from 'node:assert/strict'
import {missingDocumentSource} from '../../src/shared/ai/document-source.ts'
test('a named imported document cannot be analysed from a title-only page',()=>{
 const request={action:'custom',instruction:'Bitte fasse die Anforderungen aus dem importierten Dokument "Kalibrierung.docx" zusammen.',input:'',context:'# Ergebnisansicht Kalibrierung\n'}
 assert.equal(missingDocumentSource(request),true)
 assert.equal(missingDocumentSource({...request,instruction:'Summarize Invoice.pdf.'}),true)
 for(const patch of [{input:'Original document: expected version history.'},{context:'# Kalibrierung\nOriginal imported text.'},{instruction:'Erstelle eine neue Kalibrierung.docx.'},{instruction:'Suche Kalibrierung.docx in Atlas und analysiere sie.'},{instruction:'Summarize https://example.org/a.pdf'},{instruction:'Fasse die Seite zusammen.'},{action:'fix'}])assert.equal(missingDocumentSource({...request,...patch}),false)
})
