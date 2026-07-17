import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { Spreadsheet, SheetHandle, MIN_COLS, MIN_ROWS } from "./Spreadsheet";
import { SheetAiPanel } from "./ai/SheetAiPanel";
import { CellEdit } from "./lib/ai";
import {
  Grid,
  NamedSheet,
  baseName,
  fmtFromPath,
  loadSheetPath,
  openSheet,
  pickSavePath,
  saveSheetTo,
} from "./lib/sheet-io";
import { Settings, Theme, applyTheme, loadSettings, saveSettings } from "./lib/settings";
import { t as tr } from "./lib/i18n";
import { LocalePicker } from "./components/LocalePicker";
import "./App.css";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStyleToSelection(ws: any, prop: string, val: string) {
  try {
    const sel = ws.getSelection?.();
    if (!sel) return;
    const [x1, y1, x2, y2] = sel;
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        ws.setStyle(indexToCol(x) + (y + 1), prop, val);
      }
    }
  } catch { /* ignore */ }
}

const EMPTY_DOC: NamedSheet[] = [
  {
    name: "Planilha1",
    data: Array.from({ length: MIN_ROWS }, () => Array.from({ length: MIN_COLS }, () => "")),
  },
];

function App() {
  const sheetRef = useRef<SheetHandle | null>(null);
  // Always the *active* worksheet — saving, AI and the formula bar follow the
  // tab the user is on.
  const ws = () => sheetRef.current?.active();

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

  // Displayed (computed) values of the active worksheet — what the AI sees.
  const getAiGrid = useCallback(
    (): Grid => (ws()?.getData(false, true) as Grid) ?? [],
    []
  );

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

  const loadDoc = useCallback((sheets: NamedSheet[], path: string | null) => {
    const h = sheetRef.current;
    if (!h) return;
    loadingRef.current = true;
    try {
      h.load(sheets);
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
      if (f) loadDoc(f.sheets, f.path);
    } catch (e) {
      await ask(tr("dlg.openFail", { e: String(e) }), { title: "LocalSheets", kind: "error" });
    }
  }, [loadDoc]);

  const handleNew = useCallback(() => {
    loadDoc(EMPTY_DOC, null);
  }, [loadDoc]);

  // Collect what should be written for `path`: every worksheet for XLSX, or
  // just the active one for CSV (confirming with the user when others exist).
  const collectForSave = useCallback(async (path: string) => {
    const h = sheetRef.current;
    if (!h) return null;
    const sheets = h.sheets();
    if (fmtFromPath(path) !== "csv") return sheets;
    if (sheets.length > 1) {
      const ok = await ask(tr("dlg.csvWarn"), { title: "LocalSheets", kind: "warning" });
      if (!ok) return null;
    }
    return [sheets[h.activeIndex()] ?? sheets[0]];
  }, []);

  const handleSaveAs = useCallback(async () => {
    const suggested = filePath ? baseName(filePath) : "planilha.xlsx";
    try {
      const p = await pickSavePath(suggested);
      if (!p) return;
      const picked = await collectForSave(p);
      if (!picked) return;
      await saveSheetTo(p, picked);
      setFilePath(p);
      setDirty(false);
    } catch (e) {
      await ask(tr("dlg.saveFail", { e: String(e) }), { title: "LocalSheets", kind: "error" });
    }
  }, [filePath, collectForSave]);

  const handleSave = useCallback(async () => {
    if (!filePath) return handleSaveAs();
    try {
      const picked = await collectForSave(filePath);
      if (!picked) return;
      await saveSheetTo(filePath, picked);
      setDirty(false);
    } catch (e) {
      await ask(tr("dlg.saveFail", { e: String(e) }), { title: "LocalSheets", kind: "error" });
    }
  }, [filePath, collectForSave, handleSaveAs]);

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
        if (p) loadSheetPath(p).then((f) => loadDoc(f.sheets, f.path)).catch(() => {});
      })
      .catch(() => {});
    const un = listen<string>("open-file", (e) => {
      if (e.payload) loadSheetPath(e.payload).then((f) => loadDoc(f.sheets, f.path)).catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
  }, [loadDoc]);

  // Confirm-on-close (Rust prevents the close and emits this).
  useEffect(() => {
    const un = listen("close-requested", async () => {
      try {
        if (dirtyRef.current) {
          const ok = await ask(tr("dlg.exitConfirm"), {
            title: tr("dlg.exitTitle"),
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

  const fileName = filePath ? baseName(filePath) : tr("tb.untitled");
  const fmt = filePath ? fmtFromPath(filePath) : "xlsx";

  return (
    <div className="app">
      <div className="menubar">
        <span className="brand">LocalSheets</span>
        <div className="tb-sep" />
        <button className="tb-btn" onClick={handleNew} title={tr("tb.newTitle")}>{tr("tb.new")}</button>
        <button className="tb-btn" onClick={handleOpen} title={tr("tb.openTitle")}>{tr("tb.open")}</button>
        <button className="tb-btn" onClick={handleSave} title={tr("tb.saveTitle")}>{tr("tb.save")}</button>
        <button className="tb-btn" onClick={handleSaveAs} title={tr("tb.saveAsTitle")}>{tr("tb.saveAs")}</button>
        <div className="tb-spacer" />
        <span className="filename" title={fileName}>{dirty ? "● " : ""}{fileName} · {fmt.toUpperCase()}</span>
        <div className="tb-sep" />
        <LocalePicker />
        <button className="tb-btn" onClick={() => setSettingsOpen(true)} title={tr("tb.settingsTitle")}>⚙</button>
        <button className={"tb-btn" + (aiOpen ? " is-active" : "")} onClick={() => setAiOpen((v) => !v)} title={tr("tb.aiTitle")}>{tr("tb.ai")}</button>
      </div>

      <div className="format-bar">
        <select
          className="tb-btn tb-select"
          defaultValue=""
          onChange={(e) => {
            const w = ws();
            if (w && e.target.value) applyStyleToSelection(w, "font-family", e.target.value);
            e.target.value = "";
          }}
          title={tr("fmt.fontTitle")}
        >
          <option value="">{tr("fmt.font")}</option>
          <option value="sans-serif">Sans-serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
        </select>
        <select
          className="tb-btn tb-select"
          defaultValue=""
          onChange={(e) => {
            const w = ws();
            if (w && e.target.value) applyStyleToSelection(w, "font-size", e.target.value + "px");
            e.target.value = "";
          }}
          title={tr("fmt.sizeTitle")}
        >
          <option value="">{tr("fmt.size")}</option>
          {[8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
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
          title={tr("fx.gotoTitle")}
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
          placeholder={tr("fx.placeholder")}
        />
      </div>

      <div className="workspace">
        <div className="sheet-wrap">
          <Spreadsheet
            onReady={(handle) => {
              sheetRef.current = handle;
            }}
            onChange={markDirty}
            onSelect={handleSelect}
          />
        </div>
        {aiOpen && (
          <SheetAiPanel
            getData={getAiGrid}
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
    { id: "system", label: tr("set.system") },
    { id: "light", label: tr("set.light") },
    { id: "dark", label: tr("set.dark") },
    { id: "nature", label: tr("set.nature") },
    { id: "darkblue", label: tr("set.darkblue") },
    { id: "calmgreen", label: tr("set.calmgreen") },
    { id: "pastelpink", label: tr("set.pastelpink") },
    { id: "punkprincess", label: tr("set.punkprincess") },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{tr("set.title")}</div>
        <div className="modal-body">
          <label className="modal-field">
            <span>{tr("set.theme")}</span>
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
          <button className="tb-btn" onClick={onClose}>{tr("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

export default App;
