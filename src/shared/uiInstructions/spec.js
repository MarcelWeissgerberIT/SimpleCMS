// Format adapter from the local UI Instructions project. Kept executable by browser and Node tests.
import {readBehavior} from './behavior.js';
const identifier=/^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
export function parseSpecification(markdown){
 const errors=[],warnings=[],documents=Object.create(null);const fail=message=>({valid:false,errors:[message],warnings,manifest:null,documents});
 if(typeof markdown!=='string'||markdown.length>12_000_000)return fail('Markdown fehlt oder ist größer als 12 MB.');
 markdown=markdown.replace(/\r\n/g,'\n');
 const manifests=[...markdown.matchAll(/<!-- ui-manifest:start -->\s*```json\s*([\s\S]*?)\n```\s*<!-- ui-manifest:end -->/g)];if(manifests.length!==1)return fail('Genau ein Komponentenindex benötigt. Ältere Exporte ohne Index bitte neu analysieren.');
 let manifest;try{manifest=JSON.parse(manifests[0][1]);}catch{return fail('Komponentenindex enthält ungültiges JSON.');}
 if(!manifest||manifest.version!==1||!Array.isArray(manifest.definitions)||!Array.isArray(manifest.trees))return fail('Unbekanntes oder ungültiges Komponentenformat.');
 if(manifest.definitions.length>5000||manifest.trees.length>30)return fail('Komponentenindex überschreitet die unterstützte Größe.');
 for(const m of markdown.matchAll(/<!-- ui-component:([A-Za-z][A-Za-z0-9_-]{0,79}):start -->\n([\s\S]*?)\n<!-- ui-component:\1:end -->/g)){if(Object.hasOwn(documents,m[1]))errors.push(`Doppelte Komponenten-MD: ${m[1]}`);documents[m[1]]=m[2];}
 const starts=[...markdown.matchAll(/<!-- ui-component:([A-Za-z][A-Za-z0-9_-]{0,79}):start -->/g)];const ends=[...markdown.matchAll(/<!-- ui-component:([A-Za-z][A-Za-z0-9_-]{0,79}):end -->/g)];if(starts.length!==Object.keys(documents).length||ends.length!==Object.keys(documents).length)errors.push('Komponenten-Marker fehlen, sind doppelt oder falsch verschachtelt.');
 const defs=new Map();for(const d of manifest.definitions){if(!d||!identifier.test(d.id)||typeof d.name!=='string'||typeof d.kind!=='string'){errors.push('Ungültige Komponentendefinition.');continue;}if(d.thumbnail&&(!isSafeThumbnail(d.thumbnail.dataUrl)||!Number.isFinite(d.thumbnail.width)||!Number.isFinite(d.thumbnail.height)))errors.push('Ungültiges Vorschaubild: '+d.id);if(defs.has(d.id))errors.push('Doppelte Komponenten-ID: '+d.id);defs.set(d.id,d);if(!documents[d.id]?.trim())errors.push('Komponenten-MD fehlt: '+d.id);else if(!documents[d.id].split('\n').some(line=>line.trim()==='Komponenten-ID: '+d.id))errors.push('Komponenten-ID fehlt oder widerspricht der MD: '+d.id);}
 for(const id of Object.keys(documents))if(!defs.has(id))errors.push('MD ohne Definition: '+id);
 for(const [id,doc] of Object.entries(documents))for(const error of readBehavior(doc).errors)errors.push(id+': '+error);
 const treeIds=new Set(),used=new Set();let total=0;
 for(const t of manifest.trees){if(!t||!identifier.test(t.id)||typeof t.name!=='string'||!Number.isFinite(t.width)||!Array.isArray(t.nodes)||t.nodes.length>6000){errors.push('Ungültiger oder zu großer Seitenbaum.');continue;}if(t.preview&&!isSafeThumbnail(t.preview.dataUrl))errors.push('Ungültige Seitenvorschau: '+t.id);total+=t.nodes.length;if(total>20000)return fail('Zu viele Instanzen im Komponentenindex.');if(treeIds.has(t.id))errors.push('Doppelte Baum-ID: '+t.id);treeIds.add(t.id);const nodes=new Map();for(const n of t.nodes){if(!n||!identifier.test(n.id)||typeof n.componentId!=='string'||(n.label!==undefined&&typeof n.label!=='string')||(n.parentId!==null&&typeof n.parentId!=='string')){errors.push('Ungültiger Baumknoten.');continue;}if(n.thumbnail&&!isSafeThumbnail(n.thumbnail.dataUrl))errors.push('Ungültige Instanzvorschau: '+n.id);if(nodes.has(n.id))errors.push('Doppelte Instanz-ID: '+n.id);nodes.set(n.id,n);if(!defs.has(n.componentId))errors.push('Unbekannte Komponente: '+n.componentId);used.add(n.componentId);}
 for(const n of nodes.values()){if(n.parentId&&!nodes.has(n.parentId))errors.push('Fehlender Elternknoten: '+n.id+' → '+n.parentId);let cursor=n,seen=new Set();while(cursor){if(seen.has(cursor.id)){errors.push('Zyklus im Baum: '+n.id);break;}seen.add(cursor.id);if(seen.size>100){errors.push('Baum zu tief: '+n.id);break;}cursor=nodes.get(cursor.parentId);}}
 }
 for(const id of defs.keys())if(!used.has(id))warnings.push('Komponente ohne Instanz: '+id);
 if(!manifest.definitions.length)warnings.push('Keine Komponenten enthalten.');
 return {valid:!errors.length,errors:[...new Set(errors)],warnings,manifest,documents};
}
export function replaceComponentDocument(markdown,id,document){
 if(!identifier.test(id))throw new Error('Ungültige Komponenten-ID.');markdown=markdown.replace(/\r\n/g,'\n');document=document.replace(/\r\n/g,'\n');const start=`<!-- ui-component:${id}:start -->`,end=`<!-- ui-component:${id}:end -->`;const from=markdown.indexOf(start),to=markdown.indexOf(end,from);if(from<0||to<0)throw new Error('Komponentenabschnitt fehlt.');if(/<!-- ui-(?:component|manifest):/.test(document))throw new Error('Reservierte Strukturmarker sind im Einzel-MD nicht erlaubt.');return markdown.slice(0,from+start.length)+'\n'+document+'\n'+markdown.slice(to);
}

export function isSafeThumbnail(value){return typeof value==='string'&&value.length<=300000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);}
