/**
 * Tiny real files for the "Claude for files" tests (tests/e2e/file-ai.spec.ts), built in Node: a Word
 * document (styles, numbering, a table, a link), an Excel workbook (two sheets, shared strings, a date
 * format, a hidden sheet), PDFs with any number of pages, CSV, HTML with a script, RTF.
 */
import { strToU8, zipSync } from 'fflate'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const p = (body: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`
const styled = (style: string, text: string) => p(run(text), `<w:pStyle w:val="${style}"/>`)
const listItem = (numId: number, ilvl: number, text: string) => p(run(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`)
const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(run(text))}</w:tc>`
const row = (cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`

/** "Quarterly report.docx": Title, H1 / H2 (German style ids, like Word in German), bold + italic, nested bullets, a numbered list, a table, a link. */
export function docxBytes(): Uint8Array {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${styled('Titel', 'Quarterly report Q3')}
${styled('berschrift1', 'Summary')}
${p(run('Revenue grew by ') + run('12 %', '<w:b/>') + run(' over the quarter, ') + run('mostly in October', '<w:i/>') + run('.'))}
${styled('berschrift2', 'Highlights')}
${listItem(1, 0, 'Two new clients signed')}
${listItem(1, 1, 'Acme GmbH in Berlin')}
${listItem(1, 0, 'Support backlog halved')}
${styled('berschrift2', 'Next steps')}
${listItem(2, 0, 'Hire a second designer')}
${listItem(2, 0, 'Ship the pricing page')}
<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>
${row(['Month', 'Revenue', 'Clients'])}
${row(['July', '41,000', '12'])}
${row(['August', '44,500', '13'])}
</w:tbl>
${p(run('Full figures: ') + `<w:hyperlink r:id="rId9">${run('finance dashboard')}</w:hyperlink>`)}
<w:sectPr/></w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/><w:basedOn w:val="Standard"/></w:style>
<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Standard"/></w:style>
</w:styles>`
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/finance" TargetMode="External"/>
</Relationships>`
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
    'word/numbering.xml': strToU8(numbering),
    'word/_rels/document.xml.rels': strToU8(rels),
  })
}

const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** "orders.xlsx": sheet "Orders" (shared strings, numbers, a date-formatted column, booleans), a hidden sheet, sheet "Regions". */
export function xlsxBytes(): Uint8Array {
  const strings = ['Customer', 'Amount', 'Ordered', 'Paid', 'Status', 'Acme GmbH', 'Globex', 'Initech', 'Open', 'Done', 'Region', 'Head', 'North', 'Ana', 'South', 'Ben', 'secret']
  const s = (v: string) => strings.indexOf(v)
  const c = (ref: string, v: string | number | boolean, style?: number) =>
    typeof v === 'boolean'
      ? `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`
      : typeof v === 'number'
        ? `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`
        : `<c r="${ref}" t="s"><v>${s(v)}</v></c>`
  // 45930 = 2025-09-30, 45940 = 2025-10-10, 45951 = 2025-10-21
  const orders = [
    ['Customer', 'Amount', 'Ordered', 'Paid', 'Status'],
    ['Acme GmbH', 1250.5, 45930, true, 'Done'],
    ['Globex', 980, 45940, false, 'Open'],
    ['Initech', 2100.25, 45951, true, 'Done'],
  ] as const
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${X}><sheetData>${orders
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => c(`${'ABCDE'[j]}${i + 1}`, v as string | number | boolean, j === 2 && i ? 1 : undefined)).join('')}</row>`)
    .join('')}</sheetData></worksheet>`
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${X}><sheetData><row r="1">${c('A1', 'secret')}</row></sheetData></worksheet>`
  const regions = [
    ['Region', 'Head'],
    ['North', 'Ana'],
    ['South', 'Ben'],
  ]
  const sheet3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${X}><sheetData>${regions.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => c(`${'AB'[j]}${i + 1}`, v)).join('')}</row>`).join('')}</sheetData></worksheet>`
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${X}><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Regions" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="worksheet" Target="/xl/worksheets/sheet3.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst ${X}>${strings.map((x) => `<si><t>${x}</t></si>`).join('')}</sst>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${X}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    'xl/worksheets/sheet2.xml': strToU8(sheet2),
    'xl/worksheets/sheet3.xml': strToU8(sheet3),
  })
}

/** A minimal, valid PDF with `pages` pages (one line of text on the first). */
export function pdfBytes(pages = 2, text = 'Invoice 2025-117'): Uint8Array {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(' ')
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${i === 0 ? ' /Contents 3 0 R' : ''} >>`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return strToU8(out)
}

/** A CSV export (semicolons, German decimals and dates, like Excel in German). */
export const CSV_TEXT = 'Task;Hours;Due;Status;Done\nWrite brief;2,5;14.10.2025;Open;no\nReview layout;1;15.10.2025;In progress;no\nShip release;4;20.10.2025;Done;yes\nPlan Q4;3,25;22.10.2025;Open;no\n'

/** An HTML mail attachment with a script, an inline handler, a tracking pixel and a form. */
export const HTML_TEXT = `<!doctype html><html><head><title>Newsletter October</title><script>window.__pwned = true</script><style>.b{font-weight:700}</style></head>
<body onload="window.__pwned = true"><h1>Newsletter October</h1><p class="b">Hello team,</p><p>The <a href="https://example.com/launch" onclick="window.__pwned=true">launch</a> moved to <b>November 3</b>.</p>
<img src="https://tracker.example/pixel.gif?u=42" alt="pixel"><ul><li>Venue booked</li><li>Speakers confirmed</li></ul>
<form action="https://evil.example"><input name="pw"></form><iframe src="https://evil.example"></iframe><script>document.title = 'pwned'</script></body></html>`

/** A short RTF letter (Word / TextEdit). */
export const RTF_TEXT = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 Dear Ms. M\\u252?ller,\\par\\par thank you for the offer \\b No. 17\\b0 .\\par Best regards\\par}'
