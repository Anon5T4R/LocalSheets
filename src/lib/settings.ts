export type Theme = "system" | "light" | "dark";

export interface Settings {
  modelsDir: string;
  lastModelPath: string;
  ngl: number;
  ctx: number;
  theme: Theme;
}

export const DEFAULT_MODELS_DIR = "D:\\LocalAIModels\\.lmstudio\\hub\\models";

const DEFAULTS: Settings = {
  modelsDir: DEFAULT_MODELS_DIR,
  lastModelPath: "",
  ngl: 0,
  ctx: 4096,
  theme: "system",
};

/** Resolve "system" to the OS preference and apply it to <html data-theme>. */
export function applyTheme(theme: Theme): void {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

const KEY = "localsheets.settings";

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
