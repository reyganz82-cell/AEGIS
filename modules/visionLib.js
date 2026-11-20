// Pemuat library MediaPipe + pembuat task dengan fallback (lokal → CDN, GPU → CPU).
import { ROOT, MP_SOURCES, MODELS } from "./config.js";
import { t } from "./i18n.js";

let cache = null;

/** Memuat library sekali saja. Melempar Error berpesan jelas bila semua sumber gagal. */
export function loadVision() {
  if (cache) return cache;
  cache = (async () => {
    const errors = [];
    for (const src of MP_SOURCES) {
      try {
        // pastikan file wasm benar-benar ada sebelum memilih sumber ini
        const head = await fetch(`${src.wasm}/vision_wasm_internal.wasm`, { method: "HEAD" });
        if (!head.ok) throw new Error(`wasm HTTP ${head.status}`);
        const lib = await import(src.lib);
        const fileset = await lib.FilesetResolver.forVisionTasks(src.wasm);
        return { lib, fileset, source: src.name };
      } catch (e) {
        errors.push(`${src.name}: ${e.message || e}`);
      }
    }
    throw new Error(t("lib.fail", { e: errors.join("; ") }));
  })();
  cache.catch(() => { cache = null; }); // izinkan mencoba lagi setelah gagal
  return cache;
}

/** Membuat task MediaPipe: coba model lokal dulu lalu CDN; coba tiap delegate secara berurutan. */
export async function createTask(Task, vision, key, options = {}, delegates = ["CPU"]) {
  const m = MODELS[key];
  const errors = [];
  // ?cpu=1 di URL memaksa delegate CPU (berguna bila GPU/driver bermasalah)
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("cpu")) delegates = ["CPU"];
  for (const url of [`${ROOT}models/${m.file}`, m.cdn]) {
    for (const delegate of delegates) {
      try {
        return await Task.createFromOptions(vision.fileset, {
          ...options,
          baseOptions: { modelAssetPath: url, delegate },
          runningMode: "VIDEO",
        });
      } catch (e) {
        errors.push(`${url.split("/").pop()} [${delegate}]: ${e.message || e}`);
      }
    }
  }
  throw new Error(t("lib.model", { k: key, e: errors.join(" | ") }));
}
