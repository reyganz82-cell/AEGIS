// Hand tracking + pengenalan gestur (MediaPipe GestureRecognizer).
import { createTask } from "./visionLib.js";
import { CONFIG } from "./config.js";
import { labelText } from "./draw.js";

export const GESTURE_LABELS = {
  Thumb_Up: "THUMBS UP 👍", Thumb_Down: "THUMBS DOWN 👎", Open_Palm: "OPEN PALM ✋", Closed_Fist: "CLOSED FIST ✊",
  Pointing_Up: "POINTING UP ☝", Victory: "VICTORY ✌", ILoveYou: "I LOVE YOU 🤟", None: "HAND DETECTED",
};

export const HAND_COLORS = ["#00e5ff", "#3dffb5", "#ffb84d", "#ff7ad9", "#a98bff", "#ffe066"];
const MAX_HANDS = 6;
const TRAIL_LEN = 24;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Cadangan heuristik dari landmark bila klasifikasi model ragu. */
export function isThumbUpByLandmarks(lm) {
  const dist = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const thumbExtended = dist(4, 0) > dist(3, 0) && dist(3, 0) > dist(2, 0);
  const thumbHighest = [5, 6, 8, 9, 12, 13, 16, 17, 20].every((i) => lm[4].y < lm[i].y - 0.04);
  const fingersFolded = [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, pip]) => dist(tip, 0) < dist(pip, 0) * 1.05);
  return thumbExtended && thumbHighest && fingersFolded;
}

/** Memicu sapaan bila jempol bertahan N frame, sudah dilepas sebelumnya, dan cooldown lewat. */
export class ThumbUpTrigger {
  constructor({ holdFrames, cooldownMs } = CONFIG.gesture) {
    Object.assign(this, { holdFrames, cooldownMs, frames: 0, released: true, last: 0 });
  }
  update(thumbUp, now = Date.now()) {
    if (thumbUp) this.frames++;
    else { this.frames = 0; this.released = true; }
    if (this.frames >= this.holdFrames && this.released && now - this.last > this.cooldownMs) {
      this.last = now;
      this.released = false;
      return true;
    }
    return false;
  }
  remaining(now = Date.now()) {
    return this.last ? Math.max(0, this.cooldownMs - (now - this.last)) : 0;
  }
  reset() { this.frames = 0; }
}

const palmCenter = (lm) => {
  const ids = [0, 5, 9, 13, 17];
  return { x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length };
};

/**
 * Beri ID stabil ke tiap tangan antar-frame (pencocokan terdekat) dan simpan jejak gerak telapak.
 * tracks: array {id, c, trail, miss} — dimodifikasi di tempat. Mengembalikan id untuk tiap center.
 */
export function assignTracks(tracks, centers, nextId, maxDist = 0.25) {
  const ids = new Array(centers.length).fill(-1);
  const used = new Set();
  const pairs = [];
  tracks.forEach((t, ti) => centers.forEach((c, ci) => pairs.push([Math.hypot(t.c.x - c.x, t.c.y - c.y), ti, ci])));
  pairs.sort((a, b) => a[0] - b[0]);
  const takenT = new Set();
  for (const [d, ti, ci] of pairs) {
    if (d > maxDist || takenT.has(ti) || ids[ci] !== -1) continue;
    takenT.add(ti);
    ids[ci] = tracks[ti].id;
    tracks[ti].c = centers[ci];
    tracks[ti].trail.push(centers[ci]);
    if (tracks[ti].trail.length > TRAIL_LEN) tracks[ti].trail.shift();
    tracks[ti].miss = 0;
    used.add(ci);
  }
  centers.forEach((c, ci) => {
    if (ids[ci] === -1) { ids[ci] = nextId.n; tracks.push({ id: nextId.n++, c, trail: [c], miss: 0 }); }
  });
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (!takenT.has(i) && !ids.includes(tracks[i].id) && ++tracks[i].miss > 8) tracks.splice(i, 1);
  }
  return ids;
}

export function createHandDetector() {
  let task = null;
  let tracks = [];
  const nextId = { n: 0 };
  return {
    id: "hands",
    async load(vision, quality) {
      task = await createTask(vision.lib.GestureRecognizer, vision, "hands", { numHands: MAX_HANDS }, ["GPU", "CPU"]);
      this.applyQuality(quality);
    },
    applyQuality(q) {
      try {
        task?.setOptions({
          minHandDetectionConfidence: q.score.hands,
          minHandPresenceConfidence: q.score.hands,
          minTrackingConfidence: q.score.hands,
        });
      } catch { /* opsi tidak didukung: abaikan */ }
    },
    detect(video, ts) {
      const r = task.recognizeForVideo(video, ts);
      const lms = r.landmarks || [];
      const ids = assignTracks(tracks, lms.map(palmCenter), nextId);
      const hands = lms.map((landmarks, i) => {
        const top = r.gestures?.[i]?.[0];
        const modelThumb = top?.categoryName === "Thumb_Up" && top.score >= CONFIG.gesture.minScore;
        const thumb = modelThumb || isThumbUpByLandmarks(landmarks);
        return {
          id: ids[i],
          landmarks,
          center: palmCenter(landmarks),
          name: thumb ? "Thumb_Up" : top?.categoryName || "None",
          score: thumb && !modelThumb ? Math.max(top?.score || 0, 0.7) : top?.score || 0,
          thumbUp: thumb,
        };
      });
      const best = hands.reduce((b, h) => (h.score > b.score ? h : b), { name: null, score: 0 });
      return { hands, best, thumbUp: hands.some((h) => h.thumbUp), trails: tracks.map((t) => ({ id: t.id, trail: t.trail.slice() })) };
    },
    draw(ctx, result) {
      const w = ctx.canvas.width, h = ctx.canvas.height;
      // jejak gerak telapak (memudar)
      for (const { id, trail } of result.trails || []) {
        if (trail.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = HAND_COLORS[id % HAND_COLORS.length];
        ctx.lineCap = "round";
        for (let i = 1; i < trail.length; i++) {
          ctx.globalAlpha = (i / trail.length) * 0.7;
          ctx.lineWidth = 1 + (i / trail.length) * 4;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x * w, trail[i - 1].y * h);
          ctx.lineTo(trail[i].x * w, trail[i].y * h);
          ctx.stroke();
        }
        ctx.restore();
      }
      result.hands.forEach(({ id, landmarks: lm, name }) => {
        const color = HAND_COLORS[id % HAND_COLORS.length];
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(lm[a].x * w, lm[a].y * h);
          ctx.lineTo(lm[b].x * w, lm[b].y * h);
        }
        ctx.stroke();
        ctx.fillStyle = "#e9fcff";
        lm.forEach((p, i) => {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, i === 4 || i === 8 ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
        });
        // label di atas pergelangan (canvas di-mirror CSS → teks dibalik agar terbaca)
        const lbl = `H${(id % 99) + 1}${name && name !== "None" ? " " + (GESTURE_LABELS[name] || name).split(" ")[0] : ""}`;
        ctx.font = "13px monospace";
        ctx.fillStyle = color;
        ctx.shadowBlur = 0;
        labelText(ctx, lbl, lm[0].x * w + ctx.measureText(lbl).width / 2, lm[0].y * h + 18);
        ctx.restore();
      });
    },
    close() { task?.close(); task = null; tracks = []; },
  };
}