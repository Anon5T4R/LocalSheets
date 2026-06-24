import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { Spreadsheet, SheetInstance, MIN_COLS, MIN_ROWS } from "./Spreadsheet";
import { SheetAiPanel } from "./ai/SheetAiPanel";
import { CellEdit } from "./lib/ai";
import {
  Grid,
  baseName,
  loadSheetPath,
  openSheet,
  saveSheetAs,
  saveSheetTo,
} from "./lib/sheet-io";
import { Settings, Theme, applyTheme, loadSettings, saveSettings } from "./lib/settings";
import "./App.css";

function fmtFromPath(path: string | null): "csv" | "xlsx" {
  return path && path.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
}

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function indexToCol(index: number): string {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Expand an A1 reference into the list of cell names it covers. A single cell
// ("B2") returns itself; a range ("A1:D1") returns every cell in the rectangle.
// Used so AI edits can target ranges for both values and styles.
function expandRange(ref: string): string[] {
  const m = ref.toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) return [ref];
  if (!m[3]) return [m[1] + m[2]];
  const x1 = colToIndex(m[1]);
  const y1 = parseInt(m[2], 10);
  const x2 = colToIndex(m[3]);
  const y2 = parseInt(m[4], 10);
  const [lox, hix] = x1 <= x2 ? [x1, x2] : [x2, x1];
  const [loy, hiy] = y1 <= y2 ? [y1, y2] : [y2, y1];
  const cells: string[] = [];
  for (let y = loy; y <= hiy; y++) for (let x = lox; x <= hix; x++) cells.push(indexToCol(x) + y);
  return cells;
}

// Ensure a grid fills at least the default viewport (a 1x1 or sparse grid would
// render collapsed). Existing data wider/taller than the minimum is kept.
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

function App() {
  const sheetRef = useRef<SheetInstance | null>(null);
  const ws = () => sheetRef.current?.[0];

  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Formula bar: active cell name + its raw content (formula or value).
  const [cellRef, setCellRef] = useState("A1");
  const [formula, setFormula] = useState("");

  // Apply the saved theme on load, and follow the OS when set to "system".
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const loadingRef = useRef(false);

  const markDirty = useCallback(() => {
    if (loadingRef.current) return;
    setDirty(true);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(saveSettings(patch));
  }, []);

  const getData = useCallback((): Grid => (ws()?.getData() as Grid) ?? [], []);

  // --- Formula bar ---
  const handleSelect = useCallback((cell: string, raw: string) => {
    setCellRef(cell);
    setFormula(raw);
  }, []);

  const commitFormula = useCallback(
    (value: string) => {
      const w = ws();
      if (!w) return;
      try {
        w.setValue(cellRef, value);
      } catch {
        /* ignore bad ref */
      }
    },
    [cellRef]
  );

  const revertFormula = useCallback(() => {
    const w = ws();
    const m = cellRef.toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!w || !m) return;
    const raw = w.getValueFromCoords(colToIndex(m[1]), parseInt(m[2], 10) - 1, false);
    setFormula(raw == null ? "" : String(raw));
  }, [cellRef]);

  // Name box: typing a reference (e.g. "B10") + Enter jumps to that cell.
  const gotoCell = useCallback((ref: string) => {
    const w = ws();
    const m = ref.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!w || !m) return;
    const x = colToIndex(m[1]);
    const y = parseInt(m[2], 10) - 1;
    try {
      w.updateSelectionFromCoords(x, y, x, y);
    } catch {
      /* ignore */
    }
  }, []);

  const applyEdits = useCallback((edits: CellEdit[]) => {
    const w = ws();
    if (!w) return;
    edits.forEach((e) => {
      try {
        const cells = expandRange(e.cell);
        if (e.value !== undefined) {
          cells.forEach((c) => w.setValue(c, e.value as string | number));
        }
        if (e.style) {
          const styles: Record<string, string> = {};
          cells.forEach((c) => (styles[c] = e.style as string));
          w.setStyle(styles);
        }
      } catch {
        /* ignore bad cell */
      }
    });
  }, []);

  const loadGrid = useCallback((grid: Grid, path: string | null) => {
    const w = ws();
    if (!w) return;
    loadingRef.current = true;
    try {
      w.setData(padGrid(grid));
    } catch {
      /* ignore */
    }
    setFilePath(path);
    setDirty(false);
    setTimeout(() => (loadingRef.current = false), 0);
  }, []);

  const handleOpen = useCallback(async () => {
    try {
      const f = await openSheet();
      if (f) loadGrid(f.data, f.path);
    } catch (e) {
      await ask(`Não foi possível abrir:\n${e}`, { title: "LocalSheets", kind: "error" });
    }
  }, [loadGrid]);

  const handleNew = useCallback(() => {
    loadGrid(
      Array.from({ length: MIN_ROWS }, () => Array.from({ length: MIN_COLS }, () => "")),
      null
    );
  }, [loadGrid]);

  const handleSaveAs = useCallback(async () => {
    const suggested = filePath ? baseName(filePath) : "planilha.xlsx";
    try {
      const p = await saveSheetAs(getData(), suggested);
      if (p) {
        setFilePath(p);
        setDirty(false);
      }
    } catch (e) {
      await ask(`Não foi possível salvar:\n${e}`, { title: "LocalSheets", kind: "error" });
    }
  }, [filePath, getData]);

  const handleSave = useCallback(async () => {
    if (!filePath) return handleSaveAs();
    try {
      await saveSheetTo(filePath, getData());
      setDirty(false);
    } catch (e) {
      await ask(`Não foi possível salvar:\n${e}`, { title: "LocalSheets", kind: "error" });
    }
  }, [filePath, getData, handleSaveAs]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s" && e.shiftKey) {
        e.preventDefault();
        handleSaveAs();
      } else if (k === "s") {
        e.preventDefault();
        handleSave();
      } else if (k === "o") {
        e.preventDefault();
        handleOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleSaveAs, handleOpen]);

  // Open a file passed at launch / forwarded by a 2nd instance.
  const openedStartup = useRef(false);
  useEffect(() => {
    if (openedStartup.current) return;
    openedStartup.current = true;
    invoke<string | null>("get_startup_file")
      .then((p) => {
        if (p) loadSheetPath(p).then((f) => loadGrid(f.data, f.path)).catch(() => {});
      })
      .catch(() => {});
    const un = listen<string>("open-file", (e) => {
      if (e.payload) loadSheetPath(e.payload).then((f) => loadGrid(f.data, f.path)).catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
  }, [loadGrid]);

  // Confirm-on-close (Rust prevents the close and emits this).
  useEffect(() => {
    const un = listen("close-requested", async () => {
      try {
        if (dirtyRef.current) {
          const ok = await ask("A planilha tem alterações não salvas.\nSair mesmo assim?", {
            title: "Sair do LocalSheets",
            kind: "warning",
          });
          if (!ok) return;
        }
      } catch {
        /* fall through to exit */
      }
      invoke("exit_app").catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const fileName = filePath ? baseName(filePath) : "sem título";
  const fmt = fmtFromPath(filePath);

  return (
    <div className="app">
      <div className="menubar">
        <span className="brand">LocalSheets</span>
        <div className="tb-sep" />
        <button className="tb-btn" onClick={handleNew} title="Nova planilha">Novo</button>
        <button className="tb-btn" onClick={handleOpen} title="Abrir (Ctrl+O)">Abrir</button>
        <button className="tb-btn" onClick={handleSave} title="Salvar (Ctrl+S)">Salvar</button>
        <button className="tb-btn" onClick={handleSaveAs} title="Salvar como (Ctrl+Shift+S)">Salvar como…</button>
        <div className="tb-spacer" />
        <span className="filename" title={fileName}>{dirty ? "● " : ""}{fileName} · {fmt.toUpperCase()}</span>
        <div className="tb-sep" />
        <button className="tb-btn" onClick={() => setSettingsOpen(true)} title="Configurações">⚙</button>
        <button className={"tb-btn" + (aiOpen ? " is-active" : "")} onClick={() => setAiOpen((v) => !v)} title="IA local">✦ IA</button>
      </div>

      <div className="formula-bar">
        <input
          className="name-box"
          value={cellRef}
          onChange={(e) => setCellRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              gotoCell(cellRef);
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          title="Ir para a célula"
        />
        <span className="fx-label">fx</span>
        <input
          className="formula-input"
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFormula(formula);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              revertFormula();
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          placeholder="Valor ou fórmula (=…)"
        />
      </div>

      <div className="workspace">
        <div className="sheet-wrap">
          <Spreadsheet
            onReady={(inst) => {
              sheetRef.current = inst;
            }}
            onChange={markDirty}
            onSelect={handleSelect}
          />
        </div>
        {aiOpen && (
          <SheetAiPanel
            getData={getData}
            applyEdits={applyEdits}
            settings={settings}
            onPersist={updateSettings}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={settings.theme}
          onTheme={(t) => updateSettings({ theme: t })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SettingsModal({
  theme,
  onTheme,
  onClose,
}: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  onClose: () => void;
}) {
  const opts: { id: Theme; label: string }[] = [
    { id: "system", label: "Sistema" },
    { id: "light", label: "Claro" },
    { id: "dark", label: "Escuro" },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">Configurações</div>
        <div className="modal-body">
          <label className="modal-field">
            <span>Tema</span>
            <div className="seg">
              {opts.map((o) => (
                <button
                  key={o.id}
                  className={theme === o.id ? "active" : ""}
                  onClick={() => onTheme(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </label>
        </div>
        <div className="modal-footer">
          <button className="tb-btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default App;
