import {useLang} from '../../i18n'
import {sourceHref,levels,levelsEn} from './model'
import {layouts,type StorySlide as StorySlideData} from './story'
import './story.css'
const excerpt=(text:string,max:number)=>text.length>max?text.slice(0,max).trimEnd()+'…':text
export function StorySlide({slide}:{slide:StorySlideData}){
 const de=useLang()==='de',{frame,cards}=slide,first=cards[0],layout=layouts(de).find(l=>l.id===frame.layout)!
 const heading=frame.title||((frame.layout==='statement'||frame.layout==='metric'||frame.layout==='quote')?first?.title:'')||layout.title
 return <article className="story-slide" data-layout={frame.layout}>
  <div className="story-slide-label"><span>ONE / {layout.title}{frame.generated?(de?' · KI-Entwurf':' · AI draft'):''}</span><span aria-hidden="true">{layout.symbol}</span></div>
  {frame.layout==='metric'&&<div className="story-metric">{frame.metric||'—'}</div>}
  <h2>{heading}</h2>
  {frame.caption&&<p className="story-caption">{frame.caption}</p>}
  {frame.layout==='quote'?<blockquote>{first?excerpt(first.source.quote,600):(de?'Originalaussage hier ablegen':'Drop an original statement here')}</blockquote>:
   <div className="story-slide-body">{cards.length?cards.map((c,i)=><div className="story-slide-item" key={frame.cards[i]}>
    {frame.layout==='timeline'&&<span className="story-step">{String(i+1).padStart(2,'0')}</span>}
    {frame.layout==='decision'&&<span className="story-item-label">{(de?['Vorschlag','Begründung','Nächster Schritt']:['Proposal','Rationale','Next step'])[i]}</span>}
    {['compare','timeline','decision'].includes(frame.layout)&&<h3>{frame.content?.find(item=>item.card===c?.id)?.title??c?.title??(de?'Aussage nicht verfügbar':'Statement unavailable')}</h3>}
    <p>{c?excerpt(frame.content?.find(item=>item.card===c.id)?.text??(c.detail||c.source.quote),frame.content?.some(item=>item.card===c.id)?600:frame.layout==='statement'?500:320):(de?'Bitte Aussage ersetzen.':'Please replace this statement.')}</p>
   </div>):<p className="story-placeholder">{de?'Ziehe deine Aussage in diese Folie.':'Drag your statement into this slide.'}</p>}</div>}
  <footer className="story-slide-sources">{cards.map((c,i)=>c?<a href={sourceHref(c)} target="_blank" rel="noopener noreferrer" title={de?'Quelle in neuem Tab öffnen':'Open source in a new tab'} key={c.id} data-no-nav="">{i+1}. {c.source.label} · {(de?levels:levelsEn)[c.level]} ↗</a>:<span key={i}>{de?'Quelle nicht verfügbar':'Source unavailable'}</span>)}</footer>
 </article>
}
