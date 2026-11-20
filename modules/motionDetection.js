// Deteksi gerakan lokal dengan frame differencing (tanpa model AI, tanpa internet).
import { CONFIG } from "./config.js";

/** Fungsi murni (bisa diuji di Node): bandingkan dua frame grayscale. */
export function diffFrames(prev, curr, w, h, pixelDelta, zonesX, zonesY) {
  const zoneCount = new Float32Array(zonesX * zonesY);
  let changed = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const zy = Math.min(zonesY - 1, ((y * zonesY) / h) | 0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(curr[i] - prev[i]) > pixelDelta) {
        changed++;
        zoneCount[zy * zonesX + Math.min(zonesX - 1, ((x * zonesX) / w) | 0)]++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const box = changed ? { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h } : null;
  return { ratio: changed / (w * h), box, zoneCount };
}

/** Ambang rasio piksel berubah dari sensitivitas 1–100 (makin tinggi = makin peka). */
export const minRatioFor = (sens) => 0.004 + 0.06 * (1 - sens / 100);

export function createMotionDetector(cfg = CONFIG.motion) {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  let g = null;
  if (canvas) {
    canvas.width = cfg.w; canvas.height = cfg.h;
    g = canvas.getContext("2d", { willReadFrequently: true });
  }
  const zones = new Float32Array(cfg.zonesX * cfg.zonesY);
  const st = { prev: null, level: 0, streak: 0, active: false, lastMotionAt: 0, box: null };

  return {
    id: "motion",
    sensitivity: 60,
    get active() { return st.active; },

    /** Reset analisis. Mengembalikan true bila ada kejadian gerak yang sedang berjalan. */
    reset() {
      const was = st.active;
      Object.assign(st, { prev: null, level: 0, streak: 0, active: false });
      zones.fill(0);
      return was;
    },

    /** @returns {{ready, level, ratio, moving, box, zones, active, event}} event: "start" | "end" | null */
    process(video, now = Date.now()) {
      g.drawImage(video, 0, 0, cfg.w, cfg.h);
      const px = g.getImageData(0, 0, cfg.w, cfg.h).data;
      const gray = new Uint8Array(cfg.w * cfg.h);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      if (!st.prev) { st.prev = gray; return { ready: false, level: 0, ratio: 0, moving: false, box: null, zones, active: false, event: null }; }

      const { ratio, box, zoneCount } = diffFrames(st.prev, gray, cfg.w, cfg.h, cfg.pixelDelta, cfg.zonesX, cfg.zonesY);
      st.prev = gray;
      const minRatio = minRatioFor(this.sensitivity);
      const moving = ratio >= minRatio;
      const zonePx = (cfg.w * cfg.h) / zones.length;
      for (let i = 0; i < zones.length; i++) zones[i] += (Math.min(1, zoneCount[i] / (zonePx * 0.15)) - zones[i]) * 0.4;
      st.level += (Math.min(1, ratio / (minRatio * 4)) - st.level) * 0.35;

      let event = null;
      if (moving) {
        st.streak++;
        st.lastMotionAt = now;
        st.box = box;
        if (!st.active && st.streak >= cfg.startFrames) { st.active = true; event = "start"; }
      } else {
        st.streak = 0;
        if (st.active && now - st.lastMotionAt > cfg.endMs) { st.active = false; event = "end"; }
      }
      return { ready: true, level: st.level, ratio, moving, box: st.box, zones, active: st.active, event };
    },

    draw(ctx, r, { boxes = true, showZones = false, armed = false } = {}) {
      if (!r?.ready) return;
      const W = ctx.canvas.width, H = ctx.canvas.height;
      if (showZones) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,229,255,0.25)";
        for (let zy = 0; zy < cfg.zonesY; zy++) for (let zx = 0; zx < cfg.zonesX; zx++) {
          const a = r.zones[zy * cfg.zonesX + zx];
          const rx = (zx * W) / cfg.zonesX, ry = (zy * H) / cfg.zonesY;
          if (a > 0.05) {
            ctx.fillStyle = `rgba(255,${Math.round(184 - a * 100)},77,${a * 0.45})`;
            ctx.fillRect(rx, ry, W / cfg.zonesX, H / cfg.zonesY);
          }
          ctx.strokeRect(rx, ry, W / cfg.zonesX, H / cfg.zonesY);
        }
        ctx.restore();
      }
      if (boxes && r.moving && r.box) {
        ctx.save();
        ctx.strokeStyle = armed ? "#ff4d6d" : "#ffb84d";
        ctx.lineWidth = 2;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 8;
        ctx.strokeRect(r.box.x * W, r.box.y * H, r.box.w * W, r.box.h * H);
        ctx.restore();
      }
    },
  };
}
