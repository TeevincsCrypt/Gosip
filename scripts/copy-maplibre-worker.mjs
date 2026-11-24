// Copies MapLibre's self-contained worker into public/ so the browser can load
// it from a stable URL (bundlers cannot always resolve its import.meta.url).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
if (existsSync(src)) {
  mkdirSync("public/vendor", { recursive: true });
  copyFileSync(src, "public/vendor/maplibre-gl-worker.mjs");
}
