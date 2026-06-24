export interface Settings {
  modelsDir: string;
  lastModelPath: string;
  ngl: number;
  ctx: number;
}

export const DEFAULT_MODELS_DIR = "D:\\LocalAIModels\\.lmstudio\\hub\\models";

const DEFAULTS: Settings = {
  modelsDir: DEFAULT_MODELS_DIR,
  lastModelPath: "",
  ngl: 0,
  ctx: 4096,
};

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
