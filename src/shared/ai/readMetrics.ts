import type {Usage} from './types.ts'
export class ReadRunMetrics {
 private started=Date.now();private rounds=0;private cost=0;private unpriced=0
 private mcpSeen=new Set<string>();private remoteReads=0;private reusedReads=0
 observeMcp(call:{id:string;state:string;readMeasurement?:{reused:boolean}}){if(call.state!=='ok'||!call.readMeasurement||this.mcpSeen.has(call.id))return;this.mcpSeen.add(call.id);this.remoteReads++;if(call.readMeasurement.reused)this.reusedReads++}
 private input=0;private cacheRead=0;private cacheWrite=0
 observe(usage:Usage,usd:number|null|undefined){this.rounds++;this.input+=usage.input;this.cacheRead+=usage.cacheRead;this.cacheWrite+=usage.cacheWrite+usage.cacheWrite1h;if(usd==null)this.unpriced++;else this.cost+=usd}
 snapshot(){return {mcpReads:this.remoteReads,mcpReused:this.reusedReads,modelRounds:this.rounds,durationMs:Date.now()-this.started,costUsd:this.cost,unpricedRounds:this.unpriced,inputTokens:this.input,cacheReadTokens:this.cacheRead,cacheWriteTokens:this.cacheWrite}}
 summary(reads:{reads:number;uniqueCharacters:number;duplicateCharacters:number;providedCharacters:number;sourceVersions:number;completeVersions:number},de:boolean){
  const m=this.snapshot(),n=(x:number)=>x.toLocaleString(de?'de-DE':'en-US')
  return de?`Quellenbilanz: ${reads.completeVersions}/${reads.sourceVersions} Quellenstände vollständig bereitgestellt · ${n(reads.uniqueCharacters)} eindeutige Zeichen · ${n(reads.duplicateCharacters)} erneut gelesen · ${reads.reads} Leseaufrufe · ${m.modelRounds} Modellantworten · ${Math.round(m.durationMs/1000)} s. MCP: ${m.mcpReads} erfolgreiche Leseaufrufe, davon ${m.mcpReused} wiederverwendet. Modell-Cache: ${n(m.cacheReadTokens)} Tokens wiederverwendet, ${n(m.cacheWriteTokens)} geschrieben, ${n(m.inputTokens)} übrige Eingabe. Kosten: ${m.costUsd.toFixed(3)} USD${m.unpricedRounds?' (teilweise unbepreist)':''}. Bereitstellung ist noch kein Beleg für ein Finding.`:
   `Source summary: ${reads.completeVersions}/${reads.sourceVersions} source versions fully provided · ${n(reads.uniqueCharacters)} unique characters · ${n(reads.duplicateCharacters)} reread · ${reads.reads} read calls · ${m.modelRounds} model responses · ${Math.round(m.durationMs/1000)} s. MCP: ${m.mcpReads} successful reads, ${m.mcpReused} reused. Model cache: ${n(m.cacheReadTokens)} reused tokens, ${n(m.cacheWriteTokens)} written, ${n(m.inputTokens)} other input. Cost: ${m.costUsd.toFixed(3)} USD${m.unpricedRounds?' (partly unpriced)':''}. Providing a source does not yet verify a finding.`
 }
}
