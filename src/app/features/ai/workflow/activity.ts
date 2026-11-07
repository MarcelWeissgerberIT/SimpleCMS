/** Local display only: no page read, tool call or identifier lookup over the network. */
export function oneActivity(tool:string,arg:string|undefined,pages:Record<string,{title:string}>,de:boolean){
 const names:Record<string,[string,string]>={read_page:['Seite lesen','Read page'],search_pages:['Seiten suchen','Find pages'],read_page_files:['Dateiverweise lesen','Read file references'],read_tables:['Tabellen lesen','Read tables'],get_current_page:['Aktuelle Seite prüfen','Inspect current page'],edit_page:['Änderung vorschlagen','Propose edit'],append_to_page:['Ergänzung vorschlagen','Propose addition'],create_page:['Seite vorbereiten','Prepare page'],query_database:['Datenbank durchsuchen','Query database'],read_task:['Aufgabe lesen','Read task'],read_design_source:['Designquelle lesen','Read design source'],check_finding:['Finding prüfen','Check finding'],create_design_mock:['Mock erstellen','Create mock'],list_tasks:['Aufgaben lesen','Read tasks']}
 let detail=arg??''
 // Replace exact identifiers only; retain file paths, line ranges and search terms.
 detail=detail.replace(/[A-Za-z0-9_-]{8,}/g,id=>pages[id]?.title||id)
 return {action:names[tool]?.[de?0:1]??tool.replaceAll('_',' '),detail:detail.slice(0,600)}
}
