// Mengunduh model MediaPipe ke folder models/ agar AEGIS bisa berjalan 100% lokal/offline.
// Jalankan: npm run setup
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const BASE = "https://storage.googleapis.com/mediapipe-models";
const MODELS = {
  "gesture_recognizer.task": `${BASE}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  "efficientdet_lite0.tflite": `${BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
  "blaze_face_short_range.tflite": `${BASE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
  "pose_landmarker_lite.task": `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};

await mkdir(root, { recursive: true });
let failed = 0;
for (const [name, url] of Object.entries(MODELS)) {
  const file = join(root, name);
  try { if ((await stat(file)).size > 10000) { console.log(`✓ ${name} (sudah ada)`); continue; } } catch {}
  process.stdout.write(`↓ ${name} … `);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log("selesai");
  } catch (err) {
    failed++;
    console.log(`GAGAL (${err.message})`);
  }
}
if (failed) { console.error(`\n${failed} model gagal diunduh. Cek koneksi internet lalu jalankan ulang: npm run setup`); process.exit(1); }
console.log("\nSemua model siap di folder models/.");
