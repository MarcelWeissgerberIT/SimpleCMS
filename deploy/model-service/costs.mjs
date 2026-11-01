/** Dated operating-cost allocation, not an invoice or GPU profiler. No prompt bodies are read. */
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0
const HOUR=3600000
export function readCostPlan(value){
 if(!value||value.currency!=='EUR'||!finite(value.computePerHour)||!finite(value.diskPerMonth)||!/^\d{4}-\d{2}-\d{2}$/.test(value.asOf??'')||typeof value.source!=='string'||!value.source.trim()||value.source.length>300)throw Error('Invalid host cost plan')
 return {currency:'EUR',computePerHour:value.computePerHour,diskPerMonth:value.diskPerMonth,asOf:value.asOf,source:value.source}
}
// Prorate storage using the actual UTC calendar month, not an assumed 30-day month.
function diskCost(from,to,monthly){let sum=0;for(let at=from;at<to;){const d=new Date(at),start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1),next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1),end=Math.min(to,next);sum+=monthly*(end-at)/(next-start);at=end}return sum}
export function hostCosts(records,{plan,from,to}){
 const rate=readCostPlan(plan)
 if(!finite(from)||!finite(to)||to<from||to>8640000000000000)throw Error('Invalid host cost window')
 const rows=new Map(),events=[],seen=new Set();let incompleteRounds=0,overlapMs=0
 for(const r of records){
  if(r.kind==='run'||typeof r.auditId!=='string'||seen.has(r.auditId))continue
  seen.add(r.auditId)
  const start=r.processingAt,end=r.finishedAt
  if(!finite(start)||start===0)continue // Rejected or queued requests have no model occupancy.
  if(!finite(end)||end<start){if(start>=from&&start<to)incompleteRounds++;continue}
  const a=Math.max(from,start),b=Math.min(to,end);if(b<=a)continue
  const workspace=typeof r.trace?.workspace==='string'?r.trace.workspace:null
  const user=typeof r.trace?.user==='string'?r.trace.user:null
  const task=typeof r.trace?.run==='string'?r.trace.run:typeof r.trace?.job==='string'?r.trace.job:r.auditId
  const id=JSON.stringify([workspace,user,task]);let row=rows.get(id)
  if(!row){row={task,workspace,user,rounds:0,failedRounds:0,occupancyMs:0,allocatedMs:0,queueMs:0,computeEUR:0};rows.set(id,row)}
  row.rounds++;if(r.state!=='processed')row.failedRounds++
  row.occupancyMs+=b-a
  const queued=finite(r.queuedAt)&&r.queuedAt<=start?r.queuedAt:finite(r.receivedAt)&&r.receivedAt<=start?r.receivedAt:start
  row.queueMs+=Math.max(0,Math.min(to,start)-Math.max(from,queued))
  events.push({at:a,row,delta:1},{at:b,row,delta:-1})
 }
 events.sort((a,b)=>a.at-b.at||a.delta-b.delta)
 const active=new Map();let previous=from,busyMs=0
 for(const event of events){
  const elapsed=event.at-previous,count=[...active.values()].reduce((a,b)=>a+b,0)
  if(count&&elapsed>0){busyMs+=elapsed;if(count>1)overlapMs+=elapsed;for(const [row,n]of active)row.allocatedMs+=elapsed*n/count}
  const n=(active.get(event.row)??0)+event.delta;if(n)active.set(event.row,n);else active.delete(event.row)
  previous=event.at
 }
 const tasks=[...rows.values()];for(const row of tasks)row.computeEUR=row.allocatedMs/HOUR*rate.computePerHour
 const workspaces=new Map()
 for(const row of tasks){const id=row.workspace??'';let w=workspaces.get(id);if(!w){w={workspace:row.workspace,tasks:0,rounds:0,failedRounds:0,occupancyMs:0,allocatedMs:0,queueMs:0,computeEUR:0};workspaces.set(id,w)}w.tasks++;for(const k of ['rounds','failedRounds','occupancyMs','allocatedMs','queueMs','computeEUR'])w[k]+=row[k]}
 const computeEUR=(to-from)/HOUR*rate.computePerHour,allocatedComputeEUR=busyMs/HOUR*rate.computePerHour,diskEUR=diskCost(from,to,rate.diskPerMonth)
 return {schema:'one.host-costs.v1',basis:'estimate',window:{from,to,kind:'current-vm-boot'},rate,totals:{computeEUR,diskEUR,estimatedEUR:computeEUR+diskEUR,allocatedComputeEUR,unallocatedComputeEUR:Math.max(0,computeEUR-allocatedComputeEUR),busyMs,incompleteRounds,overlapMs,rounds:tasks.reduce((s,r)=>s+r.rounds,0)},workspaces:[...workspaces.values()].sort((a,b)=>b.computeEUR-a.computeEUR),tasks:tasks.sort((a,b)=>b.computeEUR-a.computeEUR),excludes:['ipv4','snapshots','egress','tax'],method:'completed-gateway-occupancy; concurrent intervals shared equally; queue and tools excluded; residual includes idle and missing logs'}
}
