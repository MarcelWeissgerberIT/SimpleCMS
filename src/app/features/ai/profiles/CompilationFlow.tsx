import {useState} from 'react'
import {useT} from '../../../i18n'
const stages=['input','compile','dispatch','evidence','result','accept'] as const
/** Explains the real pipeline. This diagram never emits proof or execution state. */
export function CompilationFlow(){const t=useT(),[selected,setSelected]=useState<typeof stages[number]>('compile')
 return <section className="cube-flow" aria-label={t('features.ai.cube.flowTitle')}>
  <header><span className="label">§ COMPILER · RUST / WASM</span><h3>{t('features.ai.cube.flowTitle')}</h3><p>{t('features.ai.cube.flowIntro')}</p></header>
  <ol>{stages.map((stage,i)=><li key={stage}><button type="button" aria-pressed={selected===stage} onClick={()=>setSelected(stage)}><span className="cube-flow__glyph" aria-hidden="true"><svg viewBox="0 0 64 64"><polygon points="10,19 39,8 55,18 26,29"/><polygon points="26,29 55,18 55,47 26,58"/><polygon points="10,19 26,29 26,58 10,48"/><path d="M10,19 L10,48 L39,37 L39,8 M39,37 L55,47"/><text x="35" y="43">{String(i+1).padStart(2,'0')}</text></svg></span><strong>{t('features.ai.cube.flow.'+stage)}</strong></button>{i<stages.length-1&&<span className="cube-flow__arrow" aria-hidden="true">→</span>}</li>)}</ol>
  <div className="cube-flow__explanation" aria-live="polite"><span className="label">{stages.indexOf(selected)+1} / 6</span><h4>{t('features.ai.cube.flow.'+selected)}</h4><p>{t('features.ai.cube.flowHelp.'+selected)}</p></div>
  <p className="cube-flow__limit">{t('features.ai.cube.repeat')}</p>
 </section>
}
