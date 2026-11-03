import type {ProgramRun} from './program.ts'
export type ProgramRunPreview=ProgramRun&{summary?:true;hasInspection?:boolean}
/** List metadata only. Original private bodies stay available through the single-receipt endpoint. */
export function summarizeProgramRun(run:ProgramRun):ProgramRunPreview{
 const {answer:_,inspection,steps:__,...metadata}=run
 return {...metadata,steps:[],summary:true,hasInspection:!!inspection}
}
