import type { Services } from '../context.ts'
import { openText, sealText } from '../crypto/aead.ts'
import { atlasLinkToken, type WelcomeDraft, type WelcomeRecipient } from '../../../src/shared/welcome.ts'
export interface Recipient extends WelcomeRecipient { atlasLink: string; atlasToken: string }
export interface Draft extends Omit<WelcomeDraft,'recipients'> { recipients: Recipient[] }
export class WelcomeStore {
  private s: Services
  constructor(s: Services) { this.s=s }
  private key(ws:string) { const k=this.s.repo.keys.forWorkspace(ws); if(!k)throw new Error('Workspace unavailable');return k.aead }
  read(ws:string,user:string):Draft|null {
    const row=this.s.db.get<{sealed:string}>('SELECT sealed FROM welcome_drafts WHERE workspace_id=? AND user_id=?',ws,user)
    return row?JSON.parse(openText(this.key(ws),row.sealed,`welcome\n${ws}\n${user}`)):null
  }
  save(ws:string,user:string,d:Draft) {
    this.s.db.run('INSERT INTO welcome_drafts(workspace_id,user_id,sealed,updated_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',ws,user,sealText(this.key(ws),JSON.stringify(d),`welcome\n${ws}\n${user}`),Date.now())
  }
  safe(d:Draft):WelcomeDraft {
    return {...d,recipients:d.recipients.map(({atlasLink,atlasToken,...r})=>({...r,hasAtlasLink:!!atlasLink,hasAtlasLinkToken:!!atlasLinkToken(atlasLink),hasAtlasToken:!!atlasToken,atlasHost:atlasLink?new URL(atlasLink).host:null}))}
  }
  grant(ws:string,user:string,id:string,r:Recipient,expires:number) {
    this.s.db.run('INSERT INTO welcome_access(id,workspace_id,user_id,target_workspace_id,email_hash,sealed,expires_at) VALUES(?,?,?,?,?,?,?)',id,ws,user,r.workspaceId,this.s.repo.hash(r.email),sealText(this.key(ws),JSON.stringify({atlasLink:r.atlasLink,atlasToken:r.atlasToken,name:r.name}),`welcome-access\n${ws}\n${id}`),expires)
  }
  open(ws:string,id:string,sealed:string) { return JSON.parse(openText(this.key(ws),sealed,`welcome-access\n${ws}\n${id}`)) as {atlasLink:string;atlasToken:string;name:string} }
}
