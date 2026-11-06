/** Small local illustrations: no generated content, uploads or network requests. */
export function SkillThumbnail({name,tags=[]}:{name:string;tags?:string[]}){
 const topic=[name,...tags].join(' ').toLowerCase()
 const kind=/code|repo|analyse|analysis/.test(topic)?'code':/atlas|abgleich|sync|align/.test(topic)?'sync':/mock|design|ui/.test(topic)?'mock':'document'
 return <svg className="skill-thumbnail" viewBox="0 0 200 120" aria-hidden="true" focusable="false" data-motif={kind}>
  <rect className="skill-thumbnail__paper" x=".5" y=".5" width="199" height="119" rx="4"/>
  <path className="skill-thumbnail__rule" d="M16 20h168M16 100h168"/>
  <path className="skill-thumbnail__accent" d="M16 20h32" strokeWidth="4"/>
  <g className="skill-thumbnail__ink" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
   {kind==='code'?<>
    <rect className="skill-thumbnail__card" x="18" y="34" width="78" height="50" rx="3"/><path d="m38 48-8 10 8 10m36-20 8 10-8 10m-15-22-7 24"/>
    <path className="skill-thumbnail__rule" d="M96 59h20m0-12v26m0-26h14m-14 26h14"/>
    <rect className="skill-thumbnail__card" x="130" y="35" width="51" height="25" rx="3"/><rect className="skill-thumbnail__card" x="130" y="67" width="51" height="25" rx="3"/>
    <path className="skill-thumbnail__accent" d="m140 47 4 4 8-9m-12 37 4 4 8-9"/><path className="skill-thumbnail__rule" d="M158 47h13m-13 32h13"/>
   </>:kind==='sync'?<>
    <rect className="skill-thumbnail__card" x="24" y="33" width="54" height="56" rx="3"/><rect className="skill-thumbnail__card" x="123" y="33" width="54" height="56" rx="3"/>
    <path d="M35 47h23m-23 11h32m-32 11h24m65-22h23m-23 11h32m-32 11h24"/>
    <path className="skill-thumbnail__accent" d="M87 49h25m-6-6 6 6-6 6M113 73H88m6-6-6 6 6 6"/>
   </>:kind==='mock'?<>
    <rect className="skill-thumbnail__card" x="27" y="32" width="146" height="60" rx="3"/><path className="skill-thumbnail__rule" d="M27 44h146M61 44v48M37 55h14m-14 9h14m-14 9h10"/>
    <rect x="72" y="54" width="40" height="27" rx="2"/><path d="M123 55h37m-37 9h28"/><rect className="skill-thumbnail__signal-fill" stroke="none" x="123" y="74" width="28" height="8" rx="1"/>
   </>:<>
    <rect className="skill-thumbnail__card" x="66" y="29" width="77" height="60" rx="3"/><rect className="skill-thumbnail__card" x="54" y="36" width="77" height="60" rx="3"/>
    <path d="M67 49h33m-33 11h49m-49 10h49m-49 10h26"/>
    <path className="skill-thumbnail__accent" d="m146 70 7 7 14-18"/>
   </>}
  </g>
 </svg>
}
