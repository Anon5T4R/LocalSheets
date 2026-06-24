import ReactDOM from "react-dom/client";
import App from "./App";

// No StrictMode: jspreadsheet is a vanilla (non-React) widget and its double
// mount/unmount under StrictMode duplicates the grid + toolbar.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
