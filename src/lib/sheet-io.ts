import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import * as XLSX from "xlsx";
import {
  Cell,
  Grid,
  NamedSheet,
  SheetOut,
  sheetToCsv,
  sheetToGrid,
  sheetsToWorkbook,
  workbookToSheets,
} from "./sheet-codec";

export type { Cell, Grid, NamedSheet, SheetOut };

export interface SheetDoc {
  path: string;
  sheets: NamedSheet[];
}

export function fmtFromPath(path: string): "csv" | "xlsx" {
  return path.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function loadSheetPath(path: string): Promise<SheetDoc> {
  if (fmtFromPath(path) === "csv") {
    const text = await invoke<string>("read_text_file", { path });
    const wb = XLSX.read(text, { type: "string" });
    return {
      path,
      sheets: [{ name: "Planilha1", data: sheetToGrid(wb.Sheets[wb.SheetNames[0]]) }],
    };
  }
  const b64 = await invoke<string>("read_file_base64", { path });
  const wb = XLSX.read(b64, { type: "base64" });
  return { path, sheets: workbookToSheets(wb) };
}

export async function openSheet(): Promise<SheetDoc | null> {
  const selected = await openDialog({
    multiple: false,
    filters: [
      { name: "Planilhas", extensions: ["xlsx", "csv"] },
      { name: "Todos os arquivos", extensions: ["*"] },
    ],
  });
  if (!selected || Array.isArray(selected)) return null;
  return loadSheetPath(selected);
}

/**
 * Save every worksheet to XLSX (formulas persisted via `cell.f`), or the
 * single given sheet's displayed values to CSV — the caller picks which
 * sheet goes into a CSV.
 */
export async function saveSheetTo(path: string, sheets: SheetOut[]): Promise<void> {
  if (fmtFromPath(path) === "csv") {
    await invoke("write_text_file", { path, contents: sheetToCsv(sheets[0]) });
  } else {
    const b64 = XLSX.write(sheetsToWorkbook(sheets), { type: "base64", bookType: "xlsx" });
    await invoke("write_file_base64", { path, base64Data: b64 });
  }
}

/** "Save as" dialog — returns the chosen path without writing anything. */
export async function pickSavePath(suggested = "planilha.xlsx"): Promise<string | null> {
  return saveDialog({
    defaultPath: suggested,
    filters: [
      { name: "Excel", extensions: ["xlsx"] },
      { name: "CSV", extensions: ["csv"] },
    ],
  });
}
