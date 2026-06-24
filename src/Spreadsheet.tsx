import { useEffect, useRef } from "react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import "material-icons/iconfont/material-icons.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetInstance = any;

interface SpreadsheetProps {
  onReady: (instance: SheetInstance) => void;
  onChange?: () => void;
}

export function Spreadsheet({ onReady, onChange }: SpreadsheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instance = jspreadsheet(el, {
      tabs: true,
      toolbar: true,
      onchange: () => changeRef.current?.(),
      onafterchanges: () => changeRef.current?.(),
      worksheets: [
        {
          minDimensions: [12, 40],
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
