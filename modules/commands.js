// Perintah suara/teks: parser intent (murni, bisa diuji di Node) + aksi yang memanggil Vision Controller.
// Setiap aksi yang BERHASIL mengembalikan teks konfirmasi yang akan diucapkan AEGIS;
// bila gagal, teks berisi alasan kegagalan — AEGIS tidak pernah mengonfirmasi sesuatu yang tidak terjadi.
import { describeScene, summarizeHumans, personActivities } from "./humanDetection.js";
import { calculate } from "./calculator.js";
import { t, peopleText } from "./i18n.js";

// ---------------------------------------------------------------- PARSER
const WAKE = /^(?:(?:hei|hey|hai|halo|hi|hello|ok|oke|okay|tolong|please)\s+)*(?:j[ae]rvis|[yhg]arvis|a?e[gj]is|ijis)\b\s*/;

/** Huruf kecil, tanpa tanda baca, tanpa kata panggil ("Jarvis," / "AEGIS,"). */
export function normalize(text) {
  let t = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  t = t.replace(WAKE, "").replace(/^(tolong|coba|please|can you|could you)\s+/, "").trim();
  return t;
}

// Parser menerima Indonesia DAN Inggris sekaligus; bahasa aktif hanya menentukan bahasa balasan.
const ON_WORDS = ["aktifkan", "nyalakan", "hidupkan", "buka", "jalankan", "mulai", "mulailah", "aktif", "nyala", "on", "enable", "activate", "start", "launch", "open"];
const OFF_WORDS = ["matikan", "nonaktifkan", "tutup", "hentikan", "stop", "berhenti", "off", "mati", "nonaktif", "disable", "deactivate", "close", "kill"];

/** @returns {{id:string, arg?:string}|null} */
export function matchIntent(text) {
  const t = normalize(text);
  if (!t) return null;
  const words = new Set(t.split(" "));
  const has = (...p) => p.some((x) => t.includes(x));
  // "turn on …" / "switch … on" / "turn … off" / "shut … down"
  const on = ON_WORDS.some((w) => words.has(w)) || /\b(turn|switch)\b.*\bon\b/.test(t);
  const off = OFF_WORDS.some((w) => words.has(w)) || /\b(turn|switch|shut)\b.*\b(off|down)\b/.test(t);
  // "aktifkan" biasa = ON, "matikan"/"hentikan" = OFF; bila tidak ada kata kerja, anggap ON
  const toggle = (name) => ({ id: `${name}_${off && !on ? "off" : "on"}` });

  if (has("darurat", "emergency")) return { id: "emergency" };
  // IoT rumah (ESP32): lampu/relay, suhu ruangan, status sensor
  if (has("suhu ruangan", "suhu rumah", "suhu dalam", "suhu kamar", "kelembapan ruangan", "room temperature", "indoor temp", "house temperature", "temperature in the room", "temperature inside")) return { id: "iot_climate" };
  if (has("status sensor", "status iot", "sensor rumah", "home sensor", "sensor status", "iot status", "status perangkat", "device status")) return { id: "iot_status" };
  if (/\b(lampu|lamp|lamps|light|lights)\b/.test(t) && (on || off)) return { id: off && !on ? "iot_relay_off" : "iot_relay_on", arg: "lampu" };
  if (has("vision") || has("hentikan semua", "matikan semua", "hentikan sistem", "stop everything", "stop all", "turn off everything", "shut everything down")) {
    return { id: off && !on ? "vision_stop" : "vision_start" };
  }
  if (has("kualitas", "quality") && has("tinggi", "high", "sedang", "medium", "normal", "rendah", "low")) {
    return { id: "quality", arg: has("tinggi", "high") ? "tinggi" : has("rendah", "low") ? "rendah" : "sedang" };
  }
  if (has("riwayat gerak", "laporan gerak", "kejadian gerak", "jumlah gerakan", "berapa kali gerak", "motion report", "motion history", "motion events", "how many motion")) return { id: "motion_report" };
  if (has("gerakan tubuh", "pose", "postur", "skeleton", "kerangka tubuh", "posture")) return toggle("pose");
  if (has("deteksi gerak", "pantau gerak", "motion", "detect movement", "movement detection")) return toggle("motion");
  if (has("hand tracking", "hand track", "tracking tangan", "lacak tangan", "pelacakan tangan", "deteksi tangan", "gestur", "gesture", "track hands", "hand detection")) return toggle("hands");
  if (has("deteksi wajah", "kenali wajah", "pengenalan wajah", "face detection", "detect face", "detect faces", "recognize face", "recognise face")) return toggle("faces");
  if (has("deteksi objek", "kenali objek", "pengenalan objek", "deteksi benda", "kenali benda", "object detection", "detect object", "detect objects", "recognize objects", "recognise objects")) return toggle("objects");
  if (has("mode jaga", "mode siaga", "mode keamanan", "jaga rumah", "alarm", "armed", "disarm", "guard mode", "security mode", "sentry", "watch the house")) {
    return { id: has("disarm") || (off && !on) ? "guard_off" : "guard_on" };
  }
  if (has("hanya orang", "filter orang", "abaikan hewan", "only people", "people only", "only person", "ignore animals")) return { id: "person_only" };
  if (has("kamera", "webcam", "camera") && (on || off)) return { id: off && !on ? "camera_off" : "camera_on" };
  if (has("foto", "snapshot", "ambil gambar", "screenshot", "photo", "picture")) return { id: "snapshot" };
  if (has("apa yang kamu lihat", "kamu lihat apa", "apa yang terlihat", "ada apa di depan", "deskripsikan", "lihat apa", "what do you see", "what can you see", "what are you seeing", "what's in front", "whats in front", "describe")) return { id: "see" };
  if (has("ada orang", "berapa orang", "jumlah orang", "ada manusia", "ada siapa", "berapa wajah", "jumlah wajah", "anyone there", "is anyone", "is there anyone", "how many people", "any person", "is there a person", "how many faces")) return { id: "people" };
  return null;
}

export const INTENT_IDS = [
  "emergency", "vision_start", "vision_stop", "quality", "motion_report",
  "pose_on", "pose_off", "motion_on", "motion_off", "hands_on", "hands_off",
  "faces_on", "faces_off", "objects_on", "objects_off", "guard_on", "guard_off",
  "person_only", "camera_on", "camera_off", "snapshot", "see", "people",
  "iot_relay_on", "iot_relay_off", "iot_climate", "iot_status",
];

// ---------------------------------------------------------------- AKSI
const featName = (f) => t(`feat.${f}`);
const short = (e) => (e ? String(e).split(" — ")[0].slice(0, 140) : "");

/**
 * @param {object} deps
 * @param {ReturnType<import("./visionController.js").createVisionController>} deps.vision
 * @param {object} deps.app  setGuard(on)→{armed}, takeSnapshot(src)→bool, stopAll(), emergencyStop(),
 *                           togglePersonOnly()→bool, motionEvents()→number
 * @param {(ms:number)=>Promise<void>} [deps.delay]
 */
export function createActions({ vision, app, delay = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const sceneState = () => ({
    cameraOn: vision.cameraOn,
    enabled: Object.fromEntries(["objects", "faces", "pose", "motion", "hands"].map((f) => [f, vision.isEnabled(f) && vision.status(f) === "ready"])),
    results: vision.results,
    motion: { active: vision.motionActive },
    brightness: vision.brightness,
  });

  async function enable(f) {
    const n = featName(f);
    if (vision.cameraOn && vision.isEnabled(f) && vision.status(f) === "ready") return { text: t("cmd.already", { n }), already: true };
    const r = await vision.setFeature(f, true, { requireCamera: true });
    if (r.ok) return { text: t("cmd.enabled", { n }) };
    if (r.reason === "camera-off") return { text: t("cmd.camfirst") };
    return { text: t("cmd.enableFail", { n: n.toLowerCase(), e: short(r.error) }) };
  }

  async function disable(f) {
    const n = featName(f);
    if (!vision.isEnabled(f)) return { text: t("cmd.alreadyOff", { n }) };
    await vision.setFeature(f, false);
    return { text: t("cmd.disabled", { n }) };
  }

  async function iotRelay(target, state) {
    const iot = app.iot;
    if (!iot?.hasToken || !iot.online) return { text: t("cmd.iot.none") };
    const r = await iot.command(target, state);
    return { text: r.ok ? t(`cmd.iot.${state}`, { o: t(`iot.o.${target}`) }) : t("cmd.iot.fail") };
  }

  const actions = {
    emergency: async () => { app.emergencyStop(); return { text: t("cmd.emergency") }; },
    vision_stop: async () => {
      if (!vision.cameraOn) return { text: t("cmd.vstop0") };
      app.stopAll();
      return { text: t("cmd.vstop") };
    },
    vision_start: async () => {
      if (vision.cameraOn) return { text: t("cmd.vstart0") };
      const r = await vision.start();
      return { text: r.ok ? t("cmd.vstart") : t("cmd.vstartFail", { e: r.error }) };
    },
    quality: async (arg) => {
      const r = vision.setQuality(arg);
      return { text: r.ok ? t("cmd.q.ok", { q: t(`q.${arg}`).toLowerCase() }) : t("cmd.q.bad") };
    },
    camera_on: async () => {
      if (vision.cameraOn) return { text: t("cmd.cam0") };
      const r = await vision.start();
      return { text: r.ok ? t("cmd.camOk") : t("cmd.camFail", { e: r.error }) };
    },
    camera_off: async () => {
      if (!vision.cameraOn) return { text: t("cmd.camOff0") };
      app.stopAll();
      return { text: t("cmd.camOff") };
    },
    objects_on: async () => {
      const r = await enable("objects");
      if (!vision.cameraOn || vision.status("objects") !== "ready") return r;
      await delay(1300); // beri waktu satu-dua siklus deteksi sebelum melaporkan
      return { text: `${r.already ? "" : r.text + " "}${describeScene(sceneState())}`.trim() };
    },
    see: async () => ({ text: describeScene(sceneState()) }),
    people: async () => {
      if (!vision.cameraOn) return { text: t("cmd.people.nocam") };
      const sources = ["objects", "faces", "pose"].filter((f) => vision.isEnabled(f) && vision.status(f) === "ready");
      if (!sources.length) {
        const loadingNow = ["objects", "faces", "pose"].some((f) => vision.isEnabled(f) && vision.status(f) === "loading");
        return { text: loadingNow ? t("cmd.people.loading") : t("cmd.people.hint") };
      }
      const n = summarizeHumans(vision.results).count;
      if (!n) return { text: t("cmd.people.no") };
      const acts = vision.isEnabled("pose") && vision.status("pose") === "ready" ? personActivities({ poses: vision.results.poses, hands: vision.results.hands?.hands }) : [];
      const detail = acts.length ? " " + acts.map((a, i) => (acts.length > 1 ? t("u.person", { n: i + 1, l: a }) : `${a.charAt(0).toUpperCase()}${a.slice(1)}.`)).join(" ") : "";
      return { text: t("cmd.people.yes", { n: peopleText(n) }) + detail };
    },
    // ---- IoT (butuh app.iot dari script.js) ----
    iot_relay_on: (arg) => iotRelay(arg, "on"),
    iot_relay_off: (arg) => iotRelay(arg, "off"),
    iot_climate: async () => {
      const iot = app.iot;
      const tmp = iot?.sensor("temp"), hum = iot?.sensor("hum");
      if (typeof tmp !== "number") return { text: iot?.online ? t("cmd.iot.noclimate") : t("cmd.iot.none") };
      return { text: t("cmd.iot.climate", { t: Math.round(tmp * 10) / 10, h: typeof hum === "number" ? Math.round(hum) : "—" }) };
    },
    iot_status: async () => {
      const iot = app.iot;
      if (!iot?.hasToken) return { text: t("cmd.iot.none") };
      return { text: t("cmd.iot.status", { d: t(iot.online ? "cmd.iot.dOn" : "cmd.iot.dOff"), s: iot.summary() || t("cmd.iot.nosensor") }) };
    },
    guard_on: async () => {
      app.setGuard(true);
      return { text: vision.cameraOn ? t("cmd.guard.on") : t("cmd.guard.pending") };
    },
    guard_off: async () => { app.setGuard(false); return { text: t("cmd.guard.off") }; },
    person_only: async () => ({ text: app.togglePersonOnly() ? t("cmd.person.on") : t("cmd.person.off") }),
    snapshot: async () => (app.takeSnapshot("manual")
      ? { text: t("cmd.snap.ok") }
      : { text: t("cmd.snap.no") }),
    motion_report: async () => ({ text: t("cmd.motion.rep", { n: app.motionEvents() }) }),
  };
  for (const f of ["hands", "faces", "pose", "motion"]) {
    actions[`${f}_on`] = () => enable(f);
    actions[`${f}_off`] = () => disable(f);
  }
  actions.objects_off = () => disable("objects");
  return actions;
}

/** Cocokkan teks → jalankan aksi. Mengembalikan {text} atau null bila bukan perintah vision. */
export async function runCommand(text, actions) {
  const calc = calculate(text); // kalkulator pintar: "hitung 125 dikali 8"
  if (calc) return calc;
  const m = matchIntent(text);
  if (!m) return null;
  const fn = actions[m.id];
  if (!fn) return { text: t("cmd.unavailable") };
  try { return await fn(m.arg); } catch (err) { return { text: t("cmd.fail", { e: err.message || err }) }; }
}
