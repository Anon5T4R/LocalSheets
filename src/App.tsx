import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { Spreadsheet, SheetInstance } from "./Spreadsheet";
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
import { Settings, loadSettings, saveSettings } from "./lib/settings";
import "./App.css";

function fmtFromPath(path: string | null): "csv" | "xlsx" {
  return path && path.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
}

function App() {
  const sheetRef = useRef<SheetInstance | null>(null);
  const ws = () => sheetRef.current?.[0];

  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

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

  const applyEdits = useCallback((edits: CellEdit[]) => {
    const w = ws();
    if (!w) return;
    edits.forEach((e) => {
      try {
        w.setValue(e.cell, e.value);
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
      w.setData(grid.length ? grid : [[""]]);
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
      Array.from({ length: 40 }, () => Array.from({ length: 12 }, () => "")),
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
        <button className={"tb-btn" + (aiOpen ? " is-active" : "")} onClick={() => setAiOpen((v) => !v)} title="IA local">✦ IA</button>
      </div>

      <div className="workspace">
        <div className="sheet-wrap">
          <Spreadsheet
            onReady={(inst) => {
              sheetRef.current = inst;
            }}
            onChange={markDirty}
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
    </div>
  );
}

export default App;
