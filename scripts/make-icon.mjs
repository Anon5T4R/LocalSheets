import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src-tauri", "icons", "source-icon.svg");
const out = join(root, "src-tauri", "icons", "icon-1024.png");

await sharp(src, { density: 384 }).resize(1024, 1024).png().toFile(out);
console.log("PNG gerado:", out);
