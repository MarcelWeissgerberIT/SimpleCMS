import type {Services} from '../context.ts'
import {isSealedText,keyFromSecret,openText,sealText} from '../crypto/aead.ts'
import {MINUTE,randomToken} from '../tokens.ts'
import {safeRedirect} from '../http/util.ts'

export const LOGIN_LINK_TTL=15*MINUTE
const REDIRECT_KEY='one/login-redirect/v1'
/** Ordinary links go only to mail; explicit owner-assisted enrollment is a separate, audited new-account path. */
export function issueLoginLink(s:Services,p:{email:string;redirect:string;lang:'en'|'de';browserHash?:string|null;inviteHash?:string|null;signupHash?:string|null;ttl?:number}){
 const token=randomToken(),now=Date.now()
 const ttl=p.ttl??LOGIN_LINK_TTL
 const redirect=sealText(keyFromSecret(token,REDIRECT_KEY),safeRedirect(p.redirect),'login-redirect')
 s.db.run(`INSERT INTO login_tokens (token_hash,email,created_at,expires_at,redirect,browser_hash,invite_hash,signup_hash,lang) VALUES(?,?,?,?,?,?,?,?,?)`,s.repo.hash(token),p.email,now,now+ttl,redirect,p.browserHash??null,p.inviteHash??null,p.signupHash??null,p.lang)
 return {link:`${s.config.publicUrl}/api/auth/verify?token=${token}`,expiresAt:now+ttl}
}
export function openLoginRedirect(token:string,stored:string|null):string|null{
 if(!stored||!isSealedText(stored))return stored
 try{return openText(keyFromSecret(token,REDIRECT_KEY),stored,'login-redirect')}catch{return null}
}
