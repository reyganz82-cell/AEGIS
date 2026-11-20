// Pengendali Vision System: memiliki kamera, loop deteksi, status tiap modul, dan preset kualitas.
// Tidak menyentuh DOM selain <video> dan <canvas> overlay yang diberikan; semua pelaporan lewat hooks.
//
// hooks: onCamera(state, info) · onStatus(feature, status) · onFeature(feature, enabled) · onError(feature, message)
//        onMotionEvent("start"|"end", info) · onThumbsUp() · onFrame({results, fps, brightness}) · onQuality(name)
import { QUALITY, DEFAULT_QUALITY } from "./config.js";
import { loadVision } from "./visionLib.js";
import { createHandDetector, ThumbUpTrigger } from "./handDetection.js";
import { createFaceDetector } from "./faceDetection.js";
import { createObjectDetector } from "./objectDetection.js";
import { createPoseDetector } from "./poseDetection.js";
import { createMotionDetector } from "./motionDetection.js";
import { t } from "./i18n.js";

export const FEATURES = ["hands", "faces", "objects", "pose", "motion"];
const MAX_ERRORS = 30; // error beruntun sebelum sebuah modul dimatikan otomatis

export function describeCameraError(err) {
  const map = {
    NotAllowedError: ["DENIED", t("cam.denied")],
    SecurityError: ["DENIED", t("cam.security")],
    NotFoundError: ["NOT FOUND", t("cam.notfound")],
    OverconstrainedError: ["NOT FOUND", t("cam.overconstrained")],
    NotReadableError: ["IN USE", t("cam.inuse")],
  };
  const [code, error] = map[err?.name] || ["ERROR", t("cam.generic", { e: err?.message || err })];
  return { code, error };
}

export function createVisionController({ video, overlay, hooks = {} }) {
  const emit = (name, ...args) => { try { hooks[name]?.(...args); } catch (e) { console.error(`[hook ${name}]`, e); } };

  const detectors = {
    hands: createHandDetector(),
    faces: createFaceDetector(),
    objects: createObjectDetector(),
    pose: createPoseDetector(),
  };
  const motion = createMotionDetector();
  const feat = Object.fromEntries(FEATURES.map((f) => [f, { enabled: false, status: "off" }])); // status: off|loading|ready|error
  const loaded = {};
  const loading = {};
  const errorStreak = {};
  const empty = () => ({
    hands: { hands: [], best: { name: null, score: 0 }, thumbUp: false },
    faces: [], objects: [], poses: [], motion: null,
  });
  let results = empty();
  const thumb = new ThumbUpTrigger();
  let quality = DEFAULT_QUALITY;
  let overlayOpts = { boxes: true, zones: false, armed: false };
  const s = { on: false, starting: false, stream: null, raf: 0, lastTime: -1, frame: 0, fps: 0, fpsN: 0, fpsT: 0, brightness: 128 };

  const setStatus = (f, status) => { feat[f].status = status; emit("onStatus", f, status); };

  // ---------- pemuatan model ----------
  function ensureLoaded(f) {
    if (f === "motion" || loaded[f]) return Promise.resolve();
    loading[f] ||= (async () => {
      setStatus(f, "loading");
      const vision = await loadVision();
      await detectors[f].load(vision, QUALITY[quality]);
      loaded[f] = true;
      setStatus(f, feat[f].enabled ? "ready" : "off");
    })().catch((err) => {
      delete loading[f];
      feat[f].enabled = false;
      setStatus(f, "error");
      emit("onFeature", f, false);
      emit("onError", f, err.message || String(err));
      throw err;
    }).finally(() => { delete loading[f]; });
    return loading[f];
  }

  /**
   * Aktif/nonaktifkan satu modul.
   * requireCamera=true (perintah suara): gagal bila kamera mati, tanpa mengubah preferensi.
   * @returns {Promise<{ok:boolean, reason?:string, error?:string}>}
   */
  async function setFeature(f, on, { requireCamera = false } = {}) {
    if (!feat[f]) return { ok: false, reason: "unknown" };
    if (!on) {
      feat[f].enabled = false;
      if (f === "motion") { if (motion.reset()) emit("onMotionEvent", "end", {}); }
      else clearResult(f);
      setStatus(f, "off");
      emit("onFeature", f, false);
      return { ok: true };
    }
    if (requireCamera && !s.on) return { ok: false, reason: "camera-off" };
    feat[f].enabled = true;
    if (f === "motion") {
      motion.reset();
      setStatus(f, "ready");
    } else if (s.on) {
      setStatus(f, loaded[f] ? "ready" : "loading");
      try { await ensureLoaded(f); } catch (e) { return { ok: false, reason: "load-failed", error: e.message }; }
      if (!feat[f].enabled) return { ok: false, reason: "disabled" };
    }
    emit("onFeature", f, true);
    return { ok: true };
  }

  function clearResult(f) {
    const e = empty();
    if (f === "hands") { results.hands = e.hands; thumb.reset(); }
    else if (f === "faces") results.faces = [];
    else if (f === "objects") results.objects = [];
    else if (f === "pose") results.poses = [];
  }

  // ---------- kamera ----------
  async function start() {
    if (s.on) return { ok: true };
    if (s.starting) return { ok: false, code: "BUSY", error: t("cam.busy") };
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = window.isSecureContext
        ? t("cam.nosupport")
        : t("cam.https");
      emit("onCamera", "error", { code: "UNAVAILABLE", error });
      return { ok: false, code: "UNAVAILABLE", error };
    }
    s.starting = true;
    emit("onCamera", "requesting", {});
    try {
      const [w, h] = QUALITY[quality].camera;
      s.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: w }, height: { ideal: h }, facingMode: "user" }, audio: false,
      });
    } catch (err) {
      s.starting = false;
      const info = describeCameraError(err);
      emit("onCamera", "error", info);
      return { ok: false, ...info };
    }
    video.srcObject = s.stream;
    await video.play().catch(() => {});
    s.on = true;
    s.starting = false;
    s.lastTime = -1;
    motion.reset();
    s.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (!s.on) return;
      stop();
      emit("onError", "camera", t("cam.lost"));
    });
    emit("onCamera", "on", {});
    cancelAnimationFrame(s.raf);
    loop();
    // muat model modul yang aktif di latar belakang; kegagalan satu modul tidak menghentikan yang lain
    for (const f of FEATURES) {
      if (!feat[f].enabled || f === "motion") continue;
      setStatus(f, loaded[f] ? "ready" : "loading");
      ensureLoaded(f).catch(() => {});
    }
    if (feat.motion.enabled) setStatus("motion", "ready");
    return { ok: true };
  }

  function stop() {
    const wasOn = s.on;
    s.on = false;
    cancelAnimationFrame(s.raf);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    video.srcObject = null;
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    if (motion.reset()) emit("onMotionEvent", "end", {});
    results = empty();
    thumb.reset();
    for (const f of FEATURES) if (feat[f].enabled) setStatus(f, "off"); // kembali READY saat kamera dinyalakan lagi
    if (wasOn) { emit("onCamera", "off", {}); emit("onFrame", { results, fps: 0, brightness: s.brightness }); }
  }

  // ---------- loop deteksi ----------
  const lightCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
  function sampleBrightness() {
    lightCtx.canvas.width = 16; lightCtx.canvas.height = 12;
    lightCtx.drawImage(video, 0, 0, 16, 12);
    const d = lightCtx.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    s.brightness = sum / (d.length / 4);
  }

  function runDetector(f, every, key, apply) {
    const st = feat[f];
    if (!st.enabled || st.status !== "ready") return;
    if (s.frame % every === 0) {
      try {
        apply(detectors[f].detect(video, performance.now()));
        errorStreak[f] = 0;
      } catch (err) {
        if ((errorStreak[f] = (errorStreak[f] || 0) + 1) >= MAX_ERRORS) {
          console.error(`[${f}]`, err);
          errorStreak[f] = 0;
          feat[f].enabled = false;
          setStatus(f, "error");
          emit("onFeature", f, false);
          emit("onError", f, t("vc.repeat", { f, e: err.message || err }));
        }
        return;
      }
    }
    detectors[f].draw(overlay.getContext("2d"), results[key]);
  }

  function loop() {
    if (!s.on) return;
    s.raf = requestAnimationFrame(loop);
    const now = performance.now();
    s.fpsN++;
    if (now - s.fpsT >= 1000) { s.fps = s.fpsN; s.fpsN = 0; s.fpsT = now; }
    if (video.readyState < 2 || video.currentTime === s.lastTime) return;
    s.lastTime = video.currentTime;
    s.frame++;
    if (overlay.width !== video.videoWidth) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const every = QUALITY[quality].every;

    if (feat.motion.enabled) {
      try {
        const r = motion.process(video);
        results.motion = r;
        if (r.event) emit("onMotionEvent", r.event, { box: r.box });
        motion.draw(ctx, r, { boxes: overlayOpts.boxes, showZones: overlayOpts.zones, armed: overlayOpts.armed });
      } catch (err) { console.warn("Motion error:", err); }
    }
    runDetector("hands", every.hands, "hands", (r) => {
      results.hands = r;
      if (thumb.update(r.thumbUp)) emit("onThumbsUp");
    });
    runDetector("faces", every.faces, "faces", (r) => { results.faces = r; });
    runDetector("objects", every.objects, "objects", (r) => { results.objects = r; });
    runDetector("pose", every.pose, "poses", (r) => { results.poses = r; });
    if (s.frame % 15 === 0) { try { sampleBrightness(); } catch { /* abaikan */ } }
    emit("onFrame", { results, fps: s.fps, brightness: s.brightness });
  }

  // ---------- kualitas ----------
  function setQuality(name) {
    if (!QUALITY[name]) return { ok: false };
    quality = name;
    const q = QUALITY[name];
    for (const f of Object.keys(detectors)) if (loaded[f]) detectors[f].applyQuality(q);
    const track = s.stream?.getVideoTracks()[0];
    track?.applyConstraints({ width: { ideal: q.camera[0] }, height: { ideal: q.camera[1] } }).catch(() => {});
    emit("onQuality", name);
    return { ok: true, label: q.label };
  }

  return {
    start, stop, setFeature, setQuality,
    /** Hentikan segalanya: kamera, loop, dan semua pemrosesan. Preferensi modul tetap tersimpan. */
    emergencyStop() { stop(); },
    setOverlay(o) { overlayOpts = { ...overlayOpts, ...o }; },
    setSensitivity(n) { motion.sensitivity = Math.min(100, Math.max(1, Number(n) || 60)); },
    thumbRemaining: () => thumb.remaining(),
    get cameraOn() { return s.on; },
    get stream() { return s.stream; },
    get quality() { return quality; },
    get results() { return results; },
    get brightness() { return s.brightness; },
    get fps() { return s.fps; },
    get motionActive() { return motion.active; },
    isEnabled: (f) => !!feat[f]?.enabled,
    status: (f) => feat[f]?.status,
    getState() {
      return {
        cameraOn: s.on, quality, fps: s.fps, brightness: s.brightness,
        features: Object.fromEntries(FEATURES.map((f) => [f, { ...feat[f] }])),
      };
    },
  };
}
