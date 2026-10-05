/**
 * One Script — the syntax tree (the parser's output, the interpreter's input; exported so the query
 * builder and other tools can read code without executing it). Every node knows its place.
 */
import type { Pos } from './errors'

/** `@[Label](p:<id>)` = a page / database / row · `u:` a person · `a:` an agent · `s:` a script; `@Name` = by title. */
export type RefKind = 'p' | 'u' | 'a' | 's' | 'name'

export interface Param {
  name: string
  /** default value (`fn f(a, b = 1)`) */
  def: Expr | null
  pos: Pos
}

export interface Arg {
  /** named argument (`f(a, to: x)`) */
  name: string | null
  value: Expr
  /** sort sugar: `.sort(Due desc)` */
  order: 'asc' | 'desc' | null
  pos: Pos
}

export type Expr =
  | { type: 'Num'; value: number; pos: Pos }
  | { type: 'Dur'; days: number; ms: number; text: string; pos: Pos }
  | { type: 'Str'; parts: Array<string | Expr>; quote: '"' | "'"; pos: Pos }
  | { type: 'Bool'; value: boolean; pos: Pos }
  | { type: 'Null'; pos: Pos }
  | { type: 'Ident'; name: string; quoted: boolean; pos: Pos }
  | { type: 'Ref'; kind: RefKind; id: string | null; label: string; pos: Pos }
  | { type: 'List'; items: Expr[]; pos: Pos }
  | { type: 'Record'; entries: Array<{ key: string; value: Expr; pos: Pos }>; pos: Pos }
  | { type: 'Unary'; op: '-' | 'not'; arg: Expr; pos: Pos }
  | { type: 'Binary'; op: BinaryOp; left: Expr; right: Expr; pos: Pos }
  | { type: 'Logical'; op: 'and' | 'or'; left: Expr; right: Expr; pos: Pos }
  | { type: 'Call'; callee: Expr; args: Arg[]; pos: Pos }
  | { type: 'Member'; object: Expr; name: string; namePos: Pos; pos: Pos }
  | { type: 'Index'; object: Expr; index: Expr; pos: Pos }
  | { type: 'Lambda'; params: Param[]; body: Expr | Block; name: string | null; pos: Pos }

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '=' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'

export interface Block {
  type: 'Block'
  body: Stmt[]
  pos: Pos
}

export type Stmt =
  | { type: 'Let'; name: string; value: Expr; pos: Pos }
  | { type: 'Assign'; target: Expr; value: Expr; pos: Pos }
  | { type: 'If'; test: Expr; then: Block; else: Block | Extract<Stmt, { type: 'If' }> | null; pos: Pos }
  | { type: 'For'; key: string | null; name: string; iter: Expr; body: Block; pos: Pos }
  | { type: 'While'; test: Expr; body: Block; pos: Pos }
  | { type: 'Return'; value: Expr | null; pos: Pos }
  | { type: 'Break'; pos: Pos }
  | { type: 'Continue'; pos: Pos }
  | { type: 'FnDecl'; name: string; params: Param[]; body: Block; pos: Pos }
  | { type: 'ExprStmt'; expr: Expr; pos: Pos }

export interface Program {
  type: 'Program'
  body: Stmt[]
  /** the source the tree was parsed from */
  source: string
}

export type Node = Expr | Stmt | Block

/** Visit every node of a tree (depth first, parents before children). */
export function walk(node: Node | Program, fn: (n: Node) => void): void {
  const visit = (n: Node | null | undefined) => {
    if (!n) return
    fn(n)
    switch (n.type) {
      case 'Str':
        for (const p of n.parts) if (typeof p !== 'string') visit(p)
        break
      case 'List':
        n.items.forEach(visit)
        break
      case 'Record':
        n.entries.forEach((e) => visit(e.value))
        break
      case 'Unary':
        visit(n.arg)
        break
      case 'Binary':
      case 'Logical':
        visit(n.left)
        visit(n.right)
        break
      case 'Call':
        visit(n.callee)
        n.args.forEach((a) => visit(a.value))
        break
      case 'Member':
        visit(n.object)
        break
      case 'Index':
        visit(n.object)
        visit(n.index)
        break
      case 'Lambda':
        n.params.forEach((p) => visit(p.def))
        visit(n.body)
        break
      case 'Block':
        n.body.forEach(visit)
        break
      case 'Let':
        visit(n.value)
        break
      case 'Assign':
        visit(n.target)
        visit(n.value)
        break
      case 'If':
        visit(n.test)
        visit(n.then)
        visit(n.else)
        break
      case 'For':
        visit(n.iter)
        visit(n.body)
        break
      case 'While':
        visit(n.test)
        visit(n.body)
        break
      case 'Return':
        visit(n.value)
        break
      case 'FnDecl':
        n.params.forEach((p) => visit(p.def))
        visit(n.body)
        break
      case 'ExprStmt':
        visit(n.expr)
        break
    }
  }
  if (node.type === 'Program') node.body.forEach(visit)
  else visit(node)
}
