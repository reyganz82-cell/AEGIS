// Konfigurasi terpusat AEGIS Vision System.
// ROOT dihitung dari lokasi file ini, jadi path benar di Live Server maupun http-server.
export const ROOT = new URL("../", import.meta.url).href;

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const GCS = "https://storage.googleapis.com/mediapipe-models";

/** Sumber library MediaPipe: lokal (npm install) lebih dulu, CDN sebagai cadangan. */
export const MP_SOURCES = [
  {
    name: "lokal",
    lib: `${ROOT}node_modules/@mediapipe/tasks-vision/vision_bundle.mjs`,
    wasm: `${ROOT}node_modules/@mediapipe/tasks-vision/wasm`,
  },
  { name: "CDN", lib: `${CDN}/vision_bundle.mjs`, wasm: `${CDN}/wasm` },
];

/** Model: file lokal di models/ (npm run setup) lebih dulu, URL Google sebagai cadangan. */
export const MODELS = {
  hands: { file: "gesture_recognizer.task", cdn: `${GCS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task` },
  objects: { file: "efficientdet_lite0.tflite", cdn: `${GCS}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite` },
  faces: { file: "blaze_face_short_range.tflite", cdn: `${GCS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite` },
  pose: { file: "pose_landmarker_lite.task", cdn: `${GCS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` },
};

export const CONFIG = {
  lang: "id-ID",
  speech: { rate: 1.0, pitchMale: 0.95, pitchFallback: 0.7 },
  gesture: { minScore: 0.6, holdFrames: 6, cooldownMs: 10000 },
  motion: {
    w: 80, h: 60,          // resolusi analisis (kecil = cepat & tahan noise)
    pixelDelta: 28,        // selisih kecerahan minimum agar piksel dianggap berubah
    startFrames: 3,        // gerakan harus bertahan N frame sebelum jadi "kejadian"
    endMs: 1500,           // tanpa gerakan selama ini = kejadian selesai
    alarmCooldownMs: 8000, // jeda minimal antar peringatan suara saat mode jaga
    zonesX: 4, zonesY: 3,
  },
  clip: { tailMs: 3000, maxMs: 30000 },
};

/**
 * Preset kualitas deteksi. Makin tinggi = makin akurat tetapi makin berat di CPU/GPU.
 *  - camera : resolusi webcam yang diminta
 *  - every  : model dijalankan tiap N frame video
 *  - score  : ambang keyakinan minimum
 */
export const QUALITY = {
  rendah: { label: "RENDAH", camera: [480, 360], every: { hands: 2, faces: 6, objects: 10, pose: 4 }, score: { objects: 0.55, faces: 0.6, hands: 0.6, pose: 0.6 }, maxObjects: 5 },
  sedang: { label: "SEDANG", camera: [640, 480], every: { hands: 1, faces: 3, objects: 5, pose: 2 }, score: { objects: 0.45, faces: 0.5, hands: 0.5, pose: 0.5 }, maxObjects: 8 },
  tinggi: { label: "TINGGI", camera: [1280, 720], every: { hands: 1, faces: 1, objects: 2, pose: 1 }, score: { objects: 0.35, faces: 0.4, hands: 0.4, pose: 0.4 }, maxObjects: 12 },
};
export const DEFAULT_QUALITY = "sedang";
