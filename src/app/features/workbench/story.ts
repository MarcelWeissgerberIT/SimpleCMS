import {sanitizeDeskRecords,type DeskRecords,type StoryFrame,type SlideLayout,type Card} from './model'
export const LAYOUT_DRAG='application/x-one-slide-layout'
export const SLIDE_DRAG='application/x-one-story-slide'
export const slideLimit=30
export const capacity=(layout:SlideLayout)=>layout==='compare'?2:layout==='timeline'?4:layout==='decision'?3:1
export const framesOf=(records:DeskRecords)=>Object.values(records).filter((r):r is StoryFrame=>r.type==='slide'&&!r.removed).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))
export function layouts(de:boolean){return [
 {id:'statement',symbol:'Aa',title:de?'Kernaussage':'Key message',hint:de?'Ein Gedanke. Große Wirkung.':'One thought. A strong impression.'},
 {id:'metric',symbol:'42',title:de?'Zahl im Fokus':'Number in focus',hint:de?'Eine Zahl mit Einordnung.':'One number with context.'},
 {id:'compare',symbol:'↔',title:de?'Gegenüberstellung':'Comparison',hint:de?'Zwei Perspektiven nebeneinander.':'Two perspectives side by side.'},
 {id:'timeline',symbol:'→',title:de?'Ablauf':'Sequence',hint:de?'Bis zu vier Schritte verbinden.':'Connect up to four steps.'},
 {id:'quote',symbol:'“',title:de?'Beleg':'Evidence',hint:de?'Die Originalaussage im Fokus.':'Put the original quote in focus.'},
 {id:'decision',symbol:'✓',title:de?'Entscheidung':'Decision',hint:de?'Vorschlag, Begründung, nächster Schritt.':'Proposal, rationale, next step.'},
] as const}
export type StorySlide={frame:StoryFrame;cards:(Card|undefined)[]}
export function buildStory(value:unknown,available:Card[]):StorySlide[]{return framesOf(sanitizeDeskRecords(value)).map(frame=>({frame,cards:frame.cards.map(id=>available.find(c=>c.id===id))}))}
export function storyIssue(slide:StorySlide,de:boolean){
 if(!slide.cards.length||slide.cards.some(c=>!c))return de?'Ergänze die fehlenden Aussagen.':'Add the missing statements.'
 if(slide.frame.layout==='compare'&&slide.cards.length!==2)return de?'Für den Vergleich fehlen noch zwei vollständige Seiten.':'A comparison needs two statements.'
 if(slide.frame.layout==='metric'&&!slide.frame.metric.trim())return de?'Trage die Zahl aus deiner Quelle ein.':'Enter the number from your source.'
 return ''
}
