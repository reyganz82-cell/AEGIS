// Uji logika AEGIS tanpa browser: parser perintah suara, integrasi aksi ↔ Vision Controller (tiruan),
// deteksi gerakan, ringkasan manusia, analisis pose, dan pemilihan suara.
// Jalankan: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { matchIntent, normalize, createActions, runCommand, INTENT_IDS } from "../modules/commands.js";
import { diffFrames, minRatioFor } from "../modules/motionDetection.js";
import { summarizeHumans, describeScene } from "../modules/humanDetection.js";
import { analyzePose } from "../modules/poseDetection.js";
import { rankVoice, isMaleVoice } from "../modules/voiceAssistant.js";
import { ThumbUpTrigger } from "../modules/handDetection.js";
import { QUALITY } from "../modules/config.js";
import { calculate } from "../modules/calculator.js";
import { setLang, getLang, t } from "../modules/i18n.js";

/** Jalankan fungsi dengan bahasa tertentu lalu kembalikan ke Indonesia (default test). */
async function inLang(lang, fn) {
  setLang(lang);
  try { return await fn(); } finally { setLang("id"); }
}

// ------------------------------------------------------------------ dwibahasa
test("i18n: default Indonesia di Node, t() dengan parameter, fallback ke id", async () => {
  assert.equal(getLang(), "id");
  assert.equal(t("cmd.enabled", { n: "X" }), "X aktif.");
  await inLang("en", () => {
    assert.equal(t("cmd.enabled", { n: "X" }), "X is now active.");
    assert.equal(t("kunci.tidak.ada"), "kunci.tidak.ada");
  });
  assert.equal(getLang(), "id");
});
test("i18n: kamus id dan en punya kunci yang sama (tidak ada terjemahan terlewat)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../modules/i18n.js", import.meta.url), "utf8");
  const keys = (block) => new Set([...block.matchAll(/"([\w.+\-*/^]+)":/g)].map((m) => m[1]));
  const [idBlock, enBlock] = src.split(/\n {2}en: \{\n/).slice(-2).length === 2 ? src.split(/\n {2}en: \{\n/) : [src, ""]; // "en: {" + newline = kamus (bukan LANGS)
  const idKeys = keys(idBlock), enKeys = keys(enBlock);
  assert.deepEqual([...idKeys].filter((k) => !enKeys.has(k)), [], "kunci id tanpa en");
  assert.deepEqual([...enKeys].filter((k) => !idKeys.has(k)), [], "kunci en tanpa id");
});
test("calculate (EN): contoh 125 times 8, angka kata, persen, akar, format 1,000.5", async () => {
  await inLang("en", () => {
    const r = calculate("Jarvis, calculate 125 times 8");
    assert.equal(r.calc.value, 1000);
    assert.equal(r.speech, "125 times 8 equals 1000, Sir.");
    assert.equal(calculate("what is 7 minus 10").calc.value, -3);
    assert.equal(calculate("calculate one hundred and twenty five divided by five").calc.value, 25);
    assert.equal(calculate("calculate twenty five thousand plus 500").calc.value, 25500);
    assert.equal(calculate("calculate 15 percent of 200").calc.value, 30);
    assert.equal(calculate("compute square root of 144").calc.value, 12);
    assert.equal(calculate("calculate 5 squared plus 1").calc.value, 26);
    assert.equal(calculate("calculate 2 to the power of 10").calc.value, 1024);
    assert.equal(calculate("calculate three point five times two").calc.value, 7);
    assert.equal(calculate("calculate 1,000 + 0.5").calc.result, "1,000.5");
    assert.match(calculate("calculate 5 divided by 0").text, /division by zero/);
    assert.equal(calculate("what time is it"), null);
    assert.equal(calculate("how many people are there"), null);
  });
});
test("calculate: kalimat Inggris tetap dipahami saat bahasa app Indonesia (dan sebaliknya)", async () => {
  assert.equal(calculate("calculate 6 times 7").speech, "6 dikali 7 sama dengan 42, Sir.");
  await inLang("en", () => assert.equal(calculate("hitung 6 dikali 7").speech, "6 times 7 equals 42, Sir."));
});
test("commands (EN): intent Inggris & balasan Inggris", async () => {
  for (const [cmd, id] of [
    ["turn on the camera", "camera_on"], ["turn the camera off", "camera_off"], ["enable motion detection", "motion_on"],
    ["disable face detection", "faces_off"], ["detect objects", "objects_on"], ["enable hand tracking", "hands_on"],
    ["what do you see", "see"], ["is there anyone there", "people"], ["take a photo", "snapshot"],
    ["guard mode", "guard_on"], ["set quality to high", "quality"], ["stop the vision system", "vision_stop"],
    ["Jarvis, enable body pose", "pose_on"], ["emergency stop", "emergency"],
  ]) assert.equal(matchIntent(cmd)?.id, id, cmd);
  await inLang("en", async () => {
    const { actions } = (() => { const v = fakeVision(); return { actions: createActions({ vision: v, app: { setGuard() {}, takeSnapshot: () => true, stopAll() {}, emergencyStop() {}, togglePersonOnly: () => true, motionEvents: () => 3 }, delay: async () => {} }) }; })();
    assert.match((await runCommand("enable motion detection", actions)).text, /Motion detection is already active|needs the camera|camera is not on/i);
    assert.match((await runCommand("take a photo", actions)).text, /Photo taken/);
    assert.match((await runCommand("how many motion events", actions)).text, /3 motion events/);
  });
});
test("describeScene & pose (EN)", async () => {
  await inLang("en", () => {
    assert.match(describeScene({ cameraOn: false }), /camera is off/);
    const s = describeScene({
      cameraOn: true, enabled: { objects: true }, brightness: 10,
      results: { objects: [{ name: "person" }, { name: "person" }, { name: "cup" }] },
    });
    assert.match(s, /2 people, 1 cup/);
    assert.match(s, /very dark/);
  });
});

// ------------------------------------------------------------------ kalkulator
test("calculate: contoh utama — hitung 125 dikali 8", () => {
  const r = calculate("Jarvis, hitung 125 dikali 8.");
  assert.equal(r.calc.value, 1000);
  assert.equal(r.speech, "125 dikali 8 sama dengan 1000, Sir.");
  assert.equal(r.calc.expr, "125 × 8");
});
test("calculate: operator kata, simbol, dan presedensi", () => {
  const v = (s) => calculate(s)?.calc.value;
  assert.equal(v("hitung 10 ditambah 5 dikali 2"), 20);
  assert.equal(v("berapa 7 dikurangi 10"), -3);
  assert.equal(v("hitung 100 dibagi 8"), 12.5);
  assert.equal(v("hitung 2 pangkat 10"), 1024);
  assert.equal(v("17 modulo 5"), 2);
  assert.equal(v("5+3*2"), 11);
  assert.equal(v("12 x 12"), 144);
  assert.equal(v("hitung (2 + 3) × 4"), 20);
  assert.equal(v("hitung 0,1 + 0,2"), 0.3);
  assert.equal(v("hitung 1.000 + 500"), 1500);
});
test("calculate: kata bilangan, juta/ribu, persen, akar, kuadrat", () => {
  const v = (s) => calculate(s)?.calc.value;
  assert.equal(v("hitung seratus dua puluh lima dikali delapan"), 1000);
  assert.equal(v("hitung dua ribu lima ratus ditambah satu"), 2501);
  assert.equal(v("hitung sebelas ditambah lima belas"), 26);
  assert.equal(v("hitung 5 juta dikurangi 2 juta"), 3e6);
  assert.equal(v("hitung tiga koma lima dikali dua"), 7);
  assert.equal(v("hitung 15 persen dari 200"), 30);
  assert.equal(v("hitung 100 ditambah 10 persen"), 110);
  assert.equal(v("hitung akar dari 144"), 12);
  assert.equal(v("hitung akar kuadrat 81 ditambah 1"), 10);
  assert.equal(v("hitung 5 kuadrat"), 25);
});
test("calculate: galat sopan & tidak menyabotase perintah lain", () => {
  assert.match(calculate("hitung 5 dibagi 0").text, /nol/);
  assert.match(calculate("hitung akar dari minus 4").text, /negatif/);
  assert.match(calculate("hitung kucing").text, /tidak bisa memahami/);
  for (const s of ["berapa orang di depan kamera", "jam berapa sekarang", "aktifkan kamera", "apa kabar", "ada satu orang", "constructor kali 2", "aktifkan 3 kamera", "5"]) {
    assert.equal(calculate(s), null, s);
  }
});
test("runCommand: kalkulator didahulukan, intent vision tetap jalan", async () => {
  const r = await runCommand("hitung 125 dikali 8", {});
  assert.equal(r.calc.value, 1000);
  assert.equal(matchIntent("aktifkan kamera").id, "camera_on");
});

// ------------------------------------------------------------------ tiruan
function fakeVision({ startError = null } = {}) {
  const enabled = new Set();
  const status = {};
  const s = { on: false, calls: [], quality: null };
  const results = { hands: { hands: [] }, faces: [], objects: [], poses: [], motion: null };
  const v = {
    s, results, brightness: 128, motionActive: false,
    get cameraOn() { return s.on; },
    async start() { s.calls.push("start"); if (startError) return { ok: false, error: startError }; s.on = true; return { ok: true }; },
    stop() { s.calls.push("stop"); s.on = false; },
    async setFeature(f, on, { requireCamera = false } = {}) {
      s.calls.push(`${f}:${on}`);
      if (on) {
        if (requireCamera && !s.on) return { ok: false, reason: "camera-off" };
        enabled.add(f); status[f] = "ready";
        return { ok: true };
      }
      enabled.delete(f); status[f] = "off";
      return { ok: true };
    },
    isEnabled: (f) => enabled.has(f),
    status: (f) => status[f] || "off",
    setQuality(n) { s.quality = n; return { ok: !!QUALITY[n], label: QUALITY[n]?.label }; },
  };
  return v;
}

function fakeApp() {
  const a = { calls: [], snapOk: true, personOnly: false, events: 3 };
  return Object.assign(a, {
    setGuard: (on) => a.calls.push(`guard:${on}`),
    takeSnapshot: () => { a.calls.push("snap"); return a.snapOk; },
    stopAll: () => a.calls.push("stopAll"),
    emergencyStop: () => a.calls.push("emergency"),
    togglePersonOnly: () => (a.personOnly = !a.personOnly),
    motionEvents: () => a.events,
  });
}

const setup = (opts) => {
  const vision = fakeVision(opts), app = fakeApp();
  app.stopAll = () => { app.calls.push("stopAll"); vision.stop(); }; // seperti app asli: mematikan kamera
  const actions = createActions({ vision, app, delay: async () => {} });
  return { vision, app, actions, run: (t) => runCommand(t, actions) };
};

// ------------------------------------------------------------------ parser
test("kata panggil Jarvis/AEGIS dibuang", () => {
  for (const t of ["Jarvis, aktifkan kamera.", "AEGIS aktifkan kamera", "hei jarvis, aktifkan kamera", "Jervis aktifkan kamera", "egis, aktifkan kamera"]) {
    assert.equal(normalize(t), "aktifkan kamera", t);
  }
});

test("8 perintah suara dari spesifikasi dikenali", () => {
  const cases = {
    "Jarvis, aktifkan kamera.": "camera_on",
    "Jarvis, matikan kamera.": "camera_off",
    "Jarvis, aktifkan deteksi gerakan.": "motion_on",
    "Jarvis, apa yang kamu lihat?": "see",
    "Jarvis, apakah ada orang?": "people",
    "Jarvis, deteksi objek.": "objects_on",
    "Jarvis, aktifkan hand tracking.": "hands_on",
    "Jarvis, hentikan vision system.": "vision_stop",
  };
  for (const [text, id] of Object.entries(cases)) assert.equal(matchIntent(text)?.id, id, text);
});

test("variasi on/off dan perintah tambahan", () => {
  const cases = {
    "nonaktifkan deteksi gerakan": "motion_off", "matikan hand tracking": "hands_off", "hentikan deteksi objek": "objects_off",
    "aktifkan deteksi pose tubuh": "pose_on", "matikan pose": "pose_off", "aktifkan deteksi wajah": "faces_on",
    "nyalakan kamera": "camera_on", "tutup kamera": "camera_off", "mode jaga": "guard_on", "matikan alarm": "guard_off",
    "ambil foto": "snapshot", "emergency stop": "emergency", "aktifkan vision system": "vision_start",
    "kualitas deteksi tinggi": "quality", "laporan gerakan": "motion_report", "berapa orang di depan kamera": "people",
  };
  for (const [text, id] of Object.entries(cases)) assert.equal(matchIntent(text)?.id, id, text);
  assert.equal(matchIntent("kualitas deteksi rendah").arg, "rendah");
  assert.equal(matchIntent("kualitas deteksi tinggi").arg, "tinggi");
});

test("obrolan biasa bukan perintah vision", () => {
  for (const t of ["jam berapa sekarang", "apa kabar", "cuaca hari ini", "siapa kamu", "halo"]) assert.equal(matchIntent(t), null, t);
});

test("semua intent punya aksi", () => {
  const { actions } = setup();
  for (const id of INTENT_IDS) assert.equal(typeof actions[id], "function", `aksi ${id} hilang`);
});

// ------------------------------------------------------------------ integrasi aksi
test("aktifkan kamera → vision.start dipanggil dan ada konfirmasi", async () => {
  const { vision, run } = setup();
  const r = await run("Jarvis, aktifkan kamera.");
  assert.ok(vision.cameraOn);
  assert.match(r.text, /berhasil diaktifkan/);
});

test("kamera gagal (izin ditolak) → TIDAK mengonfirmasi sukses", async () => {
  const { vision, run } = setup({ startError: "Izin kamera ditolak." });
  const r = await run("aktifkan kamera");
  assert.equal(vision.cameraOn, false);
  assert.match(r.text, /gagal/);
  assert.match(r.text, /Izin kamera ditolak/);
  assert.doesNotMatch(r.text, /berhasil/);
});

test("fitur vision saat kamera mati → minta nyalakan kamera, fitur tidak diaktifkan", async () => {
  const { vision, run } = setup();
  for (const cmd of ["aktifkan deteksi gerakan", "deteksi objek", "aktifkan hand tracking", "aktifkan pose"]) {
    const r = await run(cmd);
    assert.match(r.text, /Kamera belum aktif/, cmd);
  }
  assert.equal(vision.isEnabled("motion"), false);
  assert.equal(vision.isEnabled("objects"), false);
});

test("alur lengkap dengan kamera menyala", async () => {
  const { vision, app, run } = setup();
  await run("aktifkan kamera");
  assert.match((await run("aktifkan deteksi gerakan")).text, /Deteksi gerakan aktif/);
  assert.match((await run("aktifkan hand tracking")).text, /Hand tracking aktif/);
  assert.match((await run("aktifkan deteksi gerakan")).text, /sudah aktif/);
  assert.ok(vision.isEnabled("motion") && vision.isEnabled("hands"));
  assert.match((await run("matikan deteksi gerakan")).text, /dinonaktifkan/);
  assert.equal(vision.isEnabled("motion"), false);
  assert.match((await run("mode jaga")).text, /Mode jaga aktif/);
  assert.match((await run("ambil foto")).text, /Foto berhasil/);
  assert.match((await run("hentikan vision system")).text, /Vision system dihentikan/);
  assert.ok(app.calls.includes("stopAll"));
  assert.match((await run("hentikan vision system")).text, /tidak berjalan/);
});

test("deteksi objek: aktifkan lalu laporkan apa yang terlihat", async () => {
  const { vision, run } = setup();
  await run("aktifkan kamera");
  vision.results.objects = [
    { name: "person", score: 0.9, box: {} }, { name: "cell phone", score: 0.8, box: {} },
  ];
  const r = await run("Jarvis, deteksi objek.");
  assert.match(r.text, /Deteksi objek aktif/);
  assert.match(r.text, /1 orang/);
  assert.match(r.text, /1 ponsel/);
});

test("apakah ada orang: ya / tidak / modul belum aktif / kamera mati", async () => {
  const { vision, run } = setup();
  assert.match((await run("apakah ada orang")).text, /Kamera belum aktif/);
  await run("aktifkan kamera");
  assert.match((await run("apakah ada orang")).text, /belum aktif/);
  await run("deteksi objek");
  assert.match((await run("apakah ada orang")).text, /Tidak, saya tidak melihat/);
  vision.results.objects = [{ name: "person", score: 0.9, box: {} }];
  assert.match((await run("apakah ada orang")).text, /Ya, saya melihat 1 orang/);
});

test("kualitas deteksi, emergency, laporan gerak, foto gagal", async () => {
  const { vision, app, run } = setup();
  assert.match((await run("kualitas deteksi tinggi")).text, /tinggi/);
  assert.equal(vision.s.quality, "tinggi");
  assert.match((await run("emergency stop")).text, /Penghentian darurat/);
  assert.ok(app.calls.includes("emergency"));
  assert.match((await run("laporan gerakan")).text, /3 kejadian/);
  app.snapOk = false;
  assert.match((await run("ambil foto")).text, /belum aktif/);
});

// ------------------------------------------------------------------ motion
test("diffFrames: tidak ada perubahan → 0, perubahan lokal → box & zona benar", () => {
  const w = 80, h = 60;
  const a = new Uint8Array(w * h).fill(50);
  assert.equal(diffFrames(a, a, w, h, 28, 4, 3).ratio, 0);
  const b = a.slice();
  for (let y = 10; y < 20; y++) for (let x = 60; x < 70; x++) b[y * w + x] = 200; // blok 10x10 di kanan atas
  const r = diffFrames(a, b, w, h, 28, 4, 3);
  assert.equal(r.ratio, 100 / (w * h));
  assert.deepEqual([r.box.x, r.box.y, r.box.w, r.box.h].map((n) => +n.toFixed(4)), [0.75, 10 / 60, 0.125, 10 / 60].map((n) => +n.toFixed(4)));
  assert.equal(r.zoneCount[3], 100); // zona kolom 3 baris 0
});

test("sensitivitas: makin tinggi makin kecil ambang", () => {
  assert.ok(minRatioFor(90) < minRatioFor(50));
  assert.ok(minRatioFor(50) < minRatioFor(10));
});

// ------------------------------------------------------------------ human / pose / gesture
test("summarizeHumans menggabungkan objek, wajah, pose", () => {
  assert.equal(summarizeHumans({}).count, 0);
  assert.equal(summarizeHumans({ objects: [{ name: "person" }, { name: "cup" }] }).count, 1);
  assert.equal(summarizeHumans({ faces: [{}, {}], objects: [{ name: "person" }] }).count, 2);
  assert.deepEqual(summarizeHumans({ poses: [{}] }).sources, ["pose"]);
});

test("describeScene melaporkan kamera mati dan gelap", () => {
  assert.match(describeScene({ cameraOn: false }), /belum aktif/);
  const s = describeScene({ cameraOn: true, enabled: { objects: true }, results: { objects: [] }, brightness: 10 });
  assert.match(s, /tidak mengenali objek/);
  assert.match(s, /gelap/);
});

function pose(over = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  Object.assign(lm[11], { x: 0.6, y: 0.4 }); Object.assign(lm[12], { x: 0.4, y: 0.4 });
  Object.assign(lm[23], { x: 0.58, y: 0.7 }); Object.assign(lm[24], { x: 0.42, y: 0.7 });
  Object.assign(lm[15], { x: 0.7, y: 0.6 }); Object.assign(lm[16], { x: 0.3, y: 0.6 });
  for (const [i, p] of Object.entries(over)) Object.assign(lm[i], p);
  return lm;
}

test("analyzePose: tangan terangkat, horizontal, gerak", () => {
  assert.equal(analyzePose(pose()).armsUp, 0);
  assert.equal(analyzePose(pose({ 15: { y: 0.2 } })).armsUp, 1);
  assert.equal(analyzePose(pose({ 15: { y: 0.2 }, 16: { y: 0.2 } })).armsUp, 2);
  const flat = pose({ 11: { x: 0.2, y: 0.5 }, 12: { x: 0.2, y: 0.55 }, 23: { x: 0.7, y: 0.5 }, 24: { x: 0.7, y: 0.55 } });
  assert.equal(analyzePose(flat).horizontal, true);
  assert.equal(analyzePose(pose()).horizontal, false);
  const moved = pose({ 0: { x: 0.6 }, 15: { x: 0.9 } });
  assert.equal(analyzePose(moved, pose()).moving, true);
  assert.equal(analyzePose(pose(), pose()).moving, false);
});

test("ThumbUpTrigger: tahan N frame, lepas dulu, cooldown", () => {
  const t = new ThumbUpTrigger({ holdFrames: 3, cooldownMs: 1000 });
  assert.equal(t.update(true, 0), false);
  assert.equal(t.update(true, 1), false);
  assert.equal(t.update(true, 2000), true);   // frame ke-3 → picu
  assert.equal(t.update(true, 2001), false);  // masih ditahan → tidak ulang
  t.update(false, 2002);
  for (let i = 0; i < 3; i++) t.update(true, 2100 + i);
  assert.equal(t.update(true, 2200), false);  // cooldown belum lewat
  assert.equal(t.update(true, 4000), true);
});

// ------------------------------------------------------------------ suara
test("rankVoice: suara pria Indonesia diutamakan", () => {
  const voices = [
    { name: "Microsoft Gadis Online (Natural) - Indonesian", lang: "id-ID" },
    { name: "Google US English", lang: "en-US" },
    { name: "Microsoft Ardi - Indonesian (Indonesia)", lang: "id-ID" },
    { name: "Microsoft David - English", lang: "en-US" },
  ];
  const best = [...voices].sort((a, b) => rankVoice(b) - rankVoice(a))[0];
  assert.match(best.name, /Ardi/);
  assert.equal(isMaleVoice(voices[0]), false);
  assert.equal(isMaleVoice(voices[2]), true);
});

// ------------------------------------------------------------------ multi-tangan & multi-orang
import { assignTracks } from "../modules/handDetection.js";
import { isWaving, postureOf } from "../modules/poseDetection.js";
import { personActivities } from "../modules/humanDetection.js";

test("assignTracks: ID tangan stabil antar-frame dan tangan baru dapat ID baru", () => {
  const tracks = [], nid = { n: 0 };
  assert.deepEqual(assignTracks(tracks, [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], nid), [0, 1]);
  assert.deepEqual(assignTracks(tracks, [{ x: 0.82, y: 0.5 }, { x: 0.22, y: 0.5 }], nid), [1, 0]); // urutan MediaPipe berubah
  assert.deepEqual(assignTracks(tracks, [{ x: 0.5, y: 0.1 }, { x: 0.22, y: 0.5 }, { x: 0.82, y: 0.5 }], nid), [2, 0, 1]);
  assert.ok(tracks.find((t) => t.id === 0).trail.length >= 2);
});

test("isWaving: pergelangan terangkat bolak-balik", () => {
  const wave = [0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5].map((x) => ({ x, y: 0.2, up: true }));
  assert.equal(isWaving(wave), true);
  assert.equal(isWaving(wave.map((p) => ({ ...p, up: false }))), false);
  assert.equal(isWaving([0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52, 0.54].map((x) => ({ x, y: 0.2, up: true }))), false);
});

test("postureOf: berdiri, duduk, berbaring", () => {
  const mk = (kneeY) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    Object.assign(lm[11], { x: 0.4, y: 0.3, visibility: 1 }); Object.assign(lm[12], { x: 0.6, y: 0.3, visibility: 1 });
    Object.assign(lm[23], { x: 0.45, y: 0.6, visibility: 1 }); Object.assign(lm[24], { x: 0.55, y: 0.6, visibility: 1 });
    Object.assign(lm[25], { x: 0.45, y: kneeY, visibility: 1 }); Object.assign(lm[26], { x: 0.55, y: kneeY, visibility: 1 });
    return lm;
  };
  assert.equal(postureOf(mk(0.95)), "standing");
  assert.equal(postureOf(mk(0.68)), "sitting");
  const lying = mk(0.6);
  Object.assign(lying[11], { x: 0.1, y: 0.5 }); Object.assign(lying[12], { x: 0.1, y: 0.55 });
  Object.assign(lying[23], { x: 0.5, y: 0.5 }); Object.assign(lying[24], { x: 0.5, y: 0.55 });
  assert.equal(postureOf(lying), "lying");
});

test("personActivities: gestur tangan dikaitkan ke orang terdekat", () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  Object.assign(lm[15], { x: 0.3, y: 0.2 });
  const poses = [{ landmarks: lm, info: { label: "relatif diam" } }];
  const near = { name: "Victory", landmarks: [{ x: 0.31, y: 0.21 }] };
  const far = { name: "Open_Palm", landmarks: [{ x: 0.9, y: 0.9 }] };
  const [a] = personActivities({ poses, hands: [near, far] });
  assert.match(a, /relatif diam/);
  assert.match(a, /V/);
  assert.doesNotMatch(a, /telapak/);
});
