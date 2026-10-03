/**
 * The body as a clickable tree: every node is a key, every empty slot a dashed socket. Click (or
 * Enter) a socket → the picker; click a key → its menu (value, replace, wrap, unwrap, delete).
 * Keyboard: ↑ ↓ move in reading order, ← parent, → first argument, Home / End, Enter opens,
 * Delete / Backspace empties, typing on a node opens the picker with that text.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import type { FnParam } from "../../../store/types";
import { useT } from "../../../i18n";
import { isOperator } from "../../../store/functions";
import { OPERATOR_KEYS } from "./catalog";
import {
  canAddArg,
  flatten,
  nodeAt,
  numText,
  pathKey,
  samePath,
  slotAt,
  type CallSpec,
  type DNode,
  type Path,
  type SpecLookup,
} from "./model";

export interface ExprTreeProps {
  root: DNode;
  params: FnParam[];
  lookup: SpecLookup;
  focus: Path;
  /** paths to mark (type hints, unknown calls) */
  marks: Set<string>;
  readOnly: boolean;
  onFocus: (p: Path) => void;
  /** open the picker (empty slot or "type to replace") or the node menu */
  onOpen: (p: Path, el: HTMLElement, query?: string) => void;
  onDelete: (p: Path) => void;
  onAddArg: (p: Path) => void;
  /** move DOM focus to the focused node after the next render */
  focusToken: number;
}

export function ExprTree({
  root,
  params,
  lookup,
  focus,
  marks,
  readOnly,
  onFocus,
  onOpen,
  onDelete,
  onAddArg,
  focusToken,
}: ExprTreeProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const order = flatten(root).map((x) => x.path);

  useEffect(() => {
    if (!focusToken) return;
    const el = ref.current?.querySelector<HTMLElement>(
      `[data-path="${pathKey(focus)}"]`,
    );
    el?.focus({ preventScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  const move = (p: Path) => {
    onFocus(p);
    requestAnimationFrame(() =>
      ref.current
        ?.querySelector<HTMLElement>(`[data-path="${pathKey(p)}"]`)
        ?.focus(),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches('[role="treeitem"]')) return;
    const i = Math.max(
      0,
      order.findIndex((p) => samePath(p, focus)),
    );
    const node = nodeAt(root, focus);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (i < order.length - 1) move(order[i + 1]);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (i > 0) move(order[i - 1]);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (focus.length) move(focus.slice(0, -1));
        return;
      case "ArrowRight":
        e.preventDefault();
        if (node?.k === "call" && node.args.length) move([...focus, 0]);
        return;
      case "Home":
        e.preventDefault();
        move(order[0]);
        return;
      case "End":
        e.preventDefault();
        move(order[order.length - 1]);
        return;
      case "Enter":
      case " ":
      case "F2":
        e.preventDefault();
        onOpen(focus, target);
        return;
      case "Delete":
      case "Backspace":
        if (readOnly) return;
        e.preventDefault();
        onDelete(focus);
        return;
      case "+":
        if (
          readOnly ||
          e.metaKey ||
          e.ctrlKey ||
          node?.k !== "call" ||
          !canAddArg(lookup(node.fn), node.args.length)
        )
          break;
        e.preventDefault();
        onAddArg(focus);
        return;
    }
    // type to search: a printable key opens the picker with it
    if (
      !readOnly &&
      e.key.length === 1 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      e.key !== " "
    ) {
      e.preventDefault();
      onOpen(focus, target, e.key);
    }
  };

  return (
    <div
      ref={ref}
      className="fx-tree"
      role="tree"
      aria-label={t("features.fn.body")}
      aria-readonly={readOnly || undefined}
      onKeyDown={onKeyDown}
    >
      <TreeNode
        node={root}
        path={[]}
        level={1}
        slot={null}
        ctx={{
          params,
          lookup,
          focus,
          marks,
          readOnly,
          onFocus,
          onOpen,
          onAddArg,
        }}
      />
    </div>
  );
}

interface NodeCtx {
  params: FnParam[];
  lookup: SpecLookup;
  focus: Path;
  marks: Set<string>;
  readOnly: boolean;
  onFocus: (p: Path) => void;
  onOpen: (p: Path, el: HTMLElement, query?: string) => void;
  onAddArg: (p: Path) => void;
}

function TreeNode({
  node,
  path,
  level,
  slot,
  ctx,
}: {
  node: DNode;
  path: Path;
  level: number;
  slot: { label: string; optional?: boolean } | null;
  ctx: NodeCtx;
}) {
  const t = useT();
  const focused = samePath(path, ctx.focus);
  const spec = node.k === "call" ? ctx.lookup(node.fn) : undefined;
  const marked = ctx.marks.has(pathKey(path));
  const next =
    node.k === "call" &&
    spec &&
    !ctx.readOnly &&
    canAddArg(spec, node.args.length)
      ? slotAt(spec, node.args.length)
      : null;

  return (
    <div className="fx-node" role="none">
      <div className="fx-row" role="none">
        {slot && (
          <span className="fx-slot" aria-hidden>
            {slot.label}
            {slot.optional && <span className="fx-slot__opt">?</span>}
          </span>
        )}
        <button
          type="button"
          role="treeitem"
          aria-level={level}
          aria-selected={focused}
          aria-expanded={node.k === "call" ? true : undefined}
          aria-label={nodeLabel(node, spec, slot?.label ?? null, t)}
          tabIndex={focused ? 0 : -1}
          data-path={pathKey(path)}
          data-kind={chipKind(node, spec)}
          data-mark={marked || undefined}
          className={`fx-chip fx-chip--${chipKind(node, spec)}`}
          onClick={(e) => {
            ctx.onFocus(path);
            ctx.onOpen(path, e.currentTarget);
          }}
          onFocus={() => !focused && ctx.onFocus(path)}
        >
          <ChipFace node={node} spec={spec} />
        </button>
        {node.k === "call" && spec?.kind === "operator" && (
          <span className="fx-row__hint">
            {t(
              `features.fn.op.${OPERATOR_KEYS[node.fn as keyof typeof OPERATOR_KEYS]?.id ?? "plus"}`,
            )}
          </span>
        )}
        {node.k === "call" && !spec && (
          <span className="fx-row__warn">{t("features.fn.unknownShort")}</span>
        )}
      </div>
      {node.k === "call" && (
        <div className="fx-kids" role="group">
          {node.args.map((a, i) => (
            <TreeNode
              key={i}
              node={a}
              path={[...path, i]}
              level={level + 1}
              slot={
                spec?.kind === "operator"
                  ? { label: i ? "B" : "A" }
                  : slotAt(spec, i)
              }
              ctx={ctx}
            />
          ))}
          {next && (
            <div className="fx-node fx-node--add" role="none">
              <button
                type="button"
                className="fx-add"
                tabIndex={-1}
                onClick={() => ctx.onAddArg(path)}
              >
                <Plus size={11} strokeWidth={2} /> {next.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function chipKind(node: DNode, spec: CallSpec | undefined): string {
  if (node.k === "call")
    return isOperator(node.fn)
      ? "op"
      : spec?.kind === "custom"
        ? "custom"
        : "fn";
  return node.k;
}

function ChipFace({ node, spec }: { node: DNode; spec: CallSpec | undefined }) {
  const t = useT();
  switch (node.k) {
    case "hole":
      return (
        <span className="fx-chip__hole">{t("features.fn.emptySlot")}</span>
      );
    case "num":
      return <span className="fx-chip__val">{numText(node.v)}</span>;
    case "str":
      return (
        <span className="fx-chip__val">
          “{node.v.length > 40 ? `${node.v.slice(0, 40)}…` : node.v}”
        </span>
      );
    case "bool":
      return (
        <span className="fx-chip__val">
          {node.v ? t("features.fn.yes") : t("features.fn.no")}
        </span>
      );
    case "param":
      return <span className="fx-chip__val">{node.name}</span>;
    case "call":
      if (spec?.kind === "operator" || isOperator(node.fn))
        return (
          <span className="fx-chip__op">
            {OPERATOR_KEYS[node.fn as keyof typeof OPERATOR_KEYS]?.key ??
              node.fn}
          </span>
        );
      return (
        <>
          <span className="fx-chip__fx" aria-hidden>
            {spec?.kind === "custom" ? "ƒ" : "fx"}
          </span>
          <span className="fx-chip__name">{node.fn}</span>
        </>
      );
  }
}

/** What a screen reader hears for a node: "number: ROUND, function", "a: price, parameter". */
function nodeLabel(
  node: DNode,
  spec: CallSpec | undefined,
  slot: string | null,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  let what: string;
  switch (node.k) {
    case "hole":
      what = t("features.fn.emptySlot");
      break;
    case "num":
      what = `${numText(node.v)}, ${t("features.fn.kind.num")}`;
      break;
    case "str":
      what = `“${node.v}”, ${t("features.fn.kind.str")}`;
      break;
    case "bool":
      what = `${node.v ? t("features.fn.yes") : t("features.fn.no")}, ${t("features.fn.kind.bool")}`;
      break;
    case "param":
      what = `${node.name}, ${t("features.fn.kind.param")}`;
      break;
    default:
      what = isOperator(node.fn)
        ? `${t(`features.fn.op.${OPERATOR_KEYS[node.fn as keyof typeof OPERATOR_KEYS]?.id ?? "plus"}`)}, ${t("features.fn.kind.op")}`
        : `${node.fn}, ${spec?.kind === "custom" ? t("features.fn.kind.custom") : t("features.fn.kind.fn")}`;
  }
  return slot ? `${slot}: ${what}` : what;
}
