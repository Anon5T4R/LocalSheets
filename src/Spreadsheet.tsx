import { useEffect, useRef } from "react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import "material-icons/iconfont/material-icons.css";
import { computeFormula } from "./lib/formula-fix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetInstance = any;

// Default usable grid size for every worksheet.
export const MIN_COLS = 26;
export const MIN_ROWS = 100;

interface SpreadsheetProps {
  onReady: (instance: SheetInstance) => void;
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

// Remove every border style the toolbar may have set on the current selection.
// jspreadsheet applies borders as separate side properties, so clearing the
// `border` shorthand alone doesn't work — we have to reset each side too.
const BORDER_KEYS = ["border", "border-top", "border-right", "border-bottom", "border-left"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const activeCell = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Push the active cell's raw content (formula or value) to the formula bar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emitSelection = (ws: any, x: number, y: number) => {
    activeCell.current = { x, y };
    const raw = ws.getValueFromCoords(x, y, false);
    selectRef.current?.(colLetter(x) + (y + 1), raw == null ? "" : String(raw));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instance = jspreadsheet(el, {
      tabs: true,
      toolbar: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onchange: (ws: any) => {
        changeRef.current?.();
        // Refresh the bar (covers grid edits and AI edits to the active cell).
        const { x, y } = activeCell.current;
        emitSelection(ws, x, y);
      },
      onafterchanges: () => changeRef.current?.(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onselection: (ws: any, x1: number, y1: number) => emitSelection(ws, x1, y1),
      // Fix borders that the toolbar / context menu fail to actually clear.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onchangestyle: (ws: any, records: Record<string, string>) => repairBorderClear(ws, records),
      // New worksheets (the "+" tab) are created tiny (10x15) or empty; pad them
      // to a full grid so every sheet looks like the first one.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onbeforeformula: (ws: any, expression: string, x?: number, y?: number) =>
        computeFormula(ws, expression, x, y),
      // Extend the right-click menu: manage worksheets (tabs) and clear borders.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contextMenu: (ws: any, _x: any, _y: any, _e: any, items: any[], role: string) => {
        const base = Array.isArray(items) ? items : [];
        if (role === "tabs") {
          // (Renomear é nativo: dê dois cliques no nome da aba.)
          return [
            ...base,
            {
              title: "Excluir planilha",
              onclick: () => {
                try {
                  const count = ws.parent?.worksheets?.length ?? 1;
                  if (count <= 1) {
                    alert("Não é possível excluir a única planilha.");
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
          { title: "Limpar bordas da seleção", onclick: () => clearBorders(ws) },
        ];
      },
      worksheets: [
        {
          minDimensions: [MIN_COLS, MIN_ROWS],
          worksheetName: "Planilha1",
        },
      ],
    });
    onReady(instance);
    return () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jspreadsheet.destroy(el as any);
      } catch {
        /* ignore */
      }
      el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="sheet-host" ref={ref} />;
}
