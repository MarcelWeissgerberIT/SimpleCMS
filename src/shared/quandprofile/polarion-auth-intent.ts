/** Interpret only the current human instruction. Source text and model plans never grant access. */
const germanCommands = [
  /^(?:melde (?:dich|mich) (?:bei|in) polarion an|log(?:ge?)? (?:dich|mich) (?:bei|in) polarion ein)$/u,
  /^(?:(?:dich|mich) )?(?:bei |in )?polarion (?:anmelden|einloggen)$/u,
  /^(?:anmelden|einloggen) (?:bei|in) polarion$/u,
  /^(?:verbinde (?:dich|mich) mit (?:meinem |dem )?polarion|(?:(?:dich|mich) )?mit (?:meinem |dem )?polarion verbinden)$/u,
  /^(?:verbinde (?:(?:meinen?|den) )?polarion[- ]zugang|(?:(?:meinen?|den) )?polarion[- ]zugang verbinden)$/u,
  /^(?:polarion verbinden|verbinde polarion)$/u,
  /^(?:starte|öffne|oeffne|erneuere) (?:die |meine |den |meinen )?polarion[- ](?:anmeldung|login|verbindung)$/u,
  /^(?:die |meine |den |meinen )?polarion[- ](?:anmeldung|login|verbindung) (?:starten|öffnen|oeffnen|erneuern|herstellen)$/u,
  /^(?:(?:die |meine |den |meinen )?(?:anmeldung|login|verbindung) (?:bei|für|fuer|zu) polarion (?:starten|öffnen|oeffnen|erneuern|herstellen)|(?:starte|öffne|oeffne|erneuere) (?:die |meine |den |meinen )?(?:anmeldung|login|verbindung) (?:bei|für|fuer|zu) polarion)$/u,
  /^(?:ich möchte|ich moechte|ich will) mich (?:bei|in) polarion (?:anmelden|einloggen)$/u,
]
const englishCommands = [
  /^(?:log|sign) (?:me )?in(?:to| to| on)? polarion$/u,
  /^(?:log|sign) me (?:in)?to polarion$/u,
  /^(?:login|log in|sign in|sign-in|signin) (?:to |into )?polarion$/u,
  /^polarion (?:login|log in|sign in|sign-in|signin)$/u,
  /^(?:reconnect|connect|authenticate|re-authenticate|reauthenticate) (?:me )?(?:to |with |in )?(?:my |the )?polarion(?: access| connection| sign[- ]in)?$/u,
  /^polarion (?:reconnect|connect|authenticate|re-authenticate|reauthenticate)$/u,
  /^(?:start|open|begin|renew) (?:my |the )?polarion (?:login|log in|sign[- ]in|authentication|connection)$/u,
  /^(?:start|open|begin|renew) (?:my |the )?(?:login|log in|sign[- ]in|authentication|connection) (?:for|to|with) polarion$/u,
  /^(?:i want|i would like|i'd like) to (?:log|sign) in(?:to| to)? polarion$/u,
]

function isAuthenticationCommand(clause:string):boolean {
  // Negations, explanations and conditions must not become executable login requests.
  if (/\b(?:nicht|nie|niemals|kein\w*|not|never|don't|dont|without|ohne|unless|if|wenn|falls)\b/u.test(clause)) return false
  const command=clause
    .replace(/\b(?:noch einmal|once more|one more time)\b/gu,' ')
    .replace(/\b(?:bitte|please|mal|einmal|nochmal|nochmals|erneut|wieder|neu|jetzt|again|now)\b/gu,' ')
    .replace(/\bback in\b/gu,'in')
    .replace(/,/gu,' ').replace(/\s+/gu,' ').trim()
    .replace(/^(?:(?:kannst|könntest|koenntest|würdest|wuerdest) du|(?:can|could|would|will) you) /u,'')
  return [...germanCommands,...englishCommands].some(pattern=>pattern.test(command))
}

export function polarionAuthenticationIntent(goal:string):{requested:boolean;otherInstructions:string} {
  const text=goal.normalize('NFKC').toLowerCase()
    // Keep a marker: removing a quote entirely could join its neighbours into a command.
    .replace(/["“„`][^"“”„`]*["”`]|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu,' [quoted] ')
    .replace(/’/gu,"'").replace(/\s+/gu,' ')
  // A trailing "then sign in" must not detach from an unresolved condition or
  // a request to explain steps. Splitting conjunctions cannot manufacture consent.
  if (/\b(?:if|unless|wenn|falls)\b/u.test(text)
    || /^\s*(?:bitte |please )?(?:erkläre|erklaere|explain|beschreibe|describe|wie|how)\b/u.test(text)) {
    return {requested:false,otherInstructions:text}
  }
  const clauses=text.split(/[.!?;]\s*|\s+(?:und|and|dann|then)(?:\s+(?:dann|then))?\s+/u)
  let requested=false
  const otherInstructions=clauses.filter(clause=>{
    if(!isAuthenticationCommand(clause.trim()))return true
    requested=true
    return false
  }).join('. ')
  return {requested,otherInstructions}
}

export function polarionAuthenticationRequested(goal:string):boolean {
  return polarionAuthenticationIntent(goal).requested
}
