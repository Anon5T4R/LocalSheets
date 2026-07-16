import { LOCALE_LABELS, Locale, setLocale, t, useLocale } from "../lib/i18n";

/** Seletor de idioma (EN/PT/ES) — endônimos, sem tradução dos rótulos. */
export function LocalePicker() {
  const locale = useLocale();
  return (
    <select
      className="lang-select"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      title={t("lang.title")}
      aria-label={t("lang.title")}
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
