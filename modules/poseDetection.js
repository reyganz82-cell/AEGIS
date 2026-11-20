// Pemahaman gerakan tubuh (MediaPipe PoseLandmarker, 33 titik tubuh) + analisis sederhana.
import { createTask } from "./visionLib.js";
import { t } from "./i18n.js";
import { labelText } from "./draw.js";

const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
const visible = (p) => p && (p.visibility ?? 1) > 0.5;

/** Apakah pergelangan "melambai": terangkat dan bolak-balik horizontal. hist = [{x,y,up}] terbaru di akhir. */
export function isWaving(hist) {
  if (!hist || hist.length < 6 || !hist.slice(-6).every((p) => p.up)) return false;
  let flips = 0, dir = 0, travel = 0;
  for (let i = 1; i < hist.length; i++) {
    const dx = hist[i].x - hist[i - 1].x;
    travel += Math.abs(dx);
    if (Math.abs(dx) < 0.004) continue;
    const d = Math.sign(dx);
    if (dir && d !== dir) flips++;
    dir = d;
  }
  return flips >= 2 && travel > 0.12;
}

/** Berdiri / duduk dari proporsi pinggul-lutut terhadap badan (null bila lutut tak terlihat). */
export function postureOf(lm) {
  const [ls, rs, lh, rh, lk, rk] = [11, 12, 23, 24, 25, 26].map((i) => lm[i]);
  if (![ls, rs, lh, rh].every(visible)) return null;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2, hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
  if (Math.abs(sx - hx) > Math.abs(sy - hy) * 1.2) return "lying";
  const knees = [lk, rk].filter(visible);
  if (!knees.length) return null;
  const torso = Math.max(0.05, hy - sy);
  const thigh = knees.reduce((s, k) => s + Math.abs(k.y - hy), 0) / knees.length;
  return thigh < torso * 0.6 ? "sitting" : "standing";
}

/** Analisis heuristik satu pose. prev = landmark frame sebelumnya, waving = hasil isWaving (opsional). */
export function analyzePose(lm, prev, waving = false) {
  const [ls, rs, lw, rw, lh, rh] = [11, 12, 15, 16, 23, 24].map((i) => lm[i]);
  let armsUp = 0;
  if (visible(lw) && visible(ls) && lw.y < ls.y - 0.05) armsUp++;
  if (visible(rw) && visible(rs) && rw.y < rs.y - 0.05) armsUp++;

  let horizontal = false;
  if ([ls, rs, lh, rh].every(visible)) {
    const dx = (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2;
    const dy = (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2;
    horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
  }

  let movement = 0;
  if (prev) {
    let sum = 0, n = 0;
    for (const i of KEY_POINTS) {
      if (visible(lm[i]) && prev[i]) { sum += Math.hypot(lm[i].x - prev[i].x, lm[i].y - prev[i].y); n++; }
    }
    movement = n ? sum / n : 0;
  }
  const moving = movement > 0.012;
  const posture = horizontal ? "lying" : postureOf(lm);
  const parts = [];
  if (posture) parts.push(t(`pose.${posture}`));
  if (waving) parts.push(t("pose.wave"));
  else if (armsUp === 2) parts.push(t("pose.both"));
  else if (armsUp === 1) parts.push(t("pose.one"));
  parts.push(moving ? t("pose.moving") : t("pose.still"));
  return { armsUp, horizontal, posture, waving, movement, moving, label: parts.join(", ") };
}

const MAX_POSES = 6;
const HIST = 14;
const center = (lm) => {
  const pts = [11, 12, 23, 24].map((i) => lm[i]).filter(visible);
  const src = pts.length ? pts : [lm[0]];
  return { x: src.reduce((s, p) => s + p.x, 0) / src.length, y: src.reduce((s, p) => s + p.y, 0) / src.length };
};

export function createPoseDetector() {
  let task = null;
  let lib = null;
  let tracks = []; // {c, lm, wrists:{l:[],r:[]}} per orang, dicocokkan lewat posisi badan
  return {
    id: "pose",
    async load(vision, quality) {
      lib = vision.lib;
      task = await createTask(lib.PoseLandmarker, vision, "pose", { numPoses: MAX_POSES }, ["GPU", "CPU"]);
      this.applyQuality(quality);
    },
    applyQuality(q) {
      try {
        task?.setOptions({
          minPoseDetectionConfidence: q.score.pose, minPosePresenceConfidence: q.score.pose, minTrackingConfidence: q.score.pose,
        });
      } catch { /* abaikan */ }
    },
    /** @returns {{landmarks, info, wrist}[]} */
    detect(video, ts) {
      const res = task.detectForVideo(video, ts);
      const all = res.landmarks || [];
      const free = new Set(tracks.keys());
      const next = all.map((landmarks) => {
        const c = center(landmarks);
        let best = -1, bd = 0.3;
        for (const i of free) { const d = Math.hypot(tracks[i].c.x - c.x, tracks[i].c.y - c.y); if (d < bd) { bd = d; best = i; } }
        const old = best >= 0 ? tracks[best] : null;
        if (best >= 0) free.delete(best);
        const hist = old ? old.wrists : { l: [], r: [] };
        for (const [k, w, s] of [["l", landmarks[15], landmarks[11]], ["r", landmarks[16], landmarks[12]]]) {
          hist[k].push(visible(w) && visible(s) ? { x: w.x, y: w.y, up: w.y < s.y } : { x: 0, y: 0, up: false });
          if (hist[k].length > HIST) hist[k].shift();
        }
        return { c, lm: landmarks, wrists: hist, prev: old?.lm };
      });
      tracks = next;
      return next.map((n) => ({
        landmarks: n.lm,
        info: analyzePose(n.lm, n.prev, isWaving(n.wrists.l) || isWaving(n.wrists.r)),
      }));
    },    draw(ctx, poses) {
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const conns = lib?.PoseLandmarker?.POSE_CONNECTIONS || [];
      poses.forEach(({ landmarks: lm, info }, n) => {
        ctx.save();
        ctx.strokeStyle = "rgba(255,184,77,0.9)";
        ctx.fillStyle = "#fff3d6";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#ffb84d";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (const { start, end } of conns) {
          if (!visible(lm[start]) || !visible(lm[end])) continue;
          ctx.moveTo(lm[start].x * w, lm[start].y * h);
          ctx.lineTo(lm[end].x * w, lm[end].y * h);
        }
        ctx.stroke();
        for (let i = 11; i < lm.length; i++) {
          if (!visible(lm[i])) continue;
          ctx.beginPath();
          ctx.arc(lm[i].x * w, lm[i].y * h, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        // label orang + aktivitas utama di atas kepala (teks dibalik karena canvas di-mirror CSS)
        const head = lm[0];
        if (visible(head)) {
          const txt = `${t("u.personShort", { n: n + 1 })} · ${info.label.split(", ")[0]}`;
          ctx.font = "13px monospace";
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffb84d";
          labelText(ctx, txt, head.x * w + ctx.measureText(txt).width / 2, Math.max(14, head.y * h - 36));
        }
        ctx.restore();
      });
    },
    close() { task?.close(); task = null; tracks = []; },
  };
}
