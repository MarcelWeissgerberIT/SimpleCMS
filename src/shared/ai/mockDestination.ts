import type {DesignMock} from './designMock.ts'
/** Stable per-artifact identity lets a retry resume a partial upload without another child. */
export async function ensureMockDestination(a:DesignMock,call:(name:string,args:Record<string,unknown>)=>Promise<Record<string,any>>){
 const context=a.atlasContext
 if(!context)throw Error('Der Mock hat kein verknüpftes Design-Epic.')
 if(!/^[a-z0-9_-]{1,120}$/i.test(context.project)||!/^ui-package:[a-z0-9-]{1,50}$/.test(context.tag)||!/^[a-f0-9-]{36}$/.test(a.id))throw Error('Ungültige Mock-Zuordnung.')
 const root=(await call('atlas_get',{ref:context.ref,parts:[],includeConstraints:'none'})).item
 if(root?.kind!=='epic'||root.project!==context.project||!root.tags?.includes(context.tag)||root.archived===true)throw Error('Das Design-Epic ist nicht mehr verfügbar oder anders zugeordnet.')
 const tag='one-ui-mock:'+a.id,marker='<!-- one-ui-mock: '+a.id+' '+a.htmlHash+' -->'
 const found=await call('atlas_search',{aql:`project = "${context.project}" AND tags IN ("${tag}")`,limit:2})
 const rows=found.rows??found.items
 if(!Array.isArray(rows)||(found.total??rows.length)>1||rows.length>1)throw Error('Die vorhandene Mock-Ablage konnte nicht eindeutig geprüft werden.')
 let ref=rows[0]?.ref
 if(!ref){
  await call('atlas_constraints',{project:context.project,kind:'doc'})
  const body=['# '+a.title,'Entwurf · fachliche und visuelle Prüfung offen.',marker,'## Anwendungsfall',a.request??a.title,'## Design-Kontext',`[${context.title}](${context.url}) · ${context.tag}`,'## Verwendete Quellen',...a.sources.map(s=>`- [${s.title}](${s.url}) · SHA-256 ${s.hash}`),'## Offene Punkte',...a.draft.notes.map(n=>'- '+n),'HTML, PNG und Quellennachweis werden als Anhänge an diesem Record abgelegt.'].join('\n\n')
  const created=await call('atlas_create',{project:context.project,kind:'doc',title:a.title.slice(0,200),parent:String(context.ref),tags:['ui-mock',context.tag,tag],body})
  ref=created.item?.ref??created.ref
 }
 if(!Number.isSafeInteger(ref)||ref<=0)throw Error('Atlas hat keinen eindeutigen Mock-Record bestätigt. Vor einem neuen Versuch wird nach der vorhandenen Ablage gesucht.')
 const saved=(await call('atlas_get',{ref,parts:['body'],includeConstraints:'none'})).item
 if(saved?.ref!==ref||saved.project!==context.project||saved.parent?.ref!==context.ref||!saved.tags?.includes(tag)||!saved.tags?.includes(context.tag)||!saved.body?.includes(marker))throw Error('Mock-Record wurde nicht vollständig bestätigt. Vorhandene Inhalte bleiben erhalten; bitte die Atlas-Zuordnung prüfen.')
 return {ref:ref as number,url:new URL('/r/'+ref,context.url).href}
}
