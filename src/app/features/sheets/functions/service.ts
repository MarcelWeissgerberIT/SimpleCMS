/**
 * Registry sync: the workspace's custom functions (Workspace.functions) go into the spreadsheet
 * engine (setCustomFunctions) at boot and on every change — and are offered to database formulas
 * (lib/formulaFunctions), which call them with plain values. Database formulas see custom
 * functions only (no DS, no cells).
 */
import { useWorkspace } from "../../../store/store";
import type { CustomFunction, ID } from "../../../store/types";
import {
  setFormulaFunctions,
  type FormulaCallResult,
  type FormulaFunctions,
  type FormulaPlain,
} from "../../../lib/formulaFunctions";
import {
  getFunction,
  listFunctions,
  setCustomFunctions,
} from "../engine/registry";
import { callFunction } from "../engine/evaluate";
import {
  cellsOf,
  datasetOf,
  DAY,
  EPOCH,
  isDataset,
  isErr,
  isRange,
} from "../engine/values";
import type { CellValue, Value } from "../engine/types";

/* ------------------------------------------------------------------ database formulas */

/** A database formula value → an engine value (dates → serials, lists → one dataset). */
export function toEngine(v: FormulaPlain): Value {
  if (
    v === null ||
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean"
  )
    return v;
  if (v instanceof Date) return serial(v);
  const flat: CellValue[] = [];
  const walk = (x: FormulaPlain) => {
    if (Array.isArray(x)) x.forEach(walk);
    else flat.push(x instanceof Date ? serial(x) : x);
  };
  walk(v);
  return datasetOf(flat);
}

/** A local date (and time) as a spreadsheet serial. */
function serial(d: Date): number {
  const day =
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / DAY;
  return (
    day + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
  );
}

export function fromEngine(v: Value): FormulaCallResult {
  if (isErr(v)) return { ok: false, code: v.code, msg: v.msg };
  if (isRange(v) || isDataset(v)) {
    const out: FormulaPlain[] = [];
    for (const c of cellsOf(v)) if (!isErr(c)) out.push(c);
    return { ok: true, value: out };
  }
  return { ok: true, value: v };
}

const custom = (name: string) => {
  const s = getFunction(name);
  return s?.custom ? s : null;
};

export const DB_FUNCTIONS: FormulaFunctions = {
  resolve: (name) => custom(name)?.name ?? null,
  arity: (name) => {
    const s = custom(name);
    return s ? [s.minArgs, s.maxArgs ?? -1] : [0, -1];
  },
  call: (name, args, { now, lang }) =>
    fromEngine(
      callFunction(name, args.map(toEngine), { now: new Date(now), lang }),
    ),
  list: () =>
    listFunctions()
      .filter((s) => !!s.custom)
      .map((s) => ({
        name: s.name,
        sig: `${s.name}(${s.args.map((a) => a.name).join(", ")})`,
        description: s.custom?.description ?? "",
      })),
};

/* ------------------------------------------------------------------ service */

let running: (() => void) | null = null;

function push(functions: Record<ID, CustomFunction> | undefined) {
  setCustomFunctions(Object.values(functions ?? {}));
  // a new registration bumps the version: database formulas compile again with the new names
  setFormulaFunctions(DB_FUNCTIONS);
}

/** Start once after hydrate (main.tsx); returns stop. */
export function startCustomFunctions(): () => void {
  running?.();
  push(useWorkspace.getState().functions);
  const unsub = useWorkspace.subscribe((s, prev) => {
    if (s.functions !== prev.functions) push(s.functions);
  });
  running = () => {
    unsub();
    running = null;
  };
  return running;
}
