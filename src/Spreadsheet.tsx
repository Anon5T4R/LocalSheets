import { useEffect, useRef } from "react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import "material-icons/iconfont/material-icons.css";
import { computeFormula } from "./lib/formula-fix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetInstance = any;

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
          minDimensions: [26, 100],
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
