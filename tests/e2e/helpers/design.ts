/**
 * Real files for the PowerPoint / Claude Design tests (tests/e2e/design-import.spec.ts), built in Node with
 * fflate: a 3-slide .pptx (a title slide, bullets with levels + speaker notes, a table + a picture + a chart;
 * a theme with colours and fonts), a Claude Design HTML export (CSS custom properties, Google Fonts, inline
 * styles, a data: picture, an inline SVG) and a PNG screenshot.
 */
import { strToU8, zipSync } from 'fflate'

/** A 1 × 1 PNG. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const xml = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`)
const rels = (list: Array<[string, string, string]>) =>
  xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`)

const run = (text: string, props = '') => `<a:r><a:rPr lang="en-US"${props}/><a:t>${text}</a:t></a:r>`
const para = (body: string, pPr = '') => `<a:p>${pPr ? `<a:pPr${pPr}/>` : ''}${body}</a:p>`
const off = (x: number, y: number, cx = 4000000, cy = 1000000) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
const IN = 914400

function sp(id: number, name: string, ph: string | null, body: string, xfrm = '') {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${ph ? '' : ' txBox="1"'}/><p:nvPr>${ph ?? ''}</p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`
}

const slideXml = (shapes: string) =>
  xml(`<p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`)

function tableFrame(rows: string[][]) {
  const cell = (s: string) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(run(s))}</a:txBody><a:tcPr/></a:tc>`
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${IN / 2}" y="${1.5 * IN}"/><a:ext cx="${5 * IN}" cy="${2 * IN}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${rows[0].map(() => '<a:gridCol w="1600000"/>').join('')}</a:tblGrid>${rows.map((r) => `<a:tr h="370840">${r.map(cell).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

const chartFrame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${IN / 2}" y="${4.5 * IN}"/><a:ext cx="${5 * IN}" cy="${2 * IN}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId4"/></a:graphicData></a:graphic></p:graphicFrame>`

const CHART = xml(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Signups</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart>
<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>2026</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Jul</c:v></c:pt><c:pt idx="1"><c:v>Aug</c:v></c:pt><c:pt idx="2"><c:v>Sep</c:v></c:pt></c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>180</c:v></c:pt><c:pt idx="2"><c:v>240</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
</c:barChart></c:plotArea></c:chart></c:chartSpace>`)

const THEME = xml(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Acme"><a:themeElements><a:clrScheme name="Acme">
<a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="F4EFE6"/></a:lt2>
<a:accent1><a:srgbClr val="FF5A1F"/></a:accent1><a:accent2><a:srgbClr val="2E86AB"/></a:accent2><a:accent3><a:srgbClr val="3BB273"/></a:accent3>
<a:accent4><a:srgbClr val="E1BC29"/></a:accent4><a:accent5><a:srgbClr val="7768AE"/></a:accent5><a:accent6><a:srgbClr val="E15554"/></a:accent6>
<a:hlink><a:srgbClr val="2E86AB"/></a:hlink><a:folHlink><a:srgbClr val="7768AE"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Acme"><a:majorFont><a:latin typeface="Space Grotesk"/></a:majorFont><a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`)

const MASTER = xml(`<p:sldMaster ${P}><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`)

const layout = (type: string) =>
  xml(
    `<p:sldLayout ${P} type="${type}"><p:cSld><p:spTree>${sp(2, 'Title', '<p:ph type="title"/>', para(''), off(IN / 2, IN / 4))}${sp(3, 'Content', '<p:ph idx="1"/>', para(''), off(IN / 2, 1.6 * IN))}</p:spTree></p:cSld></p:sldLayout>`,
  )

export interface PptxOptions {
  /** extra slides (to test the slide cap) */
  extraSlides?: number
}

/** "Quarterly review.pptx": a title slide, "Highlights" (bullets in two levels, a text box, notes), "Numbers" (a table, a picture, a chart). */
export function pptxBytes(o: PptxOptions = {}): Uint8Array {
  const slide1 = slideXml(sp(2, 'Title 1', '<p:ph type="ctrTitle"/>', para(run('Quarterly review'))) + sp(3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', para(run('Q3 2026 · Team update'))))
  const slide2 = slideXml(
    sp(2, 'Title 1', '<p:ph type="title"/>', para(run('Highlights'))) +
      sp(5, 'TextBox 4', null, para(run('Source: finance dashboard', ' i="1"')), off(IN / 2, 6 * IN)) +
      sp(3, 'Content 2', '<p:ph idx="1"/>', para(run('Revenue up ') + run('12 %', ' b="1"')) + para(run('Mostly in October'), ' lvl="1"') + para(run('Two new clients signed')) + para('<a:endParaRPr lang="en-US"/>')),
  )
  const slide3 = slideXml(
    sp(2, 'Title 1', '<p:ph type="title"/>', para(run('Numbers'))) +
      tableFrame([
        ['Month', 'Revenue', 'Clients'],
        ['July', '41,000', '12'],
        ['August', '44,500', '13'],
      ]) +
      `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4" descr="Revenue by month"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${off(6 * IN, 1.5 * IN)}</p:spPr></p:pic>` +
      chartFrame,
  )
  const notes2 = xml(
    `<p:notes ${P}><p:cSld><p:spTree>${sp(2, 'Slide Image 1', '<p:ph type="sldImg"/>', '')}${sp(3, 'Notes 2', '<p:ph type="body" idx="1"/>', para(run('Mention the October spike.')) + para(run('Thank the sales team.')))}</p:spTree></p:cSld></p:notes>`,
  )
  const extra = Array.from({ length: o.extraSlides ?? 0 }, (_, i) => i + 4)
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'docProps/core.xml': xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Q3 deck</dc:title></cp:coreProperties>'),
    'ppt/presentation.xml': xml(
      `<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${[2, 3, 4, ...extra.map((n) => n + 2)].map((r, i) => `<p:sldId id="${256 + i}" r:id="rId${r}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    ),
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'slide', 'slides/slide2.xml'],
      ['rId4', 'slide', 'slides/slide3.xml'],
      ['rId5', 'theme', 'theme/theme1.xml'],
      ...extra.map((n): [string, string, string] => [`rId${n + 2}`, 'slide', `slides/slide${n}.xml`]),
    ]),
    'ppt/theme/theme1.xml': THEME,
    'ppt/slideMasters/slideMaster1.xml': MASTER,
    'ppt/slideLayouts/slideLayout1.xml': layout('title'),
    'ppt/slideLayouts/slideLayout2.xml': layout('obj'),
    'ppt/slides/slide1.xml': slide1,
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/slides/slide2.xml': slide2,
    'ppt/slides/_rels/slide2.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml'],
      ['rId2', 'notesSlide', '../notesSlides/notesSlide2.xml'],
    ]),
    'ppt/slides/slide3.xml': slide3,
    'ppt/slides/_rels/slide3.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml'],
      ['rId3', 'image', '../media/image1.png'],
      ['rId4', 'chart', '../charts/chart1.xml'],
    ]),
    'ppt/notesSlides/notesSlide2.xml': notes2,
    'ppt/charts/chart1.xml': CHART,
    'ppt/media/image1.png': new Uint8Array(PNG),
  }
  for (const n of extra) {
    files[`ppt/slides/slide${n}.xml`] = slideXml(sp(2, 'Title 1', '<p:ph type="title"/>', para(run(`Extra ${n}`))))
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml']])
  }
  return zipSync(files)
}

/**
 * The same deck, but one entry's central-directory record claims 250 MB unpacked (a zip bomb's lie) — the
 * reader must refuse it from the declared sizes, before inflating anything.
 */
export function pptxBombBytes(): Uint8Array {
  const bytes = pptxBytes()
  const name = new TextEncoder().encode('ppt/slides/slide1.xml')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < bytes.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const len = view.getUint16(i + 28, true)
    const got = bytes.subarray(i + 46, i + 46 + len)
    if (len === name.length && got.every((b, k) => b === name[k])) {
      view.setUint32(i + 24, 250 * 1024 * 1024, true)
      return bytes
    }
  }
  throw new Error('entry not found')
}

/** A Claude Design HTML export: CSS custom properties, Google Fonts, a type scale, radii, spacing, inline styles, a data: picture, an inline SVG. */
export function designHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Launch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&amp;family=Inter:wght@400;600&amp;display=swap" rel="stylesheet">
<style>
:root { --bg: #FAF7F2; --ink: #1A1A1A; --brand: #FF5A1F; --muted: #6B6B6B; --radius-sm: 4px; --radius-lg: 12px; --space-2: 8px; --space-4: 16px; }
body { font-family: 'Inter', system-ui, sans-serif; font-size: 16px; background: var(--bg); color: var(--ink); margin: 0; padding: 24px; }
h1 { font-family: 'Space Grotesk', sans-serif; font-size: 48px; letter-spacing: -0.02em; }
h2 { font-size: 2rem; }
.card { border-radius: var(--radius-lg); padding: 16px 24px; border: 1px solid #E4DED3; gap: 8px; }
.btn { background: var(--brand); color: #fff; border-radius: 999px; padding: 8px 16px; }
code { font-family: 'JetBrains Mono', monospace; font-size: 14px; }
</style></head>
<body><h1>Acme Launch</h1>
<p>The new <strong>Acme</strong> app ships on <em>November 3</em>.</p>
<div class="card"><h2>What’s new</h2><ul><li>Faster sync</li><li>Offline mode</li></ul></div>
<img src="data:image/png;base64,${PNG.toString('base64')}" alt="Hero shot">
<svg viewBox="0 0 10 10" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>
<p style="color:#2E86AB;font-size:18px">Questions? Write to <a href="mailto:hello@acme.example">hello@acme.example</a>.</p>
<script>window.__designPwned = true</script>
</body></html>`
}
