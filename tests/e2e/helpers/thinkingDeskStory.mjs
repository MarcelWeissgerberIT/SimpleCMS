/** Fictional, local-only example for reproducible UI screenshots. No model or Atlas calls. */
export async function seedThinkingDesk(page){
 return page.evaluate(async()=>{
  const s=window.__one.workspace.getState(),topics=[['SSO promised','The questionnaire lists SSO for release 1.0.','Questionnaire',1],['Local accounts only','The implementation note limits release 1.0 to local accounts.','Implementation',2],['Backup restore checked','A recorded restore check passed with the reference dataset.','Test report',3],['Approval pending','The team must approve the customer response before delivery.','Release review',1],['Add SSO later?','Could the next release introduce federated sign-in?','Assumption',0],['Revise the response','Align the customer response with the confirmed release scope.','Next step',1]];
  const id=s.createPage({title:'Release 1.0 · What can we promise?'}),records={};
  for(let i=0;i<topics.length;i++){
   const [title,detail,label,level]=topics[i],pid=s.createPage({title:label}),content={type:'doc',content:[{type:'paragraph',attrs:{id:'source-'+i},content:[{type:'text',text:detail}]}]};s.setContent(pid,content,'e2e');
   const p=window.__one.workspace.getState().pages[pid],bytes=new TextEncoder().encode(JSON.stringify([p.title,p.content])),signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   records['card-'+i]={type:'card',id:'card-'+i,at:Date.now(),by:'Review team',title,detail,source:{kind:level===0?'note':'page',pageId:pid,blockId:'source-'+i,quote:detail,signature,label},x:(i%3)*500,y:Math.floor(i/3)*280,group:label,level,evidence:level>=2?'Recorded review for this fictional example.':'',evidenceUrl:level>=2?'https://example.com/review':'',assessment:level>=2?{by:'Review team',at:Date.now()}:undefined};
  }
  const link=(id,a,b,relation,detail)=>({type:'link',id,a,b,relation,detail,at:Date.now(),by:'Review team'});
  records['link-conflict']=link('link-conflict','card-0','card-1','conflict','The promised login capability differs from the implementation note.');
  records['link-dependency']=link('link-dependency','card-3','card-5','depends','The revised response requires team approval.');
  records['link-support']=link('link-support','card-1','card-5','supports','The implementation note provides the scope for the revised response.');
  s.updatePage(id,{workbench:true,workbenchRecords:records,icon:{type:'lucide',value:'Layers'},settings:{...window.__one.workspace.getState().pages[id].settings,fullWidth:true}});location.hash='#/p/'+id;return id;
 });
}
