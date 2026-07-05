// Pure conversion between the in-memory grid model and SheetJS workbooks.
// No Tauri imports here so everything is unit-testable in plain node.
//
// Formulas: SheetJS only treats a cell as a formula when `cell.f` is set —
// a plain "=SUM(A1:A2)" string is written as text (Excel would display it
// literally). And a formula cell written without a cached value (`v`) is
// dropped entirely on read. So we always write `f` (from the raw grid) plus
// `v`/`t` (from the computed grid), and on read we prefer `f` back into the
// "=..." string form jspreadsheet uses.
import * as XLSX from "xlsx";

export type Cell = string | number;
export type Grid = Cell[][];

/** One worksheet as loaded from a file (formulas kept as "=..." strings). */
export interface NamedSheet {
  name: string;
  data: Grid;
}

/** One worksheet as captured from the UI for saving. */
export interface SheetOut {
  name: string;
  /** options.data — what the user typed, formulas as "=..." strings. */
  raw: Grid;
  /** Displayed values — formula results, used as the cached `v`. */
  computed: Grid;
}

/** Numeric coercion: plain numeric text becomes a number, anything else null. */
function toNumber(v: Cell | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || isNaN(Number(s))) return null;
  return Number(s);
}

/** Index of the last row/column holding any content, as exclusive bounds. */
export function usedBounds(grid: Grid): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  grid.forEach((row, r) => {
    row?.forEach((c, ci) => {
      if (c !== "" && c != null) {
        if (r + 1 > rows) rows = r + 1;
        if (ci + 1 > cols) cols = ci + 1;
      }
    });
  });
  return { rows, cols };
}

/** Read a SheetJS worksheet into a rectangular grid, restoring "=..." formulas. */
export function sheetToGrid(ws: XLSX.WorkSheet): Grid {
  const ref = ws["!ref"];
  if (!ref) return [[""]];
  const range = XLSX.utils.decode_range(ref);
  const out: Grid = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: Cell[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) {
        row.push("");
      } else if (cell.f) {
        row.push("=" + cell.f);
      } else if (cell.v == null) {
        row.push("");
      } else if (typeof cell.v === "number") {
        row.push(cell.v);
      } else if (typeof cell.v === "boolean") {
        row.push(cell.v ? "TRUE" : "FALSE");
      } else {
        row.push(String(cell.v));
      }
    }
    out.push(row);
  }
  return out;
}

/** All worksheets of a workbook, in order, with their names. */
export function workbookToSheets(wb: XLSX.WorkBook): NamedSheet[] {
  const sheets = wb.SheetNames.map((name) => ({
    name,
    data: sheetToGrid(wb.Sheets[name]),
  }));
  return sheets.length ? sheets : [{ name: "Planilha1", data: [[""]] }];
}

/** Build a SheetJS worksheet from raw + computed grids, trimmed to used cells. */
export function gridToSheet(raw: Grid, computed: Grid): XLSX.WorkSheet {
  const { rows, cols } = usedBounds(raw);
  const ws: XLSX.WorkSheet = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rv = raw[r]?.[c];
      if (rv === "" || rv == null) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const s = String(rv);
      if (s[0] === "=") {
        const cv = computed[r]?.[c];
        const num = toNumber(cv);
        ws[addr] =
          num !== null
            ? { t: "n", v: num, f: s.slice(1) }
            : { t: "s", v: cv == null ? "" : String(cv), f: s.slice(1) };
      } else {
        const num = toNumber(rv);
        ws[addr] = num !== null ? { t: "n", v: num } : { t: "s", v: s };
      }
    }
  }
  ws["!ref"] = `A1:${XLSX.utils.encode_cell({
    r: Math.max(rows - 1, 0),
    c: Math.max(cols - 1, 0),
  })}`;
  return ws;
}

// Excel worksheet names: non-empty, at most 31 chars, no : \ / ? * [ ].
function sanitizeSheetName(name: string, fallback: string): string {
  const clean = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31).trim();
  return clean || fallback;
}

/** Assemble a workbook, deduplicating and sanitizing worksheet names. */
export function sheetsToWorkbook(sheets: SheetOut[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, i) => {
    let name = sanitizeSheetName(s.name, `Planilha${i + 1}`);
    let n = 2;
    // Excel compares names case-insensitively.
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n++})`;
      name = name.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, gridToSheet(s.raw, s.computed), name);
  });
  return wb;
}

/** CSV of a single sheet's displayed values (formulas export their results). */
export function sheetToCsv(sheet: SheetOut): string {
  const { rows, cols } = usedBounds(sheet.raw);
  const values: Grid = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) row.push(sheet.computed[r]?.[c] ?? "");
    values.push(row);
  }
  return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(values.length ? values : [[""]]));
}
