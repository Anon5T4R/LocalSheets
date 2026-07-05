import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChatMsg,
  CellEdit,
  ModelInfo,
  SHEET_SYSTEM,
  listModels,
  llmStatus,
  parseEdits,
  sheetToContext,
  startLlm,
  stopLlm,
  streamChat,
  waitHealthy,
} from "../lib/ai";
import { Grid } from "../lib/sheet-io";
import { Settings } from "../lib/settings";

type Status = "stopped" | "loading" | "ready" | "error";

interface Props {
  getData: () => Grid;
  applyEdits: (edits: CellEdit[]) => void;
  settings: Settings;
  onPersist: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function SheetAiPanel({ getData, applyEdits, settings, onPersist, onClose }: Props) {
  const [dir, setDir] = useState(settings.modelsDir);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelPath, setModelPath] = useState(settings.lastModelPath);
  const [ngl, setNgl] = useState(settings.ngl);
  const [ctx, setCtx] = useState(settings.ctx);

  const [status, setStatus] = useState<Status>("stopped");
  const [statusMsg, setStatusMsg] = useState("");
  const [port, setPort] = useState(0);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    llmStatus().then((s) => {
      if (s.running) {
        setStatus("ready");
        setPort(s.port);
        setModelPath(s.model);
      }
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const scanDir = useCallback(
    async (target: string) => {
      if (!target.trim()) {
        setStatusMsg("Escolha a pasta onde estão seus modelos .gguf.");
        return;
      }
      try {
        const found = await listModels(target);
        setModels(found);
        setStatusMsg(found.length ? "" : "Nenhum .gguf encontrado nessa pasta.");
        const firstChat = found.find((m) => !m.is_projector);
        if (firstChat && !modelPath) setModelPath(firstChat.path);
      } catch (e) {
        setStatusMsg(String(e));
      }
    },
    [modelPath]
  );

  const browseDir = useCallback(async () => {
    const picked = await openDialog({ directory: true, title: "Pasta de modelos .gguf" });
    if (typeof picked !== "string" || !picked) return;
    setDir(picked);
    onPersist({ modelsDir: picked });
    scanDir(picked);
  }, [onPersist, scanDir]);

  useEffect(() => {
    if (settings.modelsDir) scanDir(settings.modelsDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    if (!modelPath) return setStatusMsg("Escolha um modelo primeiro.");
    onPersist({ modelsDir: dir, lastModelPath: modelPath, ngl, ctx });
    setStatus("loading");
    setStatusMsg("Iniciando llama-server e carregando o modelo…");
    try {
      const p = await startLlm(modelPath, ngl, ctx);
      await waitHealthy(p);
      setPort(p);
      setStatus("ready");
      setStatusMsg("");
    } catch (e) {
      setStatus("error");
      setStatusMsg(String(e));
    }
  }, [modelPath, ngl, ctx, dir, onPersist]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    await stopLlm();
    setStatus("stopped");
  }, []);

  const runChat = useCallback(
    async (userContent: string) => {
      if (status !== "ready" || streaming || !userContent.trim()) return;
      const context = sheetToContext(getData());
      const history = [...messages, { role: "user", content: userContent } as ChatMsg];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");

      const convo: ChatMsg[] = [{ role: "system", content: SHEET_SYSTEM(context) }, ...history];
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      let full = "";
      try {
        await streamChat(
          port,
          convo,
          (d) => {
            if (d.content) full += d.content;
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = {
                role: "assistant",
                content: last.content + (d.content ?? ""),
                reasoning: (last.reasoning ?? "") + (d.reasoning ?? "") || undefined,
              };
              return copy;
            });
          },
          { signal: ac.signal }
        );
        // Apply any structured edits the model produced.
        const edits = parseEdits(full);
        if (edits.length) {
          applyEdits(edits);
          setMessages((m) => [
            ...m,
            { role: "assistant", content: `✓ ${edits.length} célula(s) atualizada(s): ${edits.map((e) => e.cell).join(", ")}` },
          ]);
        }
      } catch (e) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${e}` };
          return copy;
        });
      } finally {
        setStreaming(false);
      }
    },
    [status, streaming, messages, port, getData, applyEdits]
  );

  const dot = status === "ready" ? "#22c55e" : status === "loading" ? "#eab308" : status === "error" ? "#ef4444" : "#9ca3af";

  return (
    <aside className="ai-panel">
      <div className="ai-header">
        <span className="ai-dot" style={{ background: dot }} />
        <strong>IA local</strong>
        <span className="ai-spacer" />
        <button className="tb-btn" onClick={() => { abortRef.current?.abort(); setMessages([]); }} disabled={!messages.length} title="Limpar conversa">🗑</button>
        <button className="tb-btn" onClick={onClose} title="Fechar painel">✕</button>
      </div>

      <div className="ai-config">
        <label className="ai-field">
          <span>Pasta de modelos</span>
          <div className="ai-row">
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              spellCheck={false}
              placeholder="Pasta com modelos .gguf"
            />
            <button className="tb-btn" onClick={browseDir} title="Escolher pasta">…</button>
            <button className="tb-btn" onClick={() => scanDir(dir)}>Escanear</button>
          </div>
        </label>
        <label className="ai-field">
          <span>Modelo ({models.filter((m) => !m.is_projector).length} encontrados)</span>
          <select value={modelPath} onChange={(e) => setModelPath(e.target.value)} disabled={status === "ready" || status === "loading"}>
            <option value="">— escolher —</option>
            {models.filter((m) => !m.is_projector).map((m) => (
              <option key={m.path} value={m.path}>{m.name} · {m.size_gb.toFixed(2)} GB</option>
            ))}
          </select>
        </label>
        <div className="ai-row ai-tune">
          <label title="Camadas na GPU (0 = só CPU)">GPU layers
            <input type="number" min={0} max={999} value={ngl} onChange={(e) => setNgl(Number(e.target.value))} disabled={status === "ready" || status === "loading"} />
          </label>
          <label title="Tamanho do contexto">Contexto
            <input type="number" min={512} step={512} value={ctx} onChange={(e) => setCtx(Number(e.target.value))} disabled={status === "ready" || status === "loading"} />
          </label>
          {status === "ready" ? (
            <button className="tb-btn ai-stop" onClick={stop}>Parar</button>
          ) : (
            <button className="tb-btn ai-start" onClick={start} disabled={status === "loading"}>{status === "loading" ? "Carregando…" : "Iniciar"}</button>
          )}
        </div>
        {statusMsg && <div className="ai-status-msg">{statusMsg}</div>}
      </div>

      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-empty">Inicie um modelo e peça algo, ex.:<br />“preencha B com o dobro de A”, “some a coluna A em A10”, “crie uma coluna Total”.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-${m.role}`}>
            {m.role === "assistant" && m.reasoning && (
              <details className="ai-reasoning" open={!m.content}>
                <summary>💭 Raciocínio</summary>
                <div className="ai-reasoning-body">{m.reasoning}</div>
              </details>
            )}
            <div className="ai-msg-body">{m.content || (streaming && i === messages.length - 1 && !m.reasoning ? "…" : "")}</div>
          </div>
        ))}
      </div>

      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); runChat(input); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runChat(input); } }}
          placeholder={status === "ready" ? "Peça uma edição ou pergunte sobre os dados…" : "Inicie um modelo"}
          disabled={status !== "ready"}
          rows={2}
        />
        {streaming ? (
          <button type="button" className="tb-btn" onClick={() => abortRef.current?.abort()}>Parar</button>
        ) : (
          <button type="submit" className="tb-btn ai-start" disabled={status !== "ready" || !input.trim()}>Enviar</button>
        )}
      </form>
    </aside>
  );
}
