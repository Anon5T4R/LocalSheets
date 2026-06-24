import { invoke } from "@tauri-apps/api/core";
import type { Grid } from "./sheet-io";

export interface ModelInfo {
  name: string;
  path: string;
  size_gb: number;
  is_projector: boolean;
}

export interface LlmStatus {
  running: boolean;
  port: number;
  model: string;
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
}

// --- Rust command wrappers (camelCase keys -> snake_case Rust params) ---

export const listModels = (dir: string) => invoke<ModelInfo[]>("list_models", { dir });

export const startLlm = (modelPath: string, nGpuLayers: number, ctxSize: number) =>
  invoke<number>("start_llm", { modelPath, nGpuLayers, ctxSize });

export const stopLlm = () => invoke<void>("stop_llm");

export const llmStatus = () => invoke<LlmStatus>("llm_status");

// --- llama-server HTTP (OpenAI-compatible, 127.0.0.1) ---

export async function waitHealthy(port: number, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch {
      /* warming up */
    }
    if (Date.now() - start > timeoutMs) throw new Error("o modelo demorou demais para carregar");
    await new Promise((res) => setTimeout(res, 500));
  }
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
}

export async function streamChat(
  port: number,
  messages: ChatMsg[],
  onDelta: (d: StreamDelta) => void,
  opts: { temperature?: number; signal?: AbortSignal } = {}
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true, temperature: opts.temperature ?? 0.4 }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`a IA respondeu ${res.status}`);

  let inThink = false;
  const routeContent = (text: string) => {
    while (text.length) {
      if (!inThink) {
        const i = text.indexOf("<think>");
        if (i === -1) return onDelta({ content: text });
        if (i > 0) onDelta({ content: text.slice(0, i) });
        inThink = true;
        text = text.slice(i + 7);
      } else {
        const j = text.indexOf("</think>");
        if (j === -1) return onDelta({ reasoning: text });
        if (j > 0) onDelta({ reasoning: text.slice(0, j) });
        inThink = false;
        text = text.slice(j + 8);
      }
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) onDelta({ reasoning: delta.reasoning_content });
        if (delta.content) routeContent(delta.content);
      } catch {
        /* ignore partial */
      }
    }
  }
}

// --- Spreadsheet <-> AI helpers ---

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

/** Render the used range as a readable A1-addressed grid for the model. */
export function sheetToContext(data: Grid, maxRows = 40, maxCols = 20): string {
  if (!data || !data.length) return "(planilha vazia)";
  let lastRow = -1;
  let lastCol = -1;
  data.forEach((row, r) => {
    if (!row) return;
    row.forEach((c, ci) => {
      if (c !== "" && c != null) {
        if (r > lastRow) lastRow = r;
        if (ci > lastCol) lastCol = ci;
      }
    });
  });
  if (lastRow < 0) return "(planilha vazia)";
  lastRow = Math.min(lastRow, maxRows - 1);
  lastCol = Math.min(lastCol, maxCols - 1);

  const lines: string[] = [];
  let head = "    |";
  for (let c = 0; c <= lastCol; c++) head += " " + colLetter(c) + " |";
  lines.push(head);
  for (let r = 0; r <= lastRow; r++) {
    let line = String(r + 1).padStart(3) + " |";
    for (let c = 0; c <= lastCol; c++) {
      const v = data[r] && data[r][c] != null ? String(data[r][c]) : "";
      line += " " + v + " |";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export interface CellEdit {
  cell: string;
  value: string | number;
}

/** Extract a JSON array of {cell,value} edits from the model's reply, if present. */
export function parseEdits(text: string): CellEdit[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.match(/\[\s*\{[\s\S]*\}\s*\]/)?.[0];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw.trim());
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.cell === "string")
      .map((e) => ({ cell: String(e.cell).toUpperCase().trim(), value: e.value ?? "" }));
  } catch {
    return [];
  }
}

export const SHEET_SYSTEM = (context: string) =>
  `Você é um assistente de planilha do LocalSheets. A planilha atual (notação A1, colunas no topo, linhas à esquerda):\n\n${context}\n\n` +
  `Quando o usuário pedir para MODIFICAR/preencher/calcular a planilha, responda em duas partes:\n` +
  `1) uma frase curta explicando; 2) um bloco \`\`\`json com um array de edições no formato ` +
  `[{"cell":"B2","value":"=A2*2"}]. Use fórmulas (começando com =) quando fizer sentido. ` +
  `Para PERGUNTAS sobre os dados, responda só em texto, sem JSON.`;
