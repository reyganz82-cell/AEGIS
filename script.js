/* =========================================================
   A.E.G.I.S. — Full Vision System v2.0 (application shell)
   Modul vision/suara ada di folder modules/. File ini menyatukan:
   UI, log, dashboard, otak percakapan, mode jaga, snapshot/klip,
   visualizer, serta penghubung antara voice assistant ↔ vision controller.
   ========================================================= */
import { CONFIG, QUALITY } from "./modules/config.js";
import { loadVision } from "./modules/visionLib.js";
import { createVisionController, FEATURES } from "./modules/visionController.js";
import { createVoiceAssistant } from "./modules/voiceAssistant.js";
import { createActions, runCommand } from "./modules/commands.js";
import { GESTURE_LABELS } from "./modules/handDetection.js";
import { objName } from "./modules/objectDetection.js";
import { calculate } from "./modules/calculator.js";
import { t as tr, getLang, setLang, meta } from "./modules/i18n.js";
import { askAI, checkAI, aiStatus } from "./modules/ai.js";
import { describeScene, summarizeHumans, personActivities } from "./modules/humanDetection.js";
import { fetchWeather, resolveLocation } from "./modules/weather.js";
import { createIot } from "./modules/iot.js";

// Warna visualizer per state (harus sejalan dengan --core di style.css)
const STATE_COLORS = {
  idle: "0,229,255",
  listening: "0,255,200",
  thinking: "255,184,77",
  speaking: "122,245,255",
};

// ---------------------------------------------------------
// UTIL
// ---------------------------------------------------------
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");

const el = {
  body: document.body,
  boot: $("boot"), bootBtn: $("bootBtn"),
  hdrDate: $("hdrDate"), hdrTime: $("hdrTime"), camLive: $("camLive"), micLive: $("micLive"),
  clockBig: $("clockBig"), clockSec: $("clockSec"), secBar: $("secBar"),
  dateFull: $("dateFull"), tzName: $("tzName"),
  wxIcon: $("wxIcon"), wxTemp: $("wxTemp"), wxCond: $("wxCond"),
  iotBadge: $("iotBadge"), iotTokenForm: $("iotTokenForm"), iotTokenInput: $("iotTokenInput"), iotSensors: $("iotSensors"),
  iotOutputs: $("iotOutputs"), iotEvents: $("iotEvents"), iotNote: $("iotNote"), iotLogout: $("iotLogout"),
  wxBadge: $("wxBadge"), wxNote: $("wxNote"), wxHum: $("wxHum"), wxWind: $("wxWind"), wxFeels: $("wxFeels"),
  log: $("log"),
  core: $("core"), viz: $("viz"), stateText: $("stateText"),
  userText: $("userText"), aegisText: $("aegisText"),
  video: $("video"), overlay: $("overlay"), camView: $("camView"),
  camBadge: $("camBadge"), camHud: $("camHud"), camAlert: $("camAlert"),
  gestureBadge: $("gestureBadge"), gestureName: $("gestureName"), gestureScore: $("gestureScore"), gestureBar: $("gestureBar"),
  cooldownText: $("cooldownText"), cooldownBar: $("cooldownBar"),
  netStatus: $("netStatus"), micStatus: $("micStatus"), camStatus: $("camStatus"),
  srStatus: $("srStatus"), engineStatus: $("engineStatus"), libStatus: $("libStatus"),
  voiceSelect: $("voiceSelect"), voiceNote: $("voiceNote"),
  chatForm: $("chatForm"), chatInput: $("chatInput"),
  micBtn: $("micBtn"), camBtn: $("camBtn"), stopBtn: $("stopBtn"),
  motionBtn: $("motionBtn"), guardBtn: $("guardBtn"), snapBtn: $("snapBtn"), emergencyBtn: $("emergencyBtn"),
  toast: $("toast"),
  qualitySelect: $("qualitySelect"), sensRange: $("sensRange"), sensText: $("sensText"),
  fpsText: $("fpsText"), lightText: $("lightText"), vcError: $("vcError"),
  optBoxes: $("optBoxes"), optZones: $("optZones"), optAutoSnap: $("optAutoSnap"), optRecord: $("optRecord"), optPersonOnly: $("optPersonOnly"),
  motionBadge: $("motionBadge"), motionLevel: $("motionLevel"), motionBar: $("motionBar"),
  motionEvents: $("motionEvents"), motionLast: $("motionLast"), guardStatus: $("guardStatus"),
  poseBadge: $("poseBadge"), poseInfo: $("poseInfo"),
  objBadge: $("objBadge"), objList: $("objList"), personCount: $("personCount"), faceCount: $("faceCount"),
  snapGallery: $("snapGallery"), snapCount: $("snapCount"),
  calcExpr: $("calcExpr"), calcResult: $("calcResult"), calcKeys: $("calcKeys"), calcHistory: $("calcHistory"),
};

/** Set teks + kelas warna pada elemen status (ok | warn | err | active). */
function setStatus(node, text, tone = "") {
  node.textContent = text;
  node.className = node.classList.contains("badge") ? `badge ${tone}` : tone;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 4500);
}

function log(tag, text, kind = "") {
  const li = document.createElement("li");
  if (kind) li.className = kind;
  const t = new Date();
  li.innerHTML = `<time>${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}</time><b></b><span></span>`;
  li.querySelector("b").textContent = tag;
  li.querySelector("span").textContent = text;
  el.log.prepend(li);
  while (el.log.children.length > 40) el.log.lastChild.remove();
}

function salutation(date = new Date()) {
  const h = date.getHours();
  if (h < 11) return tr("sal.morning");
  if (h < 15) return tr("sal.noon");
  if (h < 18) return tr("sal.afternoon");
  return tr("sal.evening");
}

// ---------------------------------------------------------
// STATE MACHINE: idle | listening | thinking | speaking
// ---------------------------------------------------------
let state = "idle";
function setState(next) {
  state = next;
  el.body.dataset.state = next;
  el.stateText.textContent = next.toUpperCase();
}

// ---------------------------------------------------------
// JAM & TANGGAL (real-time)
// ---------------------------------------------------------
function formatDate(d) {
  return d.toLocaleDateString(meta().locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function tickClock() {
  const d = new Date();
  const hh = pad(d.getHours()), mm = pad(d.getMinutes()), ss = pad(d.getSeconds());
  el.hdrTime.textContent = `${hh}:${mm}:${ss}`;
  el.hdrDate.textContent = formatDate(d).toUpperCase();
  el.clockBig.textContent = `${hh}:${mm}`;
  el.clockSec.textContent = ss;
  el.secBar.style.width = `${(d.getSeconds() / 59) * 100}%`;
  el.dateFull.textContent = d.toLocaleDateString(meta().locale, { day: "numeric", month: "short", year: "numeric" });
}

function initClock() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tr("tz.local");
  const offset = -new Date().getTimezoneOffset() / 60;
  el.tzName.textContent = `${tz} (UTC${offset >= 0 ? "+" : ""}${offset})`;
  tickClock();
  setTimeout(() => { tickClock(); setInterval(tickClock, 1000); }, 1000 - (Date.now() % 1000));
}

// ---------------------------------------------------------
// CUACA NYATA (Open-Meteo; lokasi dari izin geolokasi / zona waktu)
// ---------------------------------------------------------
const WX_SVG = (inner) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">${inner}</svg>`;
const WX_CLOUD = (y) => `<path d="M18 ${y}h30a10 10 0 0 0 0-20 15 15 0 0 0-28 5 8 8 0 0 0-2 15z" fill="rgba(0,229,255,.08)"/>`;
const WEATHER_ICONS = {
  cloudSun: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="24" cy="22" r="9"/><path d="M24 5v4M24 35v2M7 22h4M38 22h2M12 10l3 3M36 10l-3 3M12 34l3-3"/><path d="M22 50h26a9 9 0 0 0 0-18 13 13 0 0 0-24 4 7 7 0 0 0-2 14z" fill="rgba(0,229,255,.08)"/></svg>`,
  cloud: WX_SVG(WX_CLOUD(46)),
  rain: WX_SVG(`${WX_CLOUD(38)}<path d="M22 46l-3 7M32 46l-3 7M42 46l-3 7"/>`),
  snow: WX_SVG(`${WX_CLOUD(38)}<path d="M22 48v.1M32 52v.1M42 48v.1M27 56v.1M37 56v.1" stroke-width="4"/>`),
  storm: WX_SVG(`${WX_CLOUD(38)}<path d="M33 40l-6 9h8l-5 9"/>`),
  fog: WX_SVG(`${WX_CLOUD(38)}<path d="M16 46h32M20 53h28"/>`),
  sun: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="32" cy="32" r="11" fill="rgba(0,229,255,.08)"/><path d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4 4M45 45l4 4M15 49l4-4M45 19l4-4"/></svg>`,
};

const WX_REFRESH_MS = 15 * 60 * 1000;
let weather = null; // {cond, icon, temp, humidity, wind, feels, at}
let wxLoc = null;   // {lat, lon, exact, name?}
let wxFailed = false;

try {
  const saved = JSON.parse(localStorage.getItem("aegis.weather") || "null");
  if (saved && saved.weather && Date.now() - saved.weather.at < 6 * 3600 * 1000) { weather = saved.weather; wxLoc = saved.loc; }
} catch { /* abaikan */ }

const wxPlace = () => (!wxLoc ? "" : wxLoc.exact ? tr("ui.wx.here") : wxLoc.name || tr("ui.wx.here"));
const wxTime = (at) => new Date(at).toLocaleTimeString(meta().locale, { hour: "2-digit", minute: "2-digit" });

function renderWeather() {
  if (!weather) {
    el.wxIcon.innerHTML = "";
    el.wxTemp.textContent = "--";
    el.wxCond.textContent = "--";
    el.wxHum.textContent = el.wxWind.textContent = el.wxFeels.textContent = "--";
    setStatus(el.wxBadge, tr(wxFailed ? "ui.wx.offline" : "ui.wx.loading"), wxFailed ? "warn" : "");
    el.wxNote.textContent = tr(wxFailed ? "ui.wx.fail" : "ui.wx.loadingNote");
    return;
  }
  el.wxIcon.innerHTML = WEATHER_ICONS[weather.icon] || WEATHER_ICONS.cloud;
  el.wxTemp.textContent = Math.round(weather.temp);
  el.wxCond.textContent = tr(weather.cond);
  el.wxHum.textContent = `${weather.humidity}%`;
  el.wxWind.textContent = `${weather.wind} ${tr("wx.kmh")}`;
  el.wxFeels.textContent = `${Math.round(weather.feels)}°C`;
  const stale = wxFailed || Date.now() - weather.at > WX_REFRESH_MS * 2;
  setStatus(el.wxBadge, tr(stale ? "ui.wx.offline" : "ui.wx.live"), stale ? "warn" : "ok");
  const place = wxLoc && !wxLoc.exact ? `${wxPlace()} (${tr("ui.wx.approx")})` : wxPlace();
  el.wxNote.textContent = tr(stale ? "ui.wx.stale" : "ui.wx.src", { p: place, t: wxTime(weather.at) });
}

async function updateWeather() {
  try {
    wxLoc ||= await resolveLocation();
    weather = await fetchWeather(wxLoc);
    wxFailed = false;
    try { localStorage.setItem("aegis.weather", JSON.stringify({ weather, loc: wxLoc })); } catch { /* abaikan */ }
  } catch (e) {
    wxFailed = true;
    log("SYS", `Weather: ${e.message}`, "sys");
  }
  renderWeather();
}

// ---------------------------------------------------------
// IOT RUMAH (ESP32 → server → dashboard): sensor PIR, RFID, suhu, pintu, relay lampu
// ---------------------------------------------------------
const IOT_BOOL = { pir: ["iot.v.motion", "iot.v.clear"], door: ["iot.v.open", "iot.v.closed"] };

function iotValueText(name, s) {
  if (typeof s.value === "boolean" && IOT_BOOL[name]) return tr(IOT_BOOL[name][s.value ? 0 : 1]);
  if (typeof s.value === "number") return `${Math.round(s.value * 10) / 10}${s.unit || ""}`;
  return String(s.value);
}

function iotSummary() {
  const sn = iot.state?.sensors || {};
  return Object.entries(sn).map(([n, s]) => {
    const label = tr(`iot.s.${n}`) === `iot.s.${n}` ? n : tr(`iot.s.${n}`).toLowerCase();
    return `${label} ${typeof s.value === "number" ? Math.round(s.value * 10) / 10 + (s.unit ? " " + s.unit : "") : iotValueText(n, s).toLowerCase()}`;
  }).join(", ");
}

function iotEventText(e) {
  if (e.type === "motion") return tr("iot.e.motion");
  if (e.type === "rfid") return e.name ? tr("iot.e.rfid", { n: e.name }) : tr("iot.e.rfidNo", { u: e.uid });
  if (e.type === "door") return tr("iot.e.door", { d: tr(e.detail === "open" ? "iot.v.open" : "iot.v.closed").toLowerCase() });
  if (e.type === "command") return tr("iot.e.command", { d: e.detail });
  return tr("iot.e.other", { t: e.type });
}

function renderIot() {
  const a = iot.auth, st = iot.state;
  const needToken = a === "missing" || a === "bad" || a === "disabled";
  el.iotTokenForm.hidden = !needToken;
  el.iotLogout.hidden = needToken || !iot.hasToken;
  const note = { missing: "iot.n.nokey", bad: "iot.n.bad", disabled: "iot.n.disabled", offline: "iot.n.offline" }[a];
  if (note) el.iotNote.textContent = tr(note);
  else el.iotNote.textContent = tr(st && Object.keys(st.sensors).length ? "iot.n.ok" : "iot.n.wait");

  if (a === "missing") setStatus(el.iotBadge, tr("iot.b.none"), "");
  else if (a === "bad") setStatus(el.iotBadge, tr("iot.b.bad"), "err");
  else if (a === "disabled") setStatus(el.iotBadge, tr("iot.b.off"), "warn");
  else if (a === "offline") setStatus(el.iotBadge, tr("iot.b.net"), "warn");
  else if (iot.online) setStatus(el.iotBadge, tr("iot.b.online"), "ok");
  else setStatus(el.iotBadge, tr(st && Object.keys(st.devices).length ? "iot.b.dev" : "iot.b.wait"), "warn");

  el.iotSensors.innerHTML = "";
  el.iotOutputs.innerHTML = "";
  if (!st || needToken) return;
  for (const [name, s] of Object.entries(st.sensors)) {
    const box = document.createElement("div");
    const hot = (name === "pir" && s.value === true) || (name === "door" && s.value === true);
    box.className = `iot-sensor${hot ? " hot" : ""}${st.now - s.at > 30000 ? " stale" : ""}`;
    const label = document.createElement("small");
    label.textContent = tr(`iot.s.${name}`) === `iot.s.${name}` ? name.toUpperCase() : tr(`iot.s.${name}`);
    const val = document.createElement("b");
    val.textContent = iotValueText(name, s);
    box.append(label, val);
    el.iotSensors.appendChild(box);
  }
  for (const name of new Set(["lampu", ...Object.keys(st.outputs)])) {
    const on = st.outputs[name] === "on";
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn${on ? " active" : ""}`;
    b.textContent = `${tr(`iot.o.${name}`) === `iot.o.${name}` ? name.toUpperCase() : tr(`iot.o.${name}`)} · ${tr(on ? "iot.on" : "iot.off")}`;
    b.addEventListener("click", async () => {
      const r = await iot.command(name, on ? "off" : "on");
      if (!r.ok) toast(tr("cmd.iot.fail"));
    });
    el.iotOutputs.appendChild(b);
  }
}

function onIotEvent(e) {
  const text = iotEventText(e);
  log("IOT", text, "sys");
  const li = document.createElement("li");
  const t = new Date(e.at);
  li.innerHTML = "<time></time><span></span>";
  li.firstChild.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  li.lastChild.textContent = text;
  el.iotEvents.prepend(li);
  while (el.iotEvents.children.length > 20) el.iotEvents.lastChild.remove();

  if (e.type === "rfid") {
    el.userText.textContent = `[RFID ${e.uid}]`;
    respond({ text: e.name ? tr("iot.sp.welcome", { n: e.name }) : tr("iot.sp.unknown") });
  } else if (e.type === "motion" && guard.armed) {
    el.userText.textContent = "[PIR — GUARD MODE]";
    triggerAlarm();
  }
}

const iot = createIot({ hooks: { onState: renderIot, onAuth: renderIot, onEvent: onIotEvent } });
Object.defineProperty(iot, "summary", { value: iotSummary });
// ---------------------------------------------------------
// OTAK PERCAKAPAN UMUM — rule-based keyword matching
// (perintah kamera/vision ditangani modules/commands.js lebih dulu)
// ---------------------------------------------------------
const has = (t, ...words) => words.some((w) => t.includes(w));

// Kata kunci Indonesia & Inggris dikenali sekaligus; jawaban memakai bahasa aktif (tr()).
const RULES = [
  {
    id: "time",
    match: (t) => has(t, "jam berapa", "pukul berapa", "jam sekarang", "waktu sekarang", "sekarang jam", "jam brp", "what time", "time is it", "current time", "the time") ||
      /\b(waktu|jam)\b/.test(t) && !has(t, "tanggal") || /\btime\b/.test(t) && !has(t, "date"),
    reply: () => {
      const d = new Date();
      const h = d.getHours(), m = d.getMinutes();
      const en = getLang() === "en";
      return {
        text: tr("r.time", { h: pad(h), m: pad(m) }),
        speech: m === 0 ? tr("r.time.sp0", { h }) : tr("r.time.sp", { h: en ? pad(h) : h, m: en ? pad(m) : m }),
      };
    },
  },
  {
    id: "temperature",
    match: (t) => has(t, "suhu", "temperatur", "derajat", "panas", "dingin", "gerah", "temperature", "how hot", "how cold", "degrees"),
    reply: () => weather
      ? { text: tr("r.temp", { p: wxPlace(), t: Math.round(weather.temp) }) }
      : { text: tr("r.wxNone") },
  },
  {
    id: "weather",
    match: (t) => has(t, "cuaca", "hujan", "cerah", "mendung", "berawan", "kelembapan", "angin", "weather", "rain", "sunny", "cloudy", "humidity", "windy"),
    reply: () => weather
      ? { text: tr("r.weather", { p: wxPlace(), c: tr(weather.cond).toLowerCase(), t: Math.round(weather.temp), h: weather.humidity }) }
      : { text: tr("r.wxNone") },
  },
  {
    id: "date",
    match: (t) => has(t, "tanggal", "hari apa", "hari ini hari", "bulan apa", "tahun berapa", "hari ini", "what date", "what day", "today's date", "todays date", "the date", "which day"),
    reply: () => ({ text: tr("r.date", { d: formatDate(new Date()) }) }),
  },
  {
    id: "identity",
    match: (t) => has(t, "siapa kamu", "kamu siapa", "siapa anda", "anda siapa", "namamu", "nama kamu", "nama anda", "perkenalkan", "siapa aegis", "aegis itu apa", "siapa jarvis",
      "who are you", "what are you", "your name", "introduce yourself", "what is aegis", "who is jarvis"),
    reply: () => ({ text: tr("r.identity") }),
  },
  {
    id: "creator",
    match: (t) => has(t, "siapa yang membuat", "siapa pembuat", "siapa yang buat", "dibuat oleh", "penciptamu", "who made you", "who created you", "who built you", "who developed you", "your creator"),
    reply: () => ({ text: tr("r.creator") }),
  },
  {
    id: "howareyou",
    match: (t) => has(t, "apa kabar", "gimana kabar", "bagaimana kabar", "kabarmu", "how are you", "how's it going", "how is it going", "hows it going"),
    reply: () => ({ text: tr("r.how") }),
  },
  {
    id: "help",
    match: (t) => has(t, "bisa apa", "kemampuan", "bantuan", "help", "fitur", "apa yang bisa", "what can you do", "features", "capabilities"),
    reply: () => ({ text: tr("r.help") }),
  },
  {
    id: "status",
    match: (t) => has(t, "status sistem", "status system", "kondisi sistem", "diagnosa", "diagnostik", "system status", "diagnostic", "how is the system"),
    reply: () => {
      const on = FEATURES.filter((f) => vision.isEnabled(f) && vision.cameraOn);
      return {
        text: tr("r.status", {
          cam: tr(vision.cameraOn ? "s.on" : "s.off"),
          mods: on.length ? tr("s.mods", { l: on.join(", ") }) : tr("s.nomods"),
          guard: tr(guard.armed ? "s.on" : "s.off"),
          q: tr(`q.${vision.quality}`).toLowerCase(),
          sr: voice.supported.stt ? tr("s.sr.yes") : tr("s.sr.no"),
        }),
      };
    },
  },
  {
    id: "thanks",
    match: (t) => has(t, "terima kasih", "makasih", "thanks", "thank you", "trims", "thank"),
    reply: () => ({ text: tr("r.thanks") }),
  },
  {
    id: "bye",
    match: (t) => has(t, "sampai jumpa", "selamat tinggal", "dadah", "bye", "selamat tidur", "goodbye", "see you", "good night", "farewell"),
    reply: () => ({ text: tr("r.bye") }),
  },
  {
    id: "greet",
    match: (t) => /\b(halo|hallo|helo|hai|hay|hi|hello|hey|pagi|siang|sore|malam|assalamualaikum|permisi|morning|afternoon|evening)\b/.test(t) || t === "aegis" || t === "jarvis",
    reply: () => ({ text: tr("r.greet", { sal: salutation() }) }),
  },
];

const FALLBACKS = ["fb.1", "fb.2", "fb.3"];

function ruleReply(input) {
  const t = input.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const rule = RULES.find((r) => r.match(t));
  return rule ? rule.reply() : null;
}

function think(input) {
  return ruleReply(input) || { text: tr(FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]) };
}

/** Kondisi HUD saat ini (waktu, cuaca panel, kamera) untuk diberikan ke AI sebagai konteks. */
function buildContext() {
  const now = new Date();
  const lines = [
    `Local time: ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    `Date: ${formatDate(now)}`,
    weather
      ? `Current weather (real data from Open-Meteo, ${wxPlace()}): ${tr(weather.cond)}, ${Math.round(weather.temp)} C, feels like ${Math.round(weather.feels)} C, humidity ${weather.humidity}%, wind ${weather.wind} km/h`
      : "Current weather: not available yet",
    `Camera: ${vision.cameraOn ? "on" : "off"}`,
    ...(iot.hasToken && iot.state ? [`Home sensors (ESP32, ${iot.online ? "online" : "offline"}): ${iotSummary() || "no data yet"}`] : []),
  ];
  if (vision.cameraOn) {
    const enabled = Object.fromEntries(["objects", "faces", "pose", "motion", "hands"].map((f) => [f, vision.isEnabled(f) && vision.status(f) === "ready"]));
    lines.push(`Camera view: ${describeScene({ cameraOn: true, enabled, results: vision.results, motion: { active: vision.motionActive }, brightness: vision.brightness })}`);
  }
  return lines.join("\n");
}

/** Bersihkan sisa markdown dari jawaban AI supaya enak dibaca dan diucapkan. */
function plainAnswer(s) {
  return s.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------
// TEKS TERKUNCI KE SUARA: boundary event TTS bila tersedia,
// kalau tidak, estimasi waktu yang dimulai tepat saat suara mulai.
// ---------------------------------------------------------
const reveal = { text: "", speechLen: 1, shown: 0, target: 0, t0: 0, estMs: 1, boundary: false, timer: null };

function renderReveal() { el.aegisText.textContent = reveal.text.slice(0, Math.round(reveal.shown)); }

function startReveal(text, speechLen) {
  clearInterval(reveal.timer);
  Object.assign(reveal, { text, speechLen: Math.max(1, speechLen), shown: 0, target: 0, t0: 0, boundary: false });
  renderReveal();
}

function beginReveal(msPerChar) {
  reveal.t0 = performance.now();
  reveal.estMs = Math.max(400, reveal.speechLen * msPerChar);
  clearInterval(reveal.timer);
  reveal.timer = setInterval(() => {
    if (!reveal.boundary) {
      reveal.target = Math.min(reveal.text.length, ((performance.now() - reveal.t0) / reveal.estMs) * reveal.text.length);
    }
    reveal.shown += (reveal.target - reveal.shown) * 0.5;
    if (reveal.target - reveal.shown < 0.5) reveal.shown = reveal.target;
    renderReveal();
    if (reveal.shown >= reveal.text.length) clearInterval(reveal.timer);
  }, 30);
}

function boundaryReveal(charIndex, charLength, speech) {
  const end = charLength || (speech.slice(charIndex).search(/\s/) + 1 || speech.length - charIndex);
  const ratio = Math.min(1, (charIndex + end) / reveal.speechLen);
  let target = Math.ceil(ratio * reveal.text.length);
  const sp = reveal.text.indexOf(" ", target); // genapkan ke akhir kata
  target = sp === -1 ? reveal.text.length : sp;
  reveal.boundary = true;
  reveal.target = Math.max(reveal.target, target);
}

function finishReveal() {
  clearInterval(reveal.timer);
  reveal.shown = reveal.target = reveal.text.length;
  renderReveal();
}

// ---------------------------------------------------------
// ALUR RESPON: tampil teks → bicara → animasi → kembali IDLE
// ---------------------------------------------------------
let vizPulse = 0;

let revealStarted = false;
function speakNow(text) {
  setState("speaking");
  revealStarted = false;
  const begin = () => { if (!revealStarted) { revealStarted = true; beginReveal(68 / CONFIG.speech.rate); } };
  // bila suara tak kunjung mulai (voice belum siap), tampilkan teks tetap tepat waktu
  const guardTimer = setTimeout(begin, 1500);
  voice.speak(text, {
    onStart: () => { clearTimeout(guardTimer); setState("speaking"); begin(); },
    onBoundary: (ci, cl, name) => {
      vizPulse = 1;
      if (name === undefined || name === "word") boundaryReveal(ci, cl, text);
    },
    onEnd: ({ cancelled }) => {
      if (cancelled) return; // pembatalan ditangani pemanggilnya
      finishReveal();
      if (state === "speaking") setState("idle");
    },
  });
}

function respond({ text, speech }) {
  const spoken = speech || text;
  startReveal(text, spoken.length);
  log("AEGIS", text);
  speakNow(spoken);
}

function stopSpeaking() {
  voice.cancel();
  finishReveal();
  if (state === "speaking" || state === "thinking") setState("idle");
}

let requestId = 0;
async function handleInput(raw) {
  const text = raw.trim();
  if (!text) return;
  const id = ++requestId;
  el.userText.textContent = text;
  log("YOU", text, "user");
  stopSpeaking();
  setState("thinking");
  let reply = await runCommand(text, actions); // perintah vision/kamera
  if (!reply) {
    // pertanyaan pendek (jam, cuaca, sapaan…) dijawab lokal; sisanya ke chatbot AI
    const short = text.split(/\s+/).length <= 6;
    reply = short ? ruleReply(text) : null;
    if (!reply) {
      const ai = await askAI(text, { context: buildContext() });
      if (ai) reply = { text: plainAnswer(ai) };
    }
    if (!reply) {
      await sleep(300 + Math.random() * 300);
      const s = aiStatus();
      reply = { text: tr(s && s.reason ? "fb.noai" : "fb.aierr") };
    }
  }
  if (id !== requestId) return; // ada input baru / emergency stop yang menggantikan
  if (reply.calc) showCalc(reply.calc);
  respond(reply);
}

// ---------------------------------------------------------
// SMART CALCULATOR (suara/teks lewat commands.js, tombol lewat keypad ini)
// ---------------------------------------------------------
const calc = { expr: "", fresh: false, history: [] };

function renderCalcInput() {
  el.calcExpr.textContent = calc.expr || tr("ui.calc.hint");
  el.calcResult.classList.remove("err");
  if (!calc.expr) { el.calcResult.textContent = "0"; return; }
  const r = calculate(calc.expr, { force: true }); // pratinjau hasil selagi mengetik
  el.calcResult.textContent = r?.calc ? r.calc.result : "…";
}

/** Tampilkan hasil dari perintah suara/teks maupun tombol "=" dan simpan ke riwayat. */
function showCalc({ expr, result }) {
  el.calcExpr.textContent = `${expr} =`;
  el.calcResult.textContent = result;
  el.calcResult.classList.remove("err");
  el.calcResult.parentElement.classList.remove("flash");
  void el.calcResult.offsetWidth;
  el.calcResult.parentElement.classList.add("flash");
  calc.expr = result; // bisa dilanjutkan dengan tombol operator (format id-ID dipahami parser)
  calc.fresh = true;
  calc.history.unshift({ expr, result });
  calc.history.length = Math.min(calc.history.length, 8);
  el.calcHistory.innerHTML = "";
  calc.history.forEach((h) => {
    const li = document.createElement("li");
    li.title = "Klik untuk memakai hasil ini";
    li.innerHTML = "<span></span><b></b>";
    li.firstChild.textContent = h.expr;
    li.lastChild.textContent = `= ${h.result}`;
    li.addEventListener("click", () => { calc.expr = h.result; calc.fresh = true; renderCalcInput(); });
    el.calcHistory.appendChild(li);
  });
  log("CALC", `${expr} = ${result}`);
}

function pressCalcKey(k) {
  const OPERATORS = "÷×−+^%";
  if (k === "C") { calc.expr = ""; calc.fresh = false; return renderCalcInput(); }
  if (k === "⌫") { calc.expr = calc.fresh ? "" : calc.expr.slice(0, -1); calc.fresh = false; return renderCalcInput(); }
  if (k === "=") {
    if (!calc.expr) return;
    const r = calculate(calc.expr, { force: true });
    if (r?.calc) { showCalc(r.calc); respond({ text: r.text, speech: r.speech }); return; }
    el.calcResult.textContent = "ERR";
    el.calcResult.classList.add("err");
    if (r) respond({ text: r.text });
    return;
  }
  // setelah hasil: operator melanjutkan hasil, angka/kurung memulai perhitungan baru
  if (calc.fresh && !OPERATORS.includes(k)) calc.expr = "";
  calc.fresh = false;
  calc.expr += k;
  renderCalcInput();
}

// ---------------------------------------------------------
// VOICE ASSISTANT (push-to-talk + TTS)
// ---------------------------------------------------------
function updateLive() {
  el.camLive.hidden = !vision.cameraOn;
  el.micLive.hidden = !voice.micOpen;
  document.title = `${vision.cameraOn ? "🔴 " : ""}A.E.G.I.S. — Full Vision System`;
}

const voice = createVoiceAssistant({
  lang: meta().stt,
  hooks: {
    onListening(on) {
      el.micBtn.classList.toggle("active", on);
      if (on) {
        setStatus(el.micStatus, "LISTENING", "active");
        setState("listening");
        el.userText.textContent = "…";
      } else {
        setStatus(el.micStatus, voice.denied ? "DENIED" : "READY", voice.denied ? "err" : "ok");
        if (state === "listening") setState("idle");
        if (el.userText.textContent === "…") el.userText.textContent = "—";
      }
      updateLive();
    },
    onInterim: (t) => { el.userText.textContent = t || "…"; },
    onFinal: (t) => handleInput(t),
    onError(msg, code) {
      toast(msg);
      log("SYS", msg, "sys");
      if (code === "not-allowed" || code === "service-not-allowed") setStatus(el.micStatus, "DENIED", "err");
      if (state === "listening" || state === "speaking") setState("idle");
    },
    onVoices(list, selected, info) {
      el.voiceSelect.innerHTML = "";
      list.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        opt.selected = v === selected;
        el.voiceSelect.appendChild(opt);
      });
      el.voiceNote.textContent = !info.match ? tr("v.noMatch") : !info.male ? tr("v.noMale") : tr("v.ok", { n: info.name });
    },
  },
});

function toggleTalkKeys() {
  const typing = (t) => t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || typing(e.target)) return;
    if (e.target.tagName === "BUTTON" && e.target !== el.micBtn) return; // biarkan Spasi mengaktifkan tombol lain
    e.preventDefault();
    pressTalk();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || typing(e.target)) return;
    e.preventDefault();
    voice.releaseTalk();
  });
  window.addEventListener("blur", () => voice.releaseTalk());
}

function pressTalk() {
  requestId++; // batalkan balasan yang sedang diproses
  finishReveal();
  if (!voice.pressTalk()) return;
}

// ---------------------------------------------------------
// VISION: kamera, modul deteksi, hooks → UI
// ---------------------------------------------------------
const motion = { events: 0, active: false, alarmed: false };
const guard = { armed: false, lastAlarm: 0, alarmTimer: null };
const snaps = { count: 0 };
let audioCtx = null;
let lastObjKey = "", lastPoseKey = "", lastHud = "", lastUiAt = 0, lastPersons = 0;

function setCamUI(text, tone) {
  setStatus(el.camStatus, text, tone);
  setStatus(el.camBadge, text, tone);
}

const STATUS_TEXT = { off: "OFF", loading: "LOADING…", ready: "READY", error: "ERROR" };

function syncSwitches() {
  document.querySelectorAll(".switch").forEach((sw) => { sw.checked = vision.isEnabled(sw.dataset.feature); });
  el.motionBtn.classList.toggle("active", vision.isEnabled("motion"));
}

function refreshEngine() {
  const active = FEATURES.filter((f) => f !== "motion" && vision.isEnabled(f));
  const st = active.map((f) => vision.status(f));
  if (st.includes("loading")) setStatus(el.engineStatus, "LOADING…", "warn");
  else if (st.includes("error")) setStatus(el.engineStatus, "ERROR", "err");
  else if (vision.cameraOn && st.includes("ready")) setStatus(el.engineStatus, "READY", "ok");
  else setStatus(el.engineStatus, "STANDBY", "");
}

function resetVisionUI() {
  el.gestureName.textContent = "—";
  el.gestureName.classList.remove("hit");
  el.gestureScore.textContent = "0%";
  el.gestureBar.style.width = "0";
  el.faceCount.textContent = "—";
  el.personCount.textContent = "—";
  el.fpsText.textContent = "—";
  el.lightText.textContent = "—";
  el.camHud.textContent = "";
  el.motionLevel.textContent = "0%";
  el.motionBar.style.width = "0";
  el.objList.innerHTML = `<small class="note">${tr("u.objIdle")}</small>`;
  el.poseInfo.textContent = tr("u.poseIdle");
  lastObjKey = lastPoseKey = lastHud = "";
  lastPersons = 0;
}

const vision = createVisionController({
  video: el.video,
  overlay: el.overlay,
  hooks: {
    onCamera(st, info) {
      if (st === "requesting") { setCamUI("REQUESTING", "warn"); el.camBtn.disabled = true; return; }
      el.camBtn.disabled = false;
      if (st === "error") {
        setCamUI(info.code, "err");
        toast(info.error);
        log("SYS", info.error, "sys");
        return;
      }
      const on = st === "on";
      el.camBtn.classList.toggle("active", on);
      el.camView.classList.toggle("on", on);
      setCamUI(on ? "ACTIVE" : "OFFLINE", on ? "ok" : "");
      log("SYS", on ? tr("l.camOn") : tr("l.camOff"), "sys");
      if (on) {
        el.vcError.hidden = true;
        loadVision()
          .then((v) => setStatus(el.libStatus, v.source === "lokal" ? "LOCAL" : "CDN", "ok"))
          .catch((e) => { setStatus(el.libStatus, "ERROR", "err"); showVisionError(e.message); });
      } else {
        resetVisionUI();
        endMotionEvent();
        stopClip();
      }
      refreshEngine();
      updateMotionUI();
      updateLive();
    },
    onStatus(f, status) {
      const n = $(`st-${f}`);
      if (n) { n.textContent = STATUS_TEXT[status]; n.className = `vc-status ${status}`; }
      if (f === "hands") {
        const map = { ready: ["SCANNING", "ok"], loading: ["LOADING", "warn"], error: ["ERROR", "err"], off: ["STANDBY", ""] };
        setStatus(el.gestureBadge, ...map[status]);
        if (status === "ready") el.gestureName.textContent = tr("u.searchHand");
        else if (status !== "loading") el.gestureName.textContent = status === "error" ? tr("u.modelFail") : "—";
      }
      if (f === "objects") setStatus(el.objBadge, status === "ready" ? "SCANNING" : STATUS_TEXT[status], status === "ready" ? "ok" : status === "loading" ? "warn" : status === "error" ? "err" : "");
      if (f === "pose") setStatus(el.poseBadge, status === "ready" ? "TRACKING" : STATUS_TEXT[status], status === "ready" ? "ok" : status === "loading" ? "warn" : status === "error" ? "err" : "");
      if (f === "motion") updateMotionUI();
      refreshEngine();
    },
    onFeature(f, enabled) {
      syncSwitches();
      if (f === "motion" && !enabled && guard.armed) setGuard(false, true);
      if (!enabled && f === "faces") el.faceCount.textContent = "—";
      if (!enabled && f === "objects") { el.personCount.textContent = "—"; lastObjKey = ""; el.objList.innerHTML = `<small class="note">${tr("u.objOff")}</small>`; }
      if (!enabled && f === "pose") { el.poseInfo.textContent = tr("u.poseOff"); lastPoseKey = ""; }
      if (!enabled && f === "hands") { el.gestureName.textContent = "—"; el.gestureScore.textContent = "0%"; el.gestureBar.style.width = "0"; }
      updateMotionUI();
      refreshEngine();
    },
    onError(f, msg) {
      showVisionError(`[${f}] ${msg}`);
      toast(tr("toast.mod", { f, m: msg.slice(0, 120) }));
      log("SYS", tr("l.mod", { f, m: msg.slice(0, 160) }), "sys");
    },
    onMotionEvent(type) { type === "start" ? startMotionEvent() : endMotionEvent(); },
    onThumbsUp() {
      log("VISION", "Gesture detected: THUMBS UP", "sys");
      el.userText.textContent = "[Gesture detected: THUMBS UP 👍]";
      respond({ text: tr("l.thumbsGreet", { sal: salutation() }) });
    },
    onQuality(name) {
      el.qualitySelect.value = name;
      try { localStorage.setItem("aegis.quality", name); } catch { /* abaikan */ }
      log("VISION", tr("l.quality", { q: tr(`q.${name}`) }), "sys");
    },
    onFrame: onVisionFrame,
  },
});

function showVisionError(msg) {
  el.vcError.hidden = false;
  el.vcError.textContent = `⚠ ${msg}`;
}

function onVisionFrame({ results, fps, brightness }) {
  // overlay digambar controller; di sini hanya teks/meter, dibatasi ±10x per detik
  const now = performance.now();
  if (now - lastUiAt < 100) {
    guardPersonCheck(results);
    return;
  }
  lastUiAt = now;
  const on = vision.cameraOn;

  // HUD kamera
  const d = new Date();
  const hud = on ? `${clip.rec ? "⏺ REC" : "●"} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${fps}FPS${brightness < 40 ? " · LOW LIGHT" : ""}${guard.armed ? " · ARMED" : ""}` : "";
  if (hud !== lastHud) { lastHud = hud; el.camHud.textContent = hud; }
  if (on) {
    el.fpsText.textContent = String(fps);
    el.lightText.textContent = brightness < 40 ? `${tr("u.dark")} (${Math.round(brightness)})` : brightness > 200 ? `${tr("u.bright")} (${Math.round(brightness)})` : `${tr("u.normal")} (${Math.round(brightness)})`;
  }

  // gesture
  if (on && vision.isEnabled("hands") && vision.status("hands") === "ready") {
    const { hands, best, thumbUp } = results.hands;
    if (!hands.length) {
      el.gestureName.textContent = tr("u.searchHand");
      el.gestureName.classList.remove("hit");
      el.gestureScore.textContent = "0%";
      el.gestureBar.style.width = "0";
    } else {
      // semua tangan terlihat: satu baris per tangan (H1, H2, …) sesuai warna garis di kamera
      el.gestureName.textContent = hands.length === 1
        ? GESTURE_LABELS[best.name] || best.name || "HAND DETECTED"
        : [tr("u.hands", { n: hands.length }), ...hands.map((h) => `H${(h.id % 99) + 1} · ${GESTURE_LABELS[h.name] || "HAND DETECTED"} ${Math.round(h.score * 100)}%`)].join("\n");
      el.gestureName.classList.toggle("hit", thumbUp);
      el.gestureScore.textContent = `${Math.round(best.score * 100)}%`;
      el.gestureBar.style.width = `${best.score * 100}%`;
    }
    const rem = vision.thumbRemaining();
    el.cooldownText.textContent = rem ? `${(rem / 1000).toFixed(1)}s` : "READY";
    el.cooldownBar.style.width = rem ? `${(rem / CONFIG.gesture.cooldownMs) * 100}%` : "0";
  }

  // wajah
  if (on && vision.isEnabled("faces") && vision.status("faces") === "ready") el.faceCount.textContent = String(results.faces.length);

  // objek + orang
  if (on && vision.isEnabled("objects") && vision.status("objects") === "ready") {
    const counts = {};
    results.objects.forEach((o) => { counts[o.name] = (counts[o.name] || 0) + 1; });
    const key = JSON.stringify(counts);
    if (key !== lastObjKey) {
      lastObjKey = key;
      renderObjectList(counts);
    }
  }

  // jumlah orang: gabungan objek, wajah, dan pose (ambil yang terbanyak)
  if (on && ["objects", "faces", "pose"].some((f) => vision.isEnabled(f) && vision.status(f) === "ready")) {
    const persons = summarizeHumans(results).count;
    el.personCount.textContent = String(persons);
    if (persons !== lastPersons) {
      if (lastPersons === 0 && persons > 0) log("VISION", tr("l.person", { n: persons }), "sys");
      else if (persons > 0) log("VISION", tr("u.peopleN", { n: persons }), "sys");
      lastPersons = persons;
    }
  }

  // pose
  if (on && vision.isEnabled("pose") && vision.status("pose") === "ready") {
    const acts = personActivities({ poses: results.poses, hands: results.hands.hands });
    const key = acts.join("|");
    if (key !== lastPoseKey) {
      lastPoseKey = key;
      el.poseInfo.innerHTML = "";
      if (!acts.length) el.poseInfo.textContent = tr("u.noBody");
      acts.forEach((a, i) => {
        const row = document.createElement("div");
        row.textContent = tr("u.person", { n: i + 1, l: a });
        el.poseInfo.appendChild(row);
      });
    }
  }

  // motion meter
  const m = results.motion;
  if (on && vision.isEnabled("motion") && m?.ready) {
    el.motionLevel.textContent = `${Math.round(m.level * 100)}%`;
    el.motionBar.style.width = `${m.level * 100}%`;
    el.motionBar.parentElement.classList.toggle("hot", m.moving);
  }
  guardPersonCheck(results);
}

function renderObjectList(counts) {
  const names = Object.keys(counts);
  if (!names.length) { el.objList.innerHTML = `<small class="note">${tr("u.noObj")}</small>`; return; }
  el.objList.innerHTML = "";
  names.forEach((n) => {
    const chip = document.createElement("span");
    chip.className = `chip${n === "person" ? " person" : ""}`;
    chip.textContent = `${objName(n, counts[n]).toUpperCase()} ×${counts[n]}`;
    el.objList.appendChild(chip);
  });
}

// ---------------------------------------------------------
// MOTION EVENT, MODE JAGA, SNAPSHOT, KLIP
// ---------------------------------------------------------
function updateMotionUI() {
  const enabled = vision.isEnabled("motion");
  el.motionBtn.classList.toggle("active", enabled);
  el.guardBtn.classList.toggle("active", guard.armed);
  el.motionEvents.textContent = motion.events;
  el.guardStatus.textContent = guard.armed ? (el.camView.classList.contains("alarm") ? "TRIGGERED" : "ARMED") : "DISARMED";
  el.guardStatus.className = guard.armed ? "alarm" : "";
  if (!enabled) setStatus(el.motionBadge, "OFF", "");
  else if (!vision.cameraOn) setStatus(el.motionBadge, "STANDBY", "");
  else if (motion.active) setStatus(el.motionBadge, "MOTION!", "warn");
  else setStatus(el.motionBadge, guard.armed ? "ARMED" : "MONITORING", "ok");
}

function setGuard(on, silent = false) {
  guard.armed = on;
  if (on && !vision.isEnabled("motion")) vision.setFeature("motion", true);
  vision.setOverlay({ armed: on });
  if (!on) {
    clearTimeout(guard.alarmTimer);
    el.camView.classList.remove("alarm");
  }
  if (!silent) log("VISION", on ? tr("l.guardOn") : tr("l.guardOff"), "sys");
  updateMotionUI();
}

function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [880, 620, 880, 620].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.2);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.2 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.2 + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.2); o.stop(t0 + i * 0.2 + 0.2);
    });
  } catch { /* audio tidak tersedia */ }
}

function personGateOpen() {
  const needPerson = el.optPersonOnly.checked && vision.isEnabled("objects") && vision.status("objects") === "ready";
  return !needPerson || vision.results.objects.some((o) => o.name === "person");
}

function startMotionEvent() {
  motion.active = true;
  motion.events++;
  motion.alarmed = false;
  el.camView.classList.add("motion");
  log("VISION", tr("l.motion", { n: motion.events }), "sys");
  if (guard.armed && personGateOpen()) triggerAlarm();
  updateMotionUI();
}

/** Mode "hanya orang": alarm baru dibunyikan setelah detektor objek benar-benar melihat orang. */
function guardPersonCheck(results) {
  if (guard.armed && motion.active && !motion.alarmed && results.objects.some((o) => o.name === "person")) triggerAlarm();
}

function endMotionEvent() {
  if (!motion.active) return;
  motion.active = false;
  if (clip.rec) { clearTimeout(clip.tailTimer); clip.tailTimer = setTimeout(stopClip, CONFIG.clip.tailMs); }
  el.camView.classList.remove("motion");
  const d = new Date();
  el.motionLast.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  updateMotionUI();
}

function triggerAlarm() {
  motion.alarmed = true;
  if (el.optRecord.checked) { clearTimeout(clip.tailTimer); startClip(); }
  el.camView.classList.add("alarm");
  clearTimeout(guard.alarmTimer);
  guard.alarmTimer = setTimeout(() => { el.camView.classList.remove("alarm"); updateMotionUI(); }, 4000);
  beep();
  if (el.optAutoSnap.checked) takeSnapshot("motion");
  const now = Date.now();
  if (now - guard.lastAlarm > CONFIG.motion.alarmCooldownMs) {
    guard.lastAlarm = now;
    el.userText.textContent = "[Motion detected — GUARD MODE]";
    respond({ text: tr("l.alarmSpeech") });
  }
}

function addGalleryItem(a) {
  if (!snaps.count) el.snapGallery.innerHTML = "";
  el.snapGallery.prepend(a);
  while (el.snapGallery.children.length > 8) {
    const old = el.snapGallery.lastChild;
    if (old.href?.startsWith("blob:")) URL.revokeObjectURL(old.href);
    old.remove();
  }
  snaps.count++;
  el.snapCount.textContent = String(snaps.count);
}

function takeSnapshot(source = "manual") {
  const v = el.video;
  if (!vision.cameraOn || v.readyState < 2) return false;
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext("2d");
  g.translate(c.width, 0); g.scale(-1, 1); // sama seperti yang terlihat di layar
  g.drawImage(v, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  g.font = "16px monospace";
  g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, c.height - 26, c.width, 26);
  g.fillStyle = source === "motion" ? "#ff4d6d" : "#7af5ff";
  g.fillText(`AEGIS · ${source.toUpperCase()} · ${stamp}`, 8, c.height - 8);

  const url = c.toDataURL("image/jpeg", 0.85);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aegis-${source}-${stamp.replace(/[: ]/g, "-")}.jpg`;
  a.title = tr("l.snapTitle", { s: source, t: stamp });
  if (source === "motion") a.className = "motion-shot";
  a.innerHTML = `<img alt="Snapshot ${stamp}" />`;
  a.firstChild.src = url;
  addGalleryItem(a);
  log("VISION", tr("l.snap", { s: source }), "sys");
  return true;
}

// ---- rekam klip video otomatis saat alarm (tersimpan di memori browser, diunduh manual) ----
const clip = { rec: null, chunks: [], tailTimer: null, maxTimer: null };

function startClip() {
  if (clip.rec || !vision.stream || typeof MediaRecorder === "undefined") return;
  try {
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    clip.rec = new MediaRecorder(vision.stream, mime ? { mimeType: mime } : undefined);
  } catch { clip.rec = null; return; }
  clip.chunks = [];
  const rec = clip.rec;
  rec.ondataavailable = (e) => e.data.size && clip.chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(clip.chunks, { type: "video/webm" });
    clip.rec = null;
    clip.chunks = [];
    if (blob.size < 1000) return;
    const d = new Date();
    const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aegis-clip-${stamp.replace(/:/g, "-")}.webm`;
    a.className = "clip";
    a.title = tr("l.clipTitle");
    a.textContent = `🎥 CLIP ${stamp}`;
    addGalleryItem(a);
    log("VISION", tr("l.clipSaved"), "sys");
  };
  rec.start();
  clip.maxTimer = setTimeout(stopClip, CONFIG.clip.maxMs);
  log("VISION", tr("l.clipRec"), "sys");
}

function stopClip() {
  clearTimeout(clip.tailTimer);
  clearTimeout(clip.maxTimer);
  if (clip.rec && clip.rec.state !== "inactive") clip.rec.stop();
}

// ---------------------------------------------------------
// STOP ALL & EMERGENCY STOP
// ---------------------------------------------------------
function stopAll() {
  stopClip();
  setGuard(false, true);
  vision.stop();
}

function emergencyStop() {
  requestId++;
  stopAll();
  voice.shutdownMic();
  endMotionEvent();
  log("SYS", tr("l.emerg"), "sys");
  toast(tr("toast.emerg"));
}

// ---------------------------------------------------------
// PERINTAH VISION (suara/teks) → aksi dengan konfirmasi suara
// ---------------------------------------------------------
const actions = createActions({
  vision,
  app: {
    setGuard: (on) => setGuard(on),
    takeSnapshot,
    stopAll,
    emergencyStop,
    togglePersonOnly: () => (el.optPersonOnly.checked = !el.optPersonOnly.checked),
    motionEvents: () => motion.events,
    iot,
  },
});

// ---------------------------------------------------------
// HOLOGRAM: rotasi ring + audio visualizer (canvas)
// ---------------------------------------------------------
const holo = {
  rings: [...document.querySelectorAll(".core-svg .ring")].map((g) => ({ g, speed: +g.dataset.speed, angle: 0 })),
  ctx: el.viz.getContext("2d"),
  bars: 120,
  levels: new Float32Array(120),
  speedMul: 1,
  size: 0,
  dpr: 1,
};

const STATE_SPEED = { idle: 1, listening: 2, thinking: 6, speaking: 3.5 };

/** Interaksi core: tilt 3D mengikuti kursor, hover mempercepat ring, klik = denyut energi. */
function initCoreInteraction() {
  holo.hover = false;
  holo.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const core = el.core;
  core.addEventListener("pointermove", (e) => {
    const r = core.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    core.style.setProperty("--ty", `${((nx - 0.5) * 14).toFixed(2)}deg`);
    core.style.setProperty("--tx", `${((0.5 - ny) * 14).toFixed(2)}deg`);
    core.style.setProperty("--mx", `${(nx * 100).toFixed(1)}%`);
    core.style.setProperty("--my", `${(ny * 100).toFixed(1)}%`);
  });
  core.addEventListener("pointerenter", () => { holo.hover = true; });
  core.addEventListener("pointerleave", () => {
    holo.hover = false;
    ["--tx", "--ty"].forEach((p) => core.style.setProperty(p, "0deg"));
    ["--mx", "--my"].forEach((p) => core.style.setProperty(p, "50%"));
  });
  core.addEventListener("click", () => {
    vizPulse = 1;
    core.classList.remove("ping");
    void core.offsetWidth; // restart animasi
    core.classList.add("ping");
  });
}

function resizeViz() {
  const rect = el.core.getBoundingClientRect();
  holo.dpr = Math.min(window.devicePixelRatio || 1, 2);
  holo.size = rect.width;
  el.viz.width = rect.width * holo.dpr;
  el.viz.height = rect.height * holo.dpr;
}

let lastFrame = performance.now();
function renderHolo(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const goal = (STATE_SPEED[state] || 1) * (holo.hover ? 1.8 : 1) * (holo.reduced ? 0.15 : 1);
  holo.speedMul += (goal - holo.speedMul) * 0.05;
  for (const r of holo.rings) {
    r.angle = (r.angle + r.speed * holo.speedMul * dt) % 360;
    r.g.setAttribute("transform", `rotate(${r.angle.toFixed(2)} 200 200)`);
  }

  const { ctx, bars, levels, dpr } = holo;
  const size = holo.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, scale = size / 400, t = now;
  const color = STATE_COLORS[state];

  const half = bars / 2;
  const freq = state === "listening" ? voice.getFreq() : null;
  for (let i = 0; i < bars; i++) {
    let target;
    const mirrored = i < half ? i : bars - 1 - i; // simetris kiri-kanan
    if (state === "speaking") {
      const n = Math.abs(Math.sin(t * 0.011 + mirrored * 0.55) * Math.sin(t * 0.0067 + mirrored * 1.3));
      target = (0.25 + 0.75 * n) * (0.55 + 0.45 * vizPulse) + Math.random() * 0.15;
    } else if (state === "listening") {
      if (freq) {
        const idx = Math.floor((mirrored / half) * freq.length * 0.7);
        target = 0.08 + (freq[idx] / 255) * 1.1;
      } else {
        target = 0.12 + Math.random() * 0.25;
      }
    } else if (state === "thinking") {
      target = 0.1 + 0.55 * Math.max(0, Math.sin(i * 0.25 - t * 0.012)) ** 3;
    } else {
      target = 0.06 + 0.05 * Math.sin(t * 0.0018 + i * 0.35);
    }
    levels[i] += (Math.min(target, 1.2) - levels[i]) * 0.22;
  }
  vizPulse *= 0.9;

  ctx.lineCap = "round";
  ctx.shadowColor = `rgb(${color})`;
  ctx.shadowBlur = 10 * scale;
  ctx.lineWidth = 2.4 * scale;
  const r0 = 130 * scale;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const len = (3 + levels[i] * 33) * scale; // maks ±44 → berhenti sebelum cincin r=179
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.strokeStyle = `rgba(${color},${0.35 + Math.min(levels[i], 1) * 0.65})`;
    ctx.beginPath();
    ctx.moveTo(cx + cos * r0, cx + sin * r0);
    ctx.lineTo(cx + cos * (r0 + len), cx + sin * (r0 + len));
    ctx.stroke();
  }

  if (state === "speaking" || state === "listening") {
    const avg = levels.reduce((s, v) => s + v, 0) / bars;
    ctx.beginPath();
    ctx.arc(cx, cx, (56 + avg * 28) * scale, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${color},${0.25 + avg * 0.5})`;
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  }

  requestAnimationFrame(renderHolo);
}

// ---------------------------------------------------------
// BAHASA (ID / EN): teks statis lewat atribut data-i18n*, sisanya lewat tr()
// ---------------------------------------------------------
let booted = false;

function applyLanguage() {
  const lg = getLang();
  document.documentElement.lang = lg;
  document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = tr(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = tr(n.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-title]").forEach((n) => { n.title = tr(n.dataset.i18nTitle); });
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lg)));
  // tombol desimal keypad: koma (id) / titik (en); hasil lama memakai format bahasa sebelumnya → kosongkan
  const dec = lg === "en" ? "." : ",";
  const dk = el.calcKeys.querySelector("[data-dec]");
  if (dk) { dk.dataset.k = dec; dk.textContent = dec; }
  calc.expr = ""; calc.fresh = false; calc.history.length = 0; el.calcHistory.innerHTML = "";
  renderCalcInput();
  renderWeather();
  renderIot();
  tickClock();
  if (!booted) el.aegisText.textContent = tr("ui.aegisInit");
  if (!vision.cameraOn) resetVisionUI();
  if (!voice.supported.stt) setStatus(el.srStatus, tr("u.srNo"), "err");
}

function switchLanguage(next) {
  if (!setLang(next)) return;
  voice.setLang(meta().stt); // pengenalan suara + pemilihan suara TTS per bahasa
  applyLanguage();
  if (booted) respond({ text: tr("v.langSet") });
}

// ---------------------------------------------------------
// NETWORK STATUS
// ---------------------------------------------------------
function updateNet() {
  navigator.onLine ? setStatus(el.netStatus, "ONLINE", "ok") : setStatus(el.netStatus, "OFFLINE", "warn");
}

// ---------------------------------------------------------
// EVENT BINDING & BOOT
// ---------------------------------------------------------
function bindEvents() {
  el.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = el.chatInput.value;
    el.chatInput.value = "";
    handleInput(value);
  });

  // push-to-talk: tahan tombol → bicara → lepas
  el.micBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { el.micBtn.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    pressTalk();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => el.micBtn.addEventListener(ev, () => voice.releaseTalk()));
  el.micBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  toggleTalkKeys();

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => switchLanguage(b.dataset.lang)));

  // dock widget (jam, cuaca, kalkulator, log): klik ikon = buka/tutup; klik di luar / Esc = tutup
  const dockBtns = [...document.querySelectorAll(".dock-btn")];
  const widgetCards = [...document.querySelectorAll("#widgets [data-widget]")];
  const showWidget = (name) => {
    widgetCards.forEach((c) => c.classList.toggle("open", c.dataset.widget === name));
    dockBtns.forEach((b) => {
      const on = b.dataset.open === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-expanded", String(on));
    });
  };
  dockBtns.forEach((b) => b.addEventListener("click", () => showWidget(b.classList.contains("active") ? null : b.dataset.open)));
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#widgets, .widget-dock")) showWidget(null);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") showWidget(null); });

  el.iotTokenForm.addEventListener("submit", (e) => {
    e.preventDefault();
    iot.setToken(el.iotTokenInput.value);
    el.iotTokenInput.value = "";
  });
  el.iotLogout.addEventListener("click", () => iot.setToken(""));

  el.calcKeys.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (b) pressCalcKey(b.dataset.k);
  });

  el.camBtn.addEventListener("click", () => (vision.cameraOn ? vision.stop() : vision.start()));
  el.motionBtn.addEventListener("click", () => {
    if (!vision.cameraOn) toast(tr("toast.needCamMotion"));
    vision.setFeature("motion", !vision.isEnabled("motion"));
  });
  el.guardBtn.addEventListener("click", () => {
    if (!vision.cameraOn) toast(tr("toast.needCamGuard"));
    setGuard(!guard.armed);
  });
  el.snapBtn.addEventListener("click", () => { if (!takeSnapshot("manual")) toast(tr("toast.camNotOn")); });
  el.camView.addEventListener("dblclick", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else el.camView.requestFullscreen?.().catch(() => {});
  });

  document.querySelectorAll(".switch").forEach((sw) => {
    sw.addEventListener("change", async () => {
      const r = await vision.setFeature(sw.dataset.feature, sw.checked);
      if (!r.ok) syncSwitches();
    });
  });
  el.qualitySelect.addEventListener("change", () => vision.setQuality(el.qualitySelect.value));
  el.sensRange.addEventListener("input", () => {
    vision.setSensitivity(el.sensRange.value);
    el.sensText.textContent = `${el.sensRange.value}%`;
  });
  const syncOverlay = () => vision.setOverlay({ boxes: el.optBoxes.checked, zones: el.optZones.checked });
  el.optBoxes.addEventListener("change", syncOverlay);
  el.optZones.addEventListener("change", syncOverlay);

  el.stopBtn.addEventListener("click", () => {
    requestId++;
    stopSpeaking();
    voice.stopListening();
    log("SYS", tr("l.voiceStop"), "sys");
  });
  el.emergencyBtn.addEventListener("click", () => {
    emergencyStop();
    respond({ text: tr("cmd.emergency") });
  });
  el.voiceSelect.addEventListener("change", () => {
    if (voice.setVoice(el.voiceSelect.value)) respond({ text: tr("v.updated") });
  });
  window.addEventListener("resize", resizeViz);
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);
  window.addEventListener("pagehide", () => { vision.stop(); voice.shutdownMic(); }); // lepaskan kamera/mic saat tab ditutup
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { requestId++; stopSpeaking(); voice.stopListening(); }
  });
}

function boot() {
  el.boot.classList.add("hidden");
  log("SYS", tr("l.online"), "sys");
  loadVision()
    .then((v) => setStatus(el.libStatus, v.source === "lokal" ? "LOCAL" : "CDN", "ok"))
    .catch((e) => { setStatus(el.libStatus, "ERROR", "err"); showVisionError(e.message); log("SYS", e.message, "sys"); });
  booted = true;
  respond({ text: tr("l.boot", { sal: salutation() }) });
  el.chatInput.focus();
}

function init() {
  initClock();
  renderWeather();
  updateWeather();
  iot.start();
  setInterval(updateWeather, WX_REFRESH_MS);
  window.addEventListener("online", updateWeather);
  updateNet();

  if (!voice.supported.stt) {
    setStatus(el.srStatus, tr("u.srNo"), "err");
    setStatus(el.micStatus, "UNAVAILABLE", "warn");
    el.micBtn.title = tr("v.sttNo");
  } else {
    setStatus(el.srStatus, "SUPPORTED", "ok");
    setStatus(el.micStatus, "READY", "ok");
  }
  if (!voice.supported.tts) {
    el.voiceSelect.innerHTML = `<option>${tr("v.unsupported")}</option>`;
    el.voiceSelect.disabled = true;
    el.voiceNote.textContent = tr("v.textonly");
  }

  // preferensi awal: modul yang menyala saat kamera dihidupkan
  // HP (layar sentuh): modul lebih ringan + kualitas RENDAH secara default agar tidak panas/patah-patah
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  ["hands", "faces", "objects", ...(mobile ? [] : ["pose"])].forEach((f) => vision.setFeature(f, true));
  let q = null;
  try { q = localStorage.getItem("aegis.quality"); } catch { /* abaikan */ }
  vision.setQuality(QUALITY[q] ? q : mobile ? "rendah" : "sedang");
  vision.setSensitivity(el.sensRange.value);
  syncSwitches();
  resetVisionUI();
  updateMotionUI();
  updateLive();

  bindEvents();
  applyLanguage();
  checkAI().then((s) => log("SYS", s.ready ? `AI chatbot: ${s.provider} / ${s.model}` : `AI chatbot off (${s.provider || "?"}: ${s.reason || "server"}) - lihat .env.example`));
  resizeViz();
  initCoreInteraction();
  requestAnimationFrame(renderHolo);
  setState("idle");

  // Browser mewajibkan interaksi pengguna sebelum audio boleh diputar,
  // karena itu AEGIS menunggu tombol INITIALIZE ditekan.
  el.bootBtn.addEventListener("click", boot, { once: true });
}

// PWA: service worker agar bisa di-install ke layar utama (hanya di HTTPS / localhost)
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* abaikan */ }));
}

init();
