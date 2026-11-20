// Deteksi manusia: menggabungkan sinyal objek ("person"), wajah, dan pose menjadi satu jawaban,
// serta menyusun deskripsi adegan untuk perintah "apa yang kamu lihat?".
import { objName } from "./objectDetection.js";
import { t, peopleText } from "./i18n.js";

/**
 * @param {{objects?:Array, faces?:Array, poses?:Array}} r hasil terbaru vision
 * @returns {{count:number, sources:string[]}}
 */
export function summarizeHumans({ objects = [], faces = [], poses = [] } = {}) {
  const fromObjects = objects.filter((o) => o.name === "person").length;
  const sources = [];
  if (fromObjects) sources.push("objek");
  if (faces.length) sources.push("wajah");
  if (poses.length) sources.push("pose");
  return { count: Math.max(fromObjects, faces.length, poses.length), sources };
}

/** Aktivitas tiap orang (dari pose) + gestur tangan yang berada di dekat pergelangannya. Mengembalikan array label. */
export function personActivities({ poses = [], hands = [] } = {}) {
  return poses.map((p) => {
    const wrists = [p.landmarks[15], p.landmarks[16]].filter((w) => w && (w.visibility ?? 1) > 0.3);
    const gs = [...new Set(hands
      .filter((h) => h.name && h.name !== "None" && wrists.some((w) => Math.hypot(w.x - h.landmarks[0].x, w.y - h.landmarks[0].y) < 0.15))
      .map((h) => t(`g.${h.name}`)))];
    return gs.length ? `${p.info.label}, ${t("pose.gesture", { g: gs.join(" + ") })}` : p.info.label;
  });
}

/**
 * @param {object} s
 * @param {boolean} s.cameraOn
 * @param {object} s.enabled  {objects, faces, pose, motion}
 * @param {object} s.results  hasil terbaru
 * @param {{active:boolean}} s.motion
 * @param {number} s.brightness 0–255
 */
export function describeScene({ cameraOn, enabled = {}, results = {}, motion = {}, brightness = 128 }) {
  if (!cameraOn) return t("scene.nocam");
  const { objects = [], faces = [], poses = [], hands: handRes } = results;
  const out = [];

  if (enabled.objects) {
    const counts = {};
    objects.forEach((o) => { counts[o.name] = (counts[o.name] || 0) + 1; });
    const parts = Object.entries(counts).map(([n, c]) => `${c} ${objName(n, c)}`);
    out.push(parts.length ? t("scene.objs", { l: parts.join(", ") }) : t("scene.noobj"));
  } else {
    const h = summarizeHumans(results);
    out.push(h.count ? t("scene.people", { n: peopleText(h.count) }) : t("scene.nopeople"));
  }
  if (enabled.faces && faces.length) out.push(t("scene.faces", { n: faces.length }));
  if (enabled.pose && poses.length) {
    const acts = personActivities({ poses, hands: handRes?.hands || [] });
    out.push(t("scene.pose", { l: acts.map((a, i) => (acts.length > 1 ? `${t("u.person", { n: i + 1, l: a }).replace(/\.$/, "")}` : a)).join("; ") }));
  }
  if (enabled.hands && handRes?.hands?.length) out.push(t("scene.hands", { n: handRes.hands.length }));
  if (enabled.motion) out.push(motion.active ? t("scene.motion1") : t("scene.motion0"));
  if (brightness < 40) out.push(t("scene.dark"));
  return out.join(" ");
}
