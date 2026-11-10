export const workTemplateIds=['tasks','questions','checks','decisions'] as const
export type WorkTemplate=typeof workTemplateIds[number]
export const isWorkTemplate=(value:unknown):value is WorkTemplate=>workTemplateIds.includes(value as WorkTemplate)
export function workTemplates(de:boolean){return [
 {id:'tasks' as const,title:de?'Umsetzen':'Deliver',name:de?'Aufgaben':'Tasks',hint:de?'Aus Erkenntnissen werden nächste Schritte.':'Turn findings into next steps.',fields:de?'Aufgabe · Status · Verantwortlich · Fällig':'Task · Status · Owner · Due',view:'board' as const,criterion:de?'Erledigt, wenn':'Done when',statuses:de?['Offen','In Arbeit','Erledigt']:['Open','In progress','Done'],goal:de?'Welche konkreten nächsten Schritte bringen meine Arbeit voran?':'Which concrete next steps will move my work forward?'},
 {id:'questions' as const,title:de?'Klären':'Clarify',name:de?'Offene Fragen':'Open questions',hint:de?'Unklarheiten sammeln und Antworten nachhalten.':'Collect uncertainties and track answers.',fields:de?'Frage · Klärungsbedarf · Antwort · Status':'Question · Clarification needed · Answer · Status',view:'table' as const,criterion:de?'Zur Klärung benötigt':'Needed to resolve',statuses:de?['Offen','In Klärung','Geklärt']:['Open','Being clarified','Resolved'],goal:de?'Was muss ich klären, bevor ich sinnvoll weiterarbeiten kann?':'What do I need to clarify before I can move forward?'},
 {id:'checks' as const,title:de?'Prüfen':'Verify',name:de?'Prüfplan':'Verification plan',hint:de?'Aussagen in nachvollziehbare Prüfungen übersetzen.':'Turn claims into traceable checks.',fields:de?'Prüfpunkt · Erwartung · Ergebnis · Status':'Check · Expected outcome · Result · Status',view:'table' as const,criterion:de?'Prüfkriterium':'Acceptance criterion',statuses:de?['Ungeprüft','In Prüfung','Prüfung abgeschlossen']:['Not checked','Checking','Check completed'],goal:de?'Welche Aussagen brauchen einen Beleg und wie kann ich sie prüfen?':'Which claims need evidence and how can I check them?'},
 {id:'decisions' as const,title:de?'Entscheiden':'Decide',name:de?'Entscheidungsvorbereitung':'Decision preparation',hint:de?'Optionen, Abwägungen und offene Entscheidungen ordnen.':'Organize options, tradeoffs and pending decisions.',fields:de?'Entscheidungsfrage · Grundlage · Beschluss · Status':'Decision question · Basis · Decision · Status',view:'table' as const,criterion:de?'Für die Entscheidung benötigt':'Needed for a decision',statuses:de?['Vorbereiten','In Abstimmung','Entschieden']:['Preparing','Under discussion','Decided'],goal:de?'Welche Entscheidungen stehen an und welche Grundlagen fehlen noch?':'Which decisions are pending and what information is still missing?'}
]}
export function recommendedWorkTemplate(dimension:string):WorkTemplate{
 if(/widerspr|contradict|conflict|offene|open|gap/i.test(dimension))return 'questions'
 if(/entscheid|decision/i.test(dimension))return 'decisions'
 if(/prüf|check|test|verif/i.test(dimension))return 'checks'
 return 'tasks'
}
export const workInstructions:Record<WorkTemplate,string>={
 tasks:'Propose concrete next actions supported by the selected material. Use an action verb in each title. criterion describes an observable completion condition; leave it empty when unsupported.',
 questions:'Extract specific unresolved questions and uncertainties. Titles are questions. detail describes what is known and what is missing; criterion describes information needed to resolve the question. Never fill in the answer.',
 checks:'Propose verification work for source claims. detail describes the claim and an appropriate proposed check. criterion gives a source-supported expectation, otherwise leave it empty. Never claim a check ran or passed.',
 decisions:'Identify pending decisions. Titles express the decision to make. detail presents only options and tradeoffs present in the selected material. criterion states missing decision inputs. Never decide or approve on behalf of a person.'
}
