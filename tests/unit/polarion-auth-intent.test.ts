import {test} from 'node:test'
import assert from 'node:assert/strict'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'

const german = [
  'Polarion anmelden','bei Polarion anmelden','in Polarion einloggen',
  'mich bei Polarion anmelden','dich in Polarion einloggen','anmelden bei Polarion',
  'einloggen in Polarion','melde mich bei Polarion an','melde dich in Polarion an',
  'logge dich bei Polarion ein','log mich in Polarion ein','verbinde mich mit Polarion',
  'verbinde dich mit meinem Polarion','mich mit Polarion verbinden','mit dem Polarion verbinden',
  'verbinde meinen Polarion-Zugang','meinen Polarion-Zugang verbinden',
  'starte die Polarion-Anmeldung','öffne den Polarion-Login','erneuere meine Polarion-Verbindung',
  'Polarion Anmeldung starten','Polarion-Login öffnen','Polarion Verbindung herstellen',
  'Polarion Verbindung erneuern','ich möchte mich bei Polarion anmelden',
  'Polarion verbinden','verbinde Polarion','Anmeldung bei Polarion starten',
  'starte meine Anmeldung bei Polarion','Login für Polarion öffnen','öffne den Login fuer Polarion',
]
const english = [
  'log in to Polarion','log into Polarion','log me in to Polarion','sign me into Polarion',
  'sign in to Polarion','login to Polarion','sign-in to Polarion','Polarion login','Polarion sign in',
  'connect to Polarion','connect my Polarion access','connect me to Polarion',
  'reconnect to Polarion','reconnect me with Polarion','authenticate with Polarion',
  're-authenticate with Polarion','reauthenticate to Polarion','Polarion reconnect',
  'start the Polarion login','open my Polarion sign-in','begin Polarion authentication',
  'renew the Polarion connection','I want to log in to Polarion',"I'd like to sign into Polarion",
  'sign me in on Polarion','start the login for Polarion','open sign-in for Polarion',
  'renew my connection to Polarion',
]
for(const command of german)for(const goal of [command,`Bitte ${command}.`,`Bitte ${command} erneut!`])test(`German authentication only: ${goal}`,()=>{
  assert.deepEqual(taskBoundaries(goal),{readOnly:false,externalWrite:false,execute:false,authenticate:true})
})
for(const command of english)for(const goal of [command,`Please ${command}.`,`Please ${command} again!`])test(`English authentication only: ${goal}`,()=>{
  assert.deepEqual(taskBoundaries(goal),{readOnly:false,externalWrite:false,execute:false,authenticate:true})
})
for(const goal of [
  'Kannst du mich bitte bei Polarion anmelden?','Könntest du dich nochmal bei Polarion einloggen?',
  'Bitte könntest du meinen Polarion-Zugang wieder verbinden?','Wuerdest du die Polarion Anmeldung neu starten?',
  'Melde dich bitte noch einmal bei Polarion an','POLARION\n  ANMELDEN',
  'Could you please log me back in to Polarion?','Can you reconnect me to Polarion, please?',
  'Would you please start my Polarion login again?','Will you sign me into Polarion once more?',
])test(`Natural login request: ${goal}`,()=>{
  assert.deepEqual(taskBoundaries(goal),{readOnly:false,externalWrite:false,execute:false,authenticate:true})
})

for(const goal of [
  'Wie kann ich mich bei Polarion anmelden?','Kann ich mich bei Polarion anmelden?',
  'Kannst du erklären, wie ich mich bei Polarion anmelden kann?','Polarion Anmeldung funktioniert nicht',
  'Er kommt mit Polarion anmelden nicht klar','Ich bin schon bei Polarion angemeldet',
  'Bitte melde mich nicht bei Polarion an','Bitte niemals bei Polarion anmelden',
  'Polarion bitte noch nicht anmelden','Polarion anmelden erst nach meiner Freigabe',
  'Polarion Login Status prüfen','Warum muss ich mich wieder anmelden?',
  'How do I log in to Polarion?','Can I sign in to Polarion?','Could you explain Polarion login?',
  "Don't log me in to Polarion",'Do not reconnect to Polarion','Never reconnect me to Polarion',
  'Reconnect to Polarion only if I approve','Start the Polarion login unless already connected',
  'I am logged into Polarion','Please check the Polarion connection','Polarion login instructions',
  'Read only the phrase: Polarion anmelden','Explain “Polarion anmelden”.',
  '„Polarion anmelden“',"'Polarion anmelden'",'`Please reconnect to Polarion`',
  'Polarion "nicht" anmelden','Polarion „nicht“ anmelden','Please "never" reconnect to Polarion',
  'melde dich bei Atlas an','login to Salesforce','Please reconnect to PolarionX',
  'Please reconnect to Polarion on behalf of another user',
])test(`No login authority from mention or restriction: ${goal}`,()=>{
  assert.equal(taskBoundaries(goal).authenticate,false)
})

test('login and independent work keep their separate capabilities',()=>{
  assert.deepEqual(taskBoundaries('Start the Polarion login. Read only.'),{readOnly:true,externalWrite:false,execute:false,authenticate:true})
  assert.deepEqual(taskBoundaries('Polarion anmelden und dann nur lesen.'),{readOnly:true,externalWrite:false,execute:false,authenticate:true})
  assert.deepEqual(taskBoundaries('Starte die Polarion Anmeldung und starte den Testlauf.'),{readOnly:false,externalWrite:false,execute:true,authenticate:true})
  assert.deepEqual(taskBoundaries('Reconnect to Polarion and update the record.'),{readOnly:false,externalWrite:true,execute:false,authenticate:true})
  assert.equal(taskBoundaries('Nur in ONE arbeiten. Polarion anmelden.').authenticate,false)
})
