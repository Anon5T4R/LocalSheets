import { useEffect, useRef } from "react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import "material-icons/iconfont/material-icons.css";
import { computeFormula } from "./lib/formula-fix";
import { t } from "./lib/i18n";
import type { Grid, NamedSheet, SheetOut } from "./lib/sheet-codec";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Default usable grid size for every worksheet.
export const MIN_COLS = 26;
export const MIN_ROWS = 100;

/**
 * Imperative facade over the jspreadsheet instance. All app-level operations
 * (save, AI, formula bar) go through here so they always hit the *active*
 * worksheet — never a stale reference to worksheet 0.
 */
export interface SheetHandle {
  /** The currently active worksheet instance. */
  active(): any;
  /** Index of the active worksheet. */
  activeIndex(): number;
  /** Number of worksheets. */
  count(): number;
  /** Every worksheet's name + raw (formulas) and computed (displayed) data. */
  sheets(): SheetOut[];
  /** Replace the whole document (rebuilds the spreadsheet). */
  load(sheets: NamedSheet[]): void;
}

interface SpreadsheetProps {
  onReady: (handle: SheetHandle) => void;
  onChange?: () => void;
  /** Fires with the active cell's name and its raw content (formula or value). */
  onSelect?: (cell: string, raw: string) => void;
}

function colLetter(index: number): string {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Ensure a grid fills at least the default viewport and is rectangular —
// jspreadsheet normalizes row lengths from the widest row, so ragged input
// from sparse files would render unevenly.
function padGrid(grid: Grid): Grid {
  const rows = Math.max(grid.length, MIN_ROWS);
  let cols = MIN_COLS;
  for (const r of grid) if (r && r.length > cols) cols = r.length;
  const out: Grid = [];
  for (let y = 0; y < rows; y++) {
    const src = grid[y] || [];
    const row: Grid[number] = [];
    for (let x = 0; x < cols; x++) row.push(src[x] ?? "");
    out.push(row);
  }
  return out;
}

// User-visible tab titles. Double-click renames only update the tab DOM (the
// jsuites tabs widget), not options.worksheetName, so the DOM is the source of
// truth for names — with options.worksheetName as the fallback.
function tabTitles(spreadsheet: any): string[] {
  try {
    // Only the spreadsheet's own tab strip (a direct child) — the toolbar's
    // color picker nests another jsuites tabs widget deeper in the element.
    const nodes =
      spreadsheet?.element?.querySelectorAll?.(
        ":scope > .jtabs-headers-container .jtabs-headers > div"
      ) ?? [];
    return Array.from(nodes as NodeListOf<HTMLElement>)
      .filter((n) => !n.classList.contains("jtabs-border") && !n.classList.contains("jtabs-add"))
      .map((n) => n.textContent?.trim() ?? "");
  } catch {
    return [];
  }
}

// Remove every border style the toolbar may have set on the current selection.
// jspreadsheet applies borders as separate side properties, so clearing the
// `border` shorthand alone doesn't work — we have to reset each side too.
const BORDER_KEYS = ["border", "border-top", "border-right", "border-bottom", "border-left"];

function clearBorders(ws: any) {
  try {
    const sel = ws.getSelection?.(); // [x1, y1, x2, y2]
    if (!sel) return;
    const [x1, y1, x2, y2] = sel;
    const styles: Record<string, string> = {};
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        styles[colLetter(x) + (y + 1)] = BORDER_KEYS.map((k) => `${k}: `).join("; ");
      }
    }
    ws.setStyle(styles);
  } catch {
    /* ignore */
  }
}

// jspreadsheet's own "sem bordas" (border_clear) sets each side to a single
// space (e.g. "border-top: "). The CSSOM ignores whitespace values — only an
// empty string clears a property — so the border visually stays. setStyle still
// fires `onchangestyle` with those attempted declarations, so we catch them here
// and clear the offending border properties on the cell element for real. This
// fixes both the toolbar control and our right-click "Limpar bordas" item.
function repairBorderClear(ws: any, records: Record<string, string>) {
  if (!records || typeof records !== "object") return;
  for (const cell in records) {
    const css = records[cell];
    if (typeof css !== "string" || css.indexOf("border") === -1) continue;
    const m = cell.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    let x = 0;
    for (const ch of m[1]) x = x * 26 + (ch.charCodeAt(0) - 64);
    x -= 1;
    const y = parseInt(m[2], 10) - 1;
    const el: HTMLElement | undefined = ws.records?.[y]?.[x]?.element;
    if (!el) continue;
    for (const decl of css.split(";")) {
      const idx = decl.indexOf(":");
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      if (prop.startsWith("border") && val === "") el.style.removeProperty(prop);
    }
  }
}

export function Spreadsheet({ onReady, onChange, onSelect }: SpreadsheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // The spreadsheet-level instance (worksheet.parent) of the current build.
  const spreadRef = useRef<any>(null);
  const activeCell = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Push the active cell's raw content (formula or value) to the formula bar.
  const emitSelection = (ws: any, x: number, y: number) => {
    activeCell.current = { x, y };
    const raw = ws.getValueFromCoords(x, y, false);
    selectRef.current?.(colLetter(x) + (y + 1), raw == null ? "" : String(raw));
  };

  const build = (sheets: NamedSheet[]) => {
    const el = ref.current;
    if (!el) return;
    try {
      jspreadsheet.destroy(el as any);
    } catch {
      /* first build */
    }
    el.innerHTML = "";
    const list = sheets.length ? sheets : [{ name: "Planilha1", data: [] as Grid }];
    const instance = jspreadsheet(el, {
      tabs: true,
      toolbar: true,
      onchange: (ws: any) => {
        changeRef.current?.();
        // Refresh the bar (covers grid edits and AI edits to the active cell).
        const { x, y } = activeCell.current;
        emitSelection(ws, x, y);
      },
      onafterchanges: () => changeRef.current?.(),
      onselection: (ws: any, x1: number, y1: number) => emitSelection(ws, x1, y1),
      // Fix borders that the toolbar / context menu fail to actually clear.
      onchangestyle: (ws: any, records: Record<string, string>) => repairBorderClear(ws, records),
      // New worksheets (the "+" tab) are created tiny (10x15) or empty; pad them
      // to a full grid so every sheet looks like the first one.
      oncreateworksheet: (worksheet: any) => {
        setTimeout(() => {
          try {
            const cols = worksheet.headers?.length ?? 0;
            const rows = worksheet.rows?.length ?? 0;
            if (cols > 0 && cols < MIN_COLS) worksheet.insertColumn(MIN_COLS - cols);
            if (rows > 0 && rows < MIN_ROWS) worksheet.insertRow(MIN_ROWS - rows);
          } catch {
            /* ignore */
          }
        }, 0);
      },
      // Take over lookup/conditional functions the basic engine computes wrong.
      onbeforeformula: (ws: any, expression: string, x?: number, y?: number) =>
        computeFormula(ws, expression, x, y),
      // Extend the right-click menu: manage worksheets (tabs) and clear borders.
      contextMenu: (ws: any, _x: any, _y: any, _e: any, items: any[], role: string) => {
        const base = Array.isArray(items) ? items : [];
        if (role === "tabs") {
          // (Renomear é nativo: dê dois cliques no nome da aba.)
          return [
            ...base,
            {
              title: t("ctx.deleteSheet"),
              onclick: () => {
                try {
                  const count = ws.parent?.worksheets?.length ?? 1;
                  if (count <= 1) {
                    alert(t("ctx.cantDeleteOnly"));
                    return;
                  }
                  ws.deleteWorksheet(ws.getWorksheetActive());
                } catch {
                  /* ignore */
                }
              },
            },
          ];
        }
        // Cell context menu: keep the defaults and add a working border eraser.
        return [
          ...base,
          { type: "line" as const, title: "" },
          { title: t("ctx.clearBorders"), onclick: () => clearBorders(ws) },
        ];
      },
      worksheets: list.map((s, i) => ({
        minDimensions: [MIN_COLS, MIN_ROWS] as [number, number],
        worksheetName: s.name || `Planilha${i + 1}`,
        data: padGrid(s.data),
      })),
    });
    spreadRef.current = (instance as any)?.[0]?.parent ?? null;
    activeCell.current = { x: 0, y: 0 };
  };

  useEffect(() => {
    build([]);

    const handle: SheetHandle = {
      active() {
        const sp = spreadRef.current;
        if (!sp) return undefined;
        const i = sp.getWorksheetActive?.() ?? 0;
        return sp.worksheets?.[i] ?? sp.worksheets?.[0];
      },
      activeIndex() {
        return spreadRef.current?.getWorksheetActive?.() ?? 0;
      },
      count() {
        return spreadRef.current?.worksheets?.length ?? 0;
      },
      sheets() {
        const sp = spreadRef.current;
        if (!sp?.worksheets) return [];
        const titles = tabTitles(sp);
        return sp.worksheets.map((w: any, i: number) => ({
          name: titles[i] || w.options?.worksheetName || `Planilha${i + 1}`,
          raw: (w.getData(false, false) as Grid) ?? [],
          computed: (w.getData(false, true) as Grid) ?? [],
        }));
      },
      load(sheets) {
        build(sheets);
        // Reset the formula bar to A1 of the first worksheet.
        const first = spreadRef.current?.worksheets?.[0];
        if (first) emitSelection(first, 0, 0);
      },
    };
    onReady(handle);

    return () => {
      const el = ref.current;
      if (!el) return;
      try {
        jspreadsheet.destroy(el as any);
      } catch {
        /* ignore */
      }
      el.innerHTML = "";
      spreadRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="sheet-host" ref={ref} />;
}
