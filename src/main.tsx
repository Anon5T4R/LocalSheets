import ReactDOM from "react-dom/client";
import App from "./App";
import { useLocale } from "./lib/i18n";

// Remonta a árvore (e reinstancia o jspreadsheet) ao trocar de idioma: cada
// `t()` reavalia no locale novo.
function Root() {
  const locale = useLocale();
  return <App key={locale} />;
}

// No StrictMode: jspreadsheet is a vanilla (non-React) widget and its double
// mount/unmount under StrictMode duplicates the grid + toolbar.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Root />);
