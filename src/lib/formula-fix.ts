// The free "Formula Basic" engine bundled with jspreadsheet-ce flattens every
// range into the positional argument stream before calling a function, which
// destroys range boundaries. That makes lookup/conditional functions (VLOOKUP,
// SUMIF, COUNTIF, INDEX/MATCH, …) return #REF!/0.
//
// We can't fix the engine's flattening, but `onbeforeformula` hands us the raw
// expression plus the worksheet, so for a top-level call to one of these
// functions we resolve the ranges ourselves and compute the result with the
// well-tested MIT library formula.js, then hand the literal answer back to the
// engine. Dependency tracking still works because jspreadsheet builds its graph
// from the original formula's cell references.
import * as fx from "@formulajs/formulajs";

/* eslint-disable @typescript-eslint/no-explicit-any */
type WS = any;

// Functions we take over (the ones the basic engine gets wrong).
const SUPPORTED = new Set([
  "VLOOKUP", "HLOOKUP", "XLOOKUP", "LOOKUP",
  "INDEX", "MATCH",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS",
  "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS",
  "SUMPRODUCT",
]);

const RANGE_RE = /^\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/i;
const CELL_RE = /^\$?[A-Z]+\$?\d+$/i;

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function splitRef(ref: string): { x: number; y: number } {
  const m = ref.replace(/\$/g, "").match(/^([A-Z]+)(\d+)$/i)!;
  return { x: colToIndex(m[1]), y: parseInt(m[2], 10) - 1 };
}

// Cell text comes back as strings; turn numeric strings into numbers so math works.
function coerce(v: any): any {
  if (v == null || v === "") return v;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s !== "" && !isNaN(Number(s))) return Number(s);
  return v;
}

function resolveRange2D(ws: WS, ref: string): any[][] {
  const [a, b] = ref.split(":");
  const p1 = splitRef(a);
  const p2 = splitRef(b);
  const x1 = Math.min(p1.x, p2.x);
  const x2 = Math.max(p1.x, p2.x);
  const y1 = Math.min(p1.y, p2.y);
  const y2 = Math.max(p1.y, p2.y);
  const out: any[][] = [];
  for (let y = y1; y <= y2; y++) {
    const row: any[] = [];
    for (let x = x1; x <= x2; x++) row.push(coerce(ws.getValueFromCoords(x, y, true)));
    out.push(row);
  }
  return out;
}

// Split arguments on top-level commas, respecting quotes and nested parens.
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(") { depth++; cur += ch; continue; }
    if (ch === ")") { depth--; cur += ch; continue; }
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

function resolveArg(ws: WS, raw: string): any {
  const t = raw.trim();
  if (RANGE_RE.test(t)) return resolveRange2D(ws, t);
  if (CELL_RE.test(t)) {
    const { x, y } = splitRef(t);
    return coerce(ws.getValueFromCoords(x, y, true));
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t !== "" && !isNaN(Number(t))) return Number(t);
  if (/^TRUE$/i.test(t)) return true;
  if (/^FALSE$/i.test(t)) return false;
  // Nested supported call, e.g. INDEX(B1:B4, MATCH("x", A1:A4, 0)).
  const nested = evalCall(ws, t);
  if (nested !== NOT_SUPPORTED) return nested;
  return t; // unknown token — passed through as-is
}

const NOT_SUPPORTED = Symbol("not-supported");

// Evaluate a single top-level call to a supported function, returning its raw
// value (or NOT_SUPPORTED if `body` isn't such a call).
function evalCall(ws: WS, body: string): any {
  const b = body.trim();
  const open = b.indexOf("(");
  if (open < 0 || !b.endsWith(")")) return NOT_SUPPORTED;
  const fn = b.slice(0, open).trim().toUpperCase();
  if (!SUPPORTED.has(fn) || !isSingleCall(b)) return NOT_SUPPORTED;
  const fxFn = (fx as any)[fn];
  if (typeof fxFn !== "function") return NOT_SUPPORTED;
  const args = splitArgs(b.slice(open + 1, -1)).map((a) => resolveArg(ws, a));
  return fxFn(...args);
}

// True only when the whole body is a single function call, e.g. "SUMIF(...)" and
// not "SUMIF(...)+A1" — mixed expressions are left to the default engine.
function isSingleCall(body: string): boolean {
  const open = body.indexOf("(");
  if (open < 0) return false;
  let depth = 0;
  let q: string | null = null;
  for (let i = open; i < body.length; i++) {
    const ch = body[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i === body.length - 1;
    }
  }
  return false;
}

// The result is fed back to the basic engine, which re-parses it. "!" inside a
// returned string triggers sheet-reference parsing and gets mangled, so error
// codes drop it (cosmetic: "#REF" instead of "#REF!").
function toExpression(v: any): string {
  if (v instanceof Error) return `="${(v.message || "#ERROR").replace(/!/g, "")}"`;
  if (typeof v === "number") return Number.isFinite(v) ? `=${v}` : `="#NUM"`;
  if (typeof v === "boolean") return `="${v ? "TRUE" : "FALSE"}"`;
  if (v == null) return `="#N/A"`;
  const s = String(v);
  if (s.trim() !== "" && !isNaN(Number(s))) return `=${Number(s)}`;
  return `="${s.replace(/"/g, '""').replace(/!/g, "")}"`;
}

/**
 * If the cell holds a top-level call to a function the basic engine gets wrong,
 * compute it with formula.js and return the literal result as a new expression.
 * Otherwise return undefined so jspreadsheet evaluates it normally.
 *
 * jspreadsheet pre-expands ranges (A1:C4 -> A1,B1,C1,…) in `expression`, so we
 * read the *original* formula straight from the cell via its coordinates.
 */
export function computeFormula(
  ws: WS,
  expression: string,
  x?: number,
  y?: number
): string | undefined {
  try {
    let text = expression;
    if (typeof x === "number" && typeof y === "number") {
      const raw = ws.getValueFromCoords(x, y, false);
      if (typeof raw === "string" && raw[0] === "=") text = raw;
    }
    if (!text || text[0] !== "=") return undefined;
    const val = evalCall(ws, text.slice(1).trim());
    if (val === NOT_SUPPORTED) return undefined;
    return toExpression(val);
  } catch {
    return undefined;
  }
}
