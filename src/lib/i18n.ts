import { useSyncExternalStore } from "react";

/**
 * i18n leve da UI (mesmo padrão do LocalData/LocalPDF/LocalDraw). `pt` é a fonte
 * da verdade das chaves; `en`/`es` como `Record<MessageKey, string>` fazem o
 * compilador recusar chave faltando ou sobrando. Locale num store externo (não
 * React) pra `t()` rodar fora de componente (contexto/erros da IA, prompt de
 * sistema). O App remonta na troca (key={locale} no main.tsx) — o que também
 * reinstancia o jspreadsheet no idioma novo.
 *
 * Inclui o prompt de sistema da IA (`ai.system`) — assim a IA responde no idioma
 * da UI. O CONTRATO JSON (chaves cell/value/style), os NOMES de propriedade CSS,
 * os VALORES hex, a notação A1 e os nomes de função (SUM…) ficam intactos nas 3
 * línguas; só a prosa e os nomes de cor em linguagem natural mudam.
 */

export type Locale = "pt" | "en" | "es";

/** Endônimos — NÃO traduzir (cada idioma no seu próprio nome). */
export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};

/** Tag BCP-47 por locale (pra toLocaleString/datas/Intl). */
const LOCALE_TAGS: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
};

const LOCALE_KEY = "localsheets.locale";

const pt = {
  // --- comuns / idioma / tema ---
  "lang.title": "Idioma",
  "common.close": "Fechar",

  // --- MenuBar ---
  "tb.new": "Novo",
  "tb.newTitle": "Nova planilha",
  "tb.open": "Abrir",
  "tb.openTitle": "Abrir (Ctrl+O)",
  "tb.save": "Salvar",
  "tb.saveTitle": "Salvar (Ctrl+S)",
  "tb.saveAs": "Salvar como…",
  "tb.saveAsTitle": "Salvar como (Ctrl+Shift+S)",
  "tb.settingsTitle": "Configurações",
  "tb.ai": "✦ IA",
  "tb.aiTitle": "IA local",
  "tb.untitled": "sem título",

  // --- Barra de formatação ---
  "fmt.font": "Fonte",
  "fmt.fontTitle": "Fonte",
  "fmt.size": "Tamanho",
  "fmt.sizeTitle": "Tamanho da fonte",

  // --- Barra de fórmulas ---
  "fx.gotoTitle": "Ir para a célula",
  "fx.placeholder": "Valor ou fórmula (=…)",

  // --- Diálogos / toasts (App) ---
  "dlg.openFail": "Não foi possível abrir:\n{e}",
  "dlg.saveFail": "Não foi possível salvar:\n{e}",
  "dlg.csvWarn":
    "O formato CSV salva apenas a planilha ativa — as outras abas ficarão de fora.\nContinuar?",
  "dlg.exitConfirm": "A planilha tem alterações não salvas.\nSair mesmo assim?",
  "dlg.exitTitle": "Sair do LocalSheets",

  // --- Modal de Configurações ---
  "set.title": "Configurações",
  "set.theme": "Tema",
  "set.system": "Sistema",
  "set.light": "Claro",
  "set.dark": "Escuro",
  "set.nature": "Natureza",
  "set.darkblue": "Azul escuro",
  "set.calmgreen": "Verde calmo",
  "set.pastelpink": "Rosa pastel",
  "set.punkprincess": "PunkPrincess",

  // --- Menu de contexto da planilha ---
  "ctx.deleteSheet": "Excluir planilha",
  "ctx.cantDeleteOnly": "Não é possível excluir a única planilha.",
  "ctx.clearBorders": "Limpar bordas da seleção",

  // --- Painel de IA ---
  "ai.title": "IA local",
  "ai.clearTitle": "Limpar conversa",
  "ai.closeTitle": "Fechar painel",
  "ai.modelsFolder": "Pasta de modelos",
  "ai.folderPlaceholder": "Pasta com modelos .gguf",
  "ai.browseTitle": "Escolher pasta",
  "ai.scan": "Escanear",
  "ai.model": "Modelo ({n} encontrados)",
  "ai.chooseModel": "— escolher —",
  "ai.gpuLayers": "GPU layers",
  "ai.gpuLayersTitle": "Camadas na GPU (0 = só CPU)",
  "ai.ctx": "Contexto",
  "ai.ctxTitle": "Tamanho do contexto",
  "ai.stop": "Parar",
  "ai.start": "Iniciar",
  "ai.loading": "Carregando…",
  "ai.pickFolder": "Escolha a pasta onde estão seus modelos .gguf.",
  "ai.noGguf": "Nenhum .gguf encontrado nessa pasta.",
  "ai.pickFolderTitle": "Pasta de modelos .gguf",
  "ai.pickModel": "Escolha um modelo primeiro.",
  "ai.starting": "Iniciando llama-server e carregando o modelo…",
  "ai.emptyLine1": "Inicie um modelo e peça algo, ex.:",
  "ai.emptyLine2":
    "“preencha B com o dobro de A”, “some a coluna A em A10”, “crie uma coluna Total”.",
  "ai.reasoning": "💭 Raciocínio",
  "ai.editsApplied": "✓ {n} célula(s) atualizada(s): {cells}",
  "ai.inputReady": "Peça uma edição ou pergunte sobre os dados…",
  "ai.inputIdle": "Inicie um modelo",
  "ai.send": "Enviar",

  // --- IA (lib) ---
  "ai.err.timeout": "o modelo demorou demais para carregar",
  "ai.err.status": "a IA respondeu {status}",
  "ai.ctx.empty": "(planilha vazia)",
  "ai.ctx.cropped":
    "\nATENÇÃO: recorte parcial — exibindo até {shown}, mas os dados vão até {full}. " +
    "Considere o intervalo completo ao criar fórmulas.",

  // Prompt de sistema da IA — a PROSA e os nomes de cor viram idioma da UI, mas
  // as chaves JSON (cell/value/style), os nomes CSS, os hex, a notação A1 e os
  // nomes de função (SUM) ficam INTACTOS.
  "ai.system":
    "Você é o assistente da planilha do LocalSheets. Estado atual (notação A1, colunas no topo, linhas à esquerda):\n\n{context}\n\n" +
    "Para MODIFICAR a planilha, responda em duas partes:\n" +
    "1) uma frase curta dizendo o que vai fazer;\n" +
    "2) um bloco ```json com um array de edições.\n\n" +
    'Cada edição é um objeto com "cell" e pelo menos um entre "value" e "style":\n' +
    '- "cell": uma célula ("C2") ou um intervalo ("A1:D1").\n' +
    '- "value": número, texto ou fórmula iniciada por "=" (ex.: "=A2+B2"). Use para CONTEÚDO.\n' +
    '- "style": string CSS para FORMATAR (cor, borda, negrito, alinhamento).\n\n' +
    "Propriedades CSS (use exatamente estes nomes):\n" +
    '- cor de fundo: "background-color: #ef4444"\n' +
    '- cor do texto: "color: #ffffff"\n' +
    '- negrito: "font-weight: bold"   |   itálico: "font-style: italic"\n' +
    '- borda: "border: 1px solid #000000"\n' +
    '- alinhar: "text-align: center"\n' +
    'Combine várias com ";" — ex.: "background-color: #ef4444; color: white; font-weight: bold".\n' +
    "Cores comuns: vermelho #ef4444, verde #22c55e, azul #3b82f6, amarelo #eab308, preto #000000, branco #ffffff.\n\n" +
    "Exemplos:\n" +
    '- "pinte A1:D1 de vermelho" → [{"cell":"A1:D1","style":"background-color: #ef4444"}]\n' +
    '- "escreva Total em E1 em negrito" → [{"cell":"E1","value":"Total"},{"cell":"E1","style":"font-weight: bold"}]\n' +
    '- "some a coluna A em A10" → [{"cell":"A10","value":"=SUM(A1:A9)"}]\n\n' +
    "Faça exatamente o que foi pedido, da forma mais direta; não complique. " +
    'NUNCA escreva a formatação como conteúdo da célula (ex.: nunca use "value":"bg_color=red" nem "value":"border=1").\n' +
    "Para PERGUNTAS sobre os dados, responda só em texto, sem JSON.",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "lang.title": "Language",
  "common.close": "Close",

  "tb.new": "New",
  "tb.newTitle": "New spreadsheet",
  "tb.open": "Open",
  "tb.openTitle": "Open (Ctrl+O)",
  "tb.save": "Save",
  "tb.saveTitle": "Save (Ctrl+S)",
  "tb.saveAs": "Save as…",
  "tb.saveAsTitle": "Save as (Ctrl+Shift+S)",
  "tb.settingsTitle": "Settings",
  "tb.ai": "✦ AI",
  "tb.aiTitle": "Local AI",
  "tb.untitled": "untitled",

  "fmt.font": "Font",
  "fmt.fontTitle": "Font",
  "fmt.size": "Size",
  "fmt.sizeTitle": "Font size",

  "fx.gotoTitle": "Go to cell",
  "fx.placeholder": "Value or formula (=…)",

  "dlg.openFail": "Couldn't open:\n{e}",
  "dlg.saveFail": "Couldn't save:\n{e}",
  "dlg.csvWarn":
    "CSV only saves the active worksheet — the other tabs will be left out.\nContinue?",
  "dlg.exitConfirm": "The spreadsheet has unsaved changes.\nQuit anyway?",
  "dlg.exitTitle": "Quit LocalSheets",

  "set.title": "Settings",
  "set.theme": "Theme",
  "set.system": "System",
  "set.light": "Light",
  "set.dark": "Dark",
  "set.nature": "Nature",
  "set.darkblue": "Dark blue",
  "set.calmgreen": "Calm green",
  "set.pastelpink": "Pastel pink",
  "set.punkprincess": "PunkPrincess",

  "ctx.deleteSheet": "Delete worksheet",
  "ctx.cantDeleteOnly": "Can't delete the only worksheet.",
  "ctx.clearBorders": "Clear borders of the selection",

  "ai.title": "Local AI",
  "ai.clearTitle": "Clear conversation",
  "ai.closeTitle": "Close panel",
  "ai.modelsFolder": "Models folder",
  "ai.folderPlaceholder": "Folder with .gguf models",
  "ai.browseTitle": "Choose folder",
  "ai.scan": "Scan",
  "ai.model": "Model ({n} found)",
  "ai.chooseModel": "— choose —",
  "ai.gpuLayers": "GPU layers",
  "ai.gpuLayersTitle": "Layers on the GPU (0 = CPU only)",
  "ai.ctx": "Context",
  "ai.ctxTitle": "Context size",
  "ai.stop": "Stop",
  "ai.start": "Start",
  "ai.loading": "Loading…",
  "ai.pickFolder": "Choose the folder where your .gguf models are.",
  "ai.noGguf": "No .gguf found in that folder.",
  "ai.pickFolderTitle": "Folder with .gguf models",
  "ai.pickModel": "Choose a model first.",
  "ai.starting": "Starting llama-server and loading the model…",
  "ai.emptyLine1": "Start a model and ask for something, e.g.:",
  "ai.emptyLine2":
    "“fill B with double of A”, “sum column A into A10”, “create a Total column”.",
  "ai.reasoning": "💭 Reasoning",
  "ai.editsApplied": "✓ {n} cell(s) updated: {cells}",
  "ai.inputReady": "Ask for an edit or ask about the data…",
  "ai.inputIdle": "Start a model",
  "ai.send": "Send",

  "ai.err.timeout": "the model took too long to load",
  "ai.err.status": "the AI replied {status}",
  "ai.ctx.empty": "(empty spreadsheet)",
  "ai.ctx.cropped":
    "\nWARNING: partial view — showing up to {shown}, but the data goes to {full}. " +
    "Consider the full range when writing formulas.",

  "ai.system":
    "You are the LocalSheets spreadsheet assistant. Current state (A1 notation, columns on top, rows on the left):\n\n{context}\n\n" +
    "To MODIFY the spreadsheet, reply in two parts:\n" +
    "1) a short sentence saying what you'll do;\n" +
    "2) a ```json block with an array of edits.\n\n" +
    'Each edit is an object with "cell" and at least one of "value" and "style":\n' +
    '- "cell": a single cell ("C2") or a range ("A1:D1").\n' +
    '- "value": number, text or a formula starting with "=" (e.g. "=A2+B2"). Use it for CONTENT.\n' +
    '- "style": a CSS string to FORMAT (color, border, bold, alignment).\n\n' +
    "CSS properties (use exactly these names):\n" +
    '- background color: "background-color: #ef4444"\n' +
    '- text color: "color: #ffffff"\n' +
    '- bold: "font-weight: bold"   |   italic: "font-style: italic"\n' +
    '- border: "border: 1px solid #000000"\n' +
    '- align: "text-align: center"\n' +
    'Combine several with ";" — e.g. "background-color: #ef4444; color: white; font-weight: bold".\n' +
    "Common colors: red #ef4444, green #22c55e, blue #3b82f6, yellow #eab308, black #000000, white #ffffff.\n\n" +
    "Examples:\n" +
    '- "paint A1:D1 red" → [{"cell":"A1:D1","style":"background-color: #ef4444"}]\n' +
    '- "write Total in E1 in bold" → [{"cell":"E1","value":"Total"},{"cell":"E1","style":"font-weight: bold"}]\n' +
    '- "sum column A into A10" → [{"cell":"A10","value":"=SUM(A1:A9)"}]\n\n' +
    "Do exactly what was asked, as directly as possible; don't overcomplicate. " +
    'NEVER write the formatting as cell content (e.g. never use "value":"bg_color=red" or "value":"border=1").\n' +
    "For QUESTIONS about the data, answer in text only, no JSON.",
};

const es: Record<MessageKey, string> = {
  "lang.title": "Idioma",
  "common.close": "Cerrar",

  "tb.new": "Nuevo",
  "tb.newTitle": "Nueva hoja",
  "tb.open": "Abrir",
  "tb.openTitle": "Abrir (Ctrl+O)",
  "tb.save": "Guardar",
  "tb.saveTitle": "Guardar (Ctrl+S)",
  "tb.saveAs": "Guardar como…",
  "tb.saveAsTitle": "Guardar como (Ctrl+Shift+S)",
  "tb.settingsTitle": "Configuración",
  "tb.ai": "✦ IA",
  "tb.aiTitle": "IA local",
  "tb.untitled": "sin título",

  "fmt.font": "Fuente",
  "fmt.fontTitle": "Fuente",
  "fmt.size": "Tamaño",
  "fmt.sizeTitle": "Tamaño de la fuente",

  "fx.gotoTitle": "Ir a la celda",
  "fx.placeholder": "Valor o fórmula (=…)",

  "dlg.openFail": "No se pudo abrir:\n{e}",
  "dlg.saveFail": "No se pudo guardar:\n{e}",
  "dlg.csvWarn":
    "CSV solo guarda la hoja activa — las demás pestañas quedarán fuera.\n¿Continuar?",
  "dlg.exitConfirm": "La hoja tiene cambios sin guardar.\n¿Salir de todos modos?",
  "dlg.exitTitle": "Salir de LocalSheets",

  "set.title": "Configuración",
  "set.theme": "Tema",
  "set.system": "Sistema",
  "set.light": "Claro",
  "set.dark": "Oscuro",
  "set.nature": "Naturaleza",
  "set.darkblue": "Azul oscuro",
  "set.calmgreen": "Verde tranquilo",
  "set.pastelpink": "Rosa pastel",
  "set.punkprincess": "PunkPrincess",

  "ctx.deleteSheet": "Eliminar hoja",
  "ctx.cantDeleteOnly": "No se puede eliminar la única hoja.",
  "ctx.clearBorders": "Limpiar bordes de la selección",

  "ai.title": "IA local",
  "ai.clearTitle": "Limpiar conversación",
  "ai.closeTitle": "Cerrar panel",
  "ai.modelsFolder": "Carpeta de modelos",
  "ai.folderPlaceholder": "Carpeta con modelos .gguf",
  "ai.browseTitle": "Elegir carpeta",
  "ai.scan": "Escanear",
  "ai.model": "Modelo ({n} encontrados)",
  "ai.chooseModel": "— elegir —",
  "ai.gpuLayers": "GPU layers",
  "ai.gpuLayersTitle": "Capas en la GPU (0 = solo CPU)",
  "ai.ctx": "Contexto",
  "ai.ctxTitle": "Tamaño del contexto",
  "ai.stop": "Parar",
  "ai.start": "Iniciar",
  "ai.loading": "Cargando…",
  "ai.pickFolder": "Elige la carpeta donde están tus modelos .gguf.",
  "ai.noGguf": "No se encontró ningún .gguf en esa carpeta.",
  "ai.pickFolderTitle": "Carpeta con modelos .gguf",
  "ai.pickModel": "Elige un modelo primero.",
  "ai.starting": "Iniciando llama-server y cargando el modelo…",
  "ai.emptyLine1": "Inicia un modelo y pide algo, ej.:",
  "ai.emptyLine2":
    "“rellena B con el doble de A”, “suma la columna A en A10”, “crea una columna Total”.",
  "ai.reasoning": "💭 Razonamiento",
  "ai.editsApplied": "✓ {n} celda(s) actualizada(s): {cells}",
  "ai.inputReady": "Pide una edición o pregunta sobre los datos…",
  "ai.inputIdle": "Inicia un modelo",
  "ai.send": "Enviar",

  "ai.err.timeout": "el modelo tardó demasiado en cargar",
  "ai.err.status": "la IA respondió {status}",
  "ai.ctx.empty": "(hoja vacía)",
  "ai.ctx.cropped":
    "\nATENCIÓN: vista parcial — mostrando hasta {shown}, pero los datos llegan hasta {full}. " +
    "Ten en cuenta el intervalo completo al crear fórmulas.",

  "ai.system":
    "Eres el asistente de la hoja de cálculo de LocalSheets. Estado actual (notación A1, columnas arriba, filas a la izquierda):\n\n{context}\n\n" +
    "Para MODIFICAR la hoja, responde en dos partes:\n" +
    "1) una frase corta diciendo lo que vas a hacer;\n" +
    "2) un bloque ```json con un array de ediciones.\n\n" +
    'Cada edición es un objeto con "cell" y al menos uno entre "value" y "style":\n' +
    '- "cell": una celda ("C2") o un intervalo ("A1:D1").\n' +
    '- "value": número, texto o fórmula que empiece por "=" (ej.: "=A2+B2"). Úsalo para CONTENIDO.\n' +
    '- "style": cadena CSS para FORMATEAR (color, borde, negrita, alineación).\n\n' +
    "Propiedades CSS (usa exactamente estos nombres):\n" +
    '- color de fondo: "background-color: #ef4444"\n' +
    '- color del texto: "color: #ffffff"\n' +
    '- negrita: "font-weight: bold"   |   cursiva: "font-style: italic"\n' +
    '- borde: "border: 1px solid #000000"\n' +
    '- alinear: "text-align: center"\n' +
    'Combina varias con ";" — ej.: "background-color: #ef4444; color: white; font-weight: bold".\n' +
    "Colores comunes: rojo #ef4444, verde #22c55e, azul #3b82f6, amarillo #eab308, negro #000000, blanco #ffffff.\n\n" +
    "Ejemplos:\n" +
    '- "pinta A1:D1 de rojo" → [{"cell":"A1:D1","style":"background-color: #ef4444"}]\n' +
    '- "escribe Total en E1 en negrita" → [{"cell":"E1","value":"Total"},{"cell":"E1","style":"font-weight: bold"}]\n' +
    '- "suma la columna A en A10" → [{"cell":"A10","value":"=SUM(A1:A9)"}]\n\n' +
    "Haz exactamente lo que se pidió, de la forma más directa; no compliques. " +
    'NUNCA escribas el formato como contenido de la celda (ej.: nunca uses "value":"bg_color=red" ni "value":"border=1").\n' +
    "Para PREGUNTAS sobre los datos, responde solo en texto, sin JSON.",
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { pt, en, es };

/** Palpite de locale pelo idioma do sistema (só no 1º uso). */
export function detectLocale(): Locale {
  const l = (typeof navigator !== "undefined" ? navigator.language : "pt").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("es")) return "es";
  return "pt";
}

function loadLocale(): Locale {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
  return v === "pt" || v === "en" || v === "es" ? v : detectLocale();
}

let current: Locale = loadLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* localStorage indisponível */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Inscreve o componente nas trocas de locale. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** Tag BCP-47 do locale atual ("pt-BR"/"en-US"/"es-ES"). */
export function localeTag(): string {
  return LOCALE_TAGS[current];
}

/** Traduz uma chave, interpolando placeholders `{param}`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let msg: string = DICTS[current][key] ?? pt[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
}
