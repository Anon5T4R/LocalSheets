import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import * as XLSX from "xlsx";

export type Cell = string | number;
export type Grid = Cell[][];

export interface SheetFile {
  path: string;
  data: Grid;
}

function fmtFromPath(path: string): "csv" | "xlsx" {
  return path.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function loadSheetPath(path: string): Promise<SheetFile> {
  const fmt = fmtFromPath(path);
  let wb: XLSX.WorkBook;
  if (fmt === "csv") {
    const text = await invoke<string>("read_text_file", { path });
    wb = XLSX.read(text, { type: "string" });
  } else {
    const b64 = await invoke<string>("read_file_base64", { path });
    wb = XLSX.read(b64, { type: "base64" });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: "" });
  return { path, data };
}

export async function openSheet(): Promise<SheetFile | null> {
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

export async function saveSheetTo(path: string, data: Grid): Promise<void> {
  const ws = XLSX.utils.aoa_to_sheet(data);
  if (fmtFromPath(path) === "csv") {
    await invoke("write_text_file", { path, contents: XLSX.utils.sheet_to_csv(ws) });
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    await invoke("write_file_base64", { path, base64Data: b64 });
  }
}

export async function saveSheetAs(data: Grid, suggested = "planilha.xlsx"): Promise<string | null> {
  const path = await saveDialog({
    defaultPath: suggested,
    filters: [
      { name: "Excel", extensions: ["xlsx"] },
      { name: "CSV", extensions: ["csv"] },
    ],
  });
  if (!path) return null;
  await saveSheetTo(path, data);
  return path;
}
