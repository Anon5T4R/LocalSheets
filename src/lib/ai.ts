import { invoke } from "@tauri-apps/api/core";
import type { Grid } from "./sheet-io";
import { t } from "./i18n";

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
    if (Date.now() - start > timeoutMs) throw new Error(t("ai.err.timeout"));
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
    body: JSON.stringify({
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.4,
      // Desliga o "raciocínio" por padrão em modelos Qwen3/DeepSeek e afins.
      // É o mesmo que o LM Studio faz: passa enable_thinking=false ao template
      // de chat do servidor. Modelos que não usam isso simplesmente ignoram.
      chat_template_kwargs: { enable_thinking: false },
      reasoning_format: "none",
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(t("ai.err.status", { status: res.status }));

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
  if (!data || !data.length) return t("ai.ctx.empty");
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
  if (lastRow < 0) return t("ai.ctx.empty");
  const fullLastRow = lastRow;
  const fullLastCol = lastCol;
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
  // The model must know when it is seeing a cropped view — otherwise it will
  // happily "total" only the visible slice and get the answer silently wrong.
  if (fullLastRow > lastRow || fullLastCol > lastCol) {
    lines.push(
      t("ai.ctx.cropped", {
        shown: `${colLetter(lastCol)}${lastRow + 1}`,
        full: `${colLetter(fullLastCol)}${fullLastRow + 1}`,
      })
    );
  }
  return lines.join("\n");
}

export interface CellEdit {
  cell: string;
  /** New cell content (text, number or "=formula"). Absent for style-only edits. */
  value?: string | number;
  /** CSS declarations to format the cell(s), e.g. "background-color: #ef4444". */
  style?: string;
}

/** Extract a JSON array of edits ({cell, value?, style?}) from the model's reply. */
export function parseEdits(text: string): CellEdit[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.match(/\[\s*\{[\s\S]*\}\s*\]/)?.[0];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw.trim());
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.cell === "string")
      .map((e) => {
        const edit: CellEdit = { cell: String(e.cell).toUpperCase().trim() };
        if ("value" in e) edit.value = e.value ?? "";
        if (typeof e.style === "string" && e.style.trim()) edit.style = e.style.trim();
        return edit;
      })
      // Drop empty objects that carry neither a value nor a style.
      .filter((e) => e.value !== undefined || e.style !== undefined);
  } catch {
    return [];
  }
}

export const SHEET_SYSTEM = (context: string) => t("ai.system", { context });
