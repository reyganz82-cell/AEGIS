// Antarmuka suara AEGIS: Speech Synthesis (suara pria Bahasa Indonesia bila tersedia)
// dan Speech Recognition model push-to-talk (tahan tombol/Spasi → bicara → lepas → diproses).
//
// hooks: onListening(bool) · onInterim(text) · onFinal(text) · onError(message, code)
//        onVoices(list, selected, info{male, indonesian, name})
import { CONFIG } from "./config.js";
import { t } from "./i18n.js";

const MALE_RE = /ardi|andika|rizki|pria|laki|\bmale\b|david|mark\b|george|daniel|james|guy/i;
const FEMALE_RE = /gadis|damayanti|female|wanita|perempuan|zira|hazel|susan|samantha/i;

export const isMaleVoice = (v) => MALE_RE.test(v.name) && !FEMALE_RE.test(v.name);

/** Skor pemilihan suara: bahasa aktif dulu (default Indonesia), lalu pria, lalu kualitas (natural/online). */
export function rankVoice(v, prefix = "id") {
  let s = 0;
  if (new RegExp(`^${prefix}(-|_|$)`, "i").test(v.lang)) s += 100;
  if (isMaleVoice(v)) s += 60;
  if (FEMALE_RE.test(v.name)) s -= 40;
  if (/natural|online/i.test(v.name)) s += 15;
  if (/google/i.test(v.name)) s += 5;
  return s;
}

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

const SR_KNOWN = ["not-allowed", "service-not-allowed", "no-speech", "audio-capture", "network"];
const srError = (code) => (SR_KNOWN.includes(code) ? t(`sr.${code}`) : t("sr.generic", { e: code }));
const prefixOf = (l) => String(l).slice(0, 2).toLowerCase();

export function createVoiceAssistant({ lang = CONFIG.lang, hooks = {} } = {}) {
  const emit = (n, ...a) => { try { hooks[n]?.(...a); } catch (e) { console.error(`[voice ${n}]`, e); } };

  // =============================================================== TTS
  const voice = { list: [], selected: null };
  let current = null;       // utterance aktif — referensi disimpan agar tidak di-GC (bug Chrome)
  let fallbackTimer = null;
  let watchdog = null;

  function voiceInfo() {
    const v = voice.selected;
    const match = v ? new RegExp(`^${prefixOf(lang)}`, "i").test(v.lang) : false;
    return { name: v?.name || "", male: v ? isMaleVoice(v) : false, match, indonesian: match };
  }

  // kunci penyimpanan per bahasa; kunci lama "aegis.voice" tetap dipakai untuk Indonesia
  const voiceKey = () => (prefixOf(lang) === "id" ? "aegis.voice" : `aegis.voice.${prefixOf(lang)}`);

  function loadVoices() {
    if (!synth) return;
    const list = synth.getVoices();
    if (!list.length) return;
    const pref = prefixOf(lang);
    voice.list = [...list].sort((a, b) => rankVoice(b, pref) - rankVoice(a, pref));
    let saved = null;
    try { saved = localStorage.getItem(voiceKey()); } catch { /* storage tidak tersedia */ }
    voice.selected = voice.list.find((v) => v.name === saved) || voice.list[0];
    emit("onVoices", voice.list, voice.selected, voiceInfo());
  }

  function setVoice(name) {
    const v = voice.list.find((x) => x.name === name);
    if (!v) return false;
    voice.selected = v;
    try { localStorage.setItem(voiceKey(), v.name); } catch { /* abaikan */ }
    emit("onVoices", voice.list, voice.selected, voiceInfo());
    return true;
  }

  /** Ganti bahasa pengenalan & suara (mis. "en-US"): rec.lang diperbarui, suara diurut ulang per bahasa. */
  function setLang(next) {
    if (next === lang) return;
    lang = next;
    if (st.rec) {
      stopListening();
      st.rec = null; // dibuat ulang dengan bahasa baru saat tombol bicara ditekan berikutnya
    }
    cancel();
    loadVoices();
  }

  /**
   * Ucapkan teks. cb: onStart() · onBoundary(charIndex, charLength) · onEnd({cancelled})
   * Tanpa Speech Synthesis, onStart/onEnd tetap dipanggil dengan estimasi durasi agar UI konsisten.
   */
  function speak(text, cb = {}) {
    stopListening();
    cancel();
    let ended = false;
    let u = null;
    const finish = (cancelled = false) => {
      if (ended) return;
      ended = true;
      clearInterval(watchdog); clearTimeout(fallbackTimer);
      if (current === u) current = null;
      cb.onEnd?.({ cancelled });
    };

    if (!synth) {
      u = { finish };
      current = u;
      cb.onStart?.();
      fallbackTimer = setTimeout(() => finish(false), Math.max(1500, text.length * 60));
      return;
    }

    u = new SpeechSynthesisUtterance(text);
    u.lang = voice.selected?.lang || lang;
    if (voice.selected) u.voice = voice.selected;
    u.rate = CONFIG.speech.rate;
    u.pitch = voiceInfo().male ? CONFIG.speech.pitchMale : CONFIG.speech.pitchFallback; // nada rendah bila bukan suara pria
    u._finish = finish;
    current = u;

    u.onstart = () => cb.onStart?.();
    u.onboundary = (e) => cb.onBoundary?.(e.charIndex, e.charLength, e.name);
    u.onend = () => finish(false);
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") emit("onError", t("tts.err", { e: e.error }), "tts");
      finish(true);
    };
    setTimeout(() => synth.speak(u), 60); // jeda kecil setelah cancel() agar utterance tidak terbuang di Chrome

    const startedAt = Date.now();
    let started = false;
    watchdog = setInterval(() => { // jaga-jaga bila onend tidak pernah terpanggil
      if (synth.speaking) started = true;
      else if (started || Date.now() - startedAt > 4000) finish(false);
    }, 300);
  }

  function cancel() {
    const u = current;
    synth?.cancel();
    clearInterval(watchdog); clearTimeout(fallbackTimer);
    if (u) (u._finish || u.finish)?.(true);
    current = null;
  }

  // =============================================================== STT (push-to-talk)
  const st = { rec: null, held: false, listening: false, finalText: "", interim: "", denied: false, errored: false, suppress: false };
  const meter = { stream: null, ctx: null, analyser: null, data: null, gen: 0 };

  function initRecognition() {
    if (!SR) return false;
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true; // tetap mendengar selama tombol ditahan
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      st.listening = true;
      if (!st.held) { try { rec.stop(); } catch { /* sudah berhenti */ } return; } // tombol dilepas sebelum mulai
      emit("onListening", true);
      startMeter();
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) st.finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      st.interim = interim;
      emit("onInterim", (st.finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      st.errored = true;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") st.denied = true;
      if (e.error !== "no-speech") emit("onError", srError(e.error), e.error);
      else if (!st.finalText) emit("onError", srError("no-speech"), "no-speech");
    };
    rec.onend = () => {
      st.listening = false;
      if (st.held && !st.errored && !st.suppress) { // engine berhenti sendiri saat tombol masih ditahan → lanjutkan
        try { rec.start(); return; } catch { /* lanjut ke penyelesaian */ }
      }
      stopMeter();
      emit("onListening", false);
      const said = (st.finalText + st.interim).trim();
      st.finalText = ""; st.interim = "";
      const suppressed = st.suppress;
      st.suppress = false; st.held = false; st.errored = false;
      if (said && !suppressed) emit("onFinal", said);
    };
    st.rec = rec;
    return true;
  }

  function pressTalk() {
    if (!st.rec && !initRecognition()) {
      emit("onError", t("sr.unsupported"), "unsupported");
      return false;
    }
    if (st.held) return true;
    cancel(); // hentikan ucapan AEGIS agar tidak terekam mikrofon
    st.held = true; st.finalText = ""; st.interim = ""; st.errored = false; st.denied = false; st.suppress = false;
    try { st.rec.start(); } catch { /* sudah berjalan */ }
    return true;
  }

  function releaseTalk() {
    if (!st.held) return;
    st.held = false;
    if (st.listening) { try { st.rec.stop(); } catch { /* abaikan */ } }
    // bila belum sempat mulai, onstart akan langsung menghentikan sendiri
  }

  function stopListening() {
    if (st.rec && (st.listening || st.held)) { st.suppress = true; st.held = false; try { st.rec.abort(); } catch { /* abaikan */ } }
  }

  /** Matikan mikrofon sepenuhnya (dipakai Emergency Stop): tanpa memproses sisa ucapan. */
  function shutdownMic() {
    stopListening();
    stopMeter();
    emit("onListening", false);
  }

  // =============================================================== visualizer mic
  async function startMeter() {
    const gen = ++meter.gen;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen !== meter.gen || !st.listening) { stream.getTracks().forEach((t) => t.stop()); return; }
      meter.stream = stream;
      meter.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = meter.ctx.createMediaStreamSource(stream);
      meter.analyser = meter.ctx.createAnalyser();
      meter.analyser.fftSize = 128;
      meter.data = new Uint8Array(meter.analyser.frequencyBinCount);
      src.connect(meter.analyser);
    } catch { /* hanya visualizer yang terdampak; pengenalan suara tetap berjalan */ }
  }

  function stopMeter() {
    meter.gen++;
    meter.stream?.getTracks().forEach((t) => t.stop());
    meter.ctx?.close().catch(() => {});
    meter.stream = meter.ctx = meter.analyser = meter.data = null;
  }

  /** Data frekuensi mic untuk visualizer, atau null bila tidak mendengarkan. */
  function getFreq() {
    if (!meter.analyser) return null;
    meter.analyser.getByteFrequencyData(meter.data);
    return meter.data;
  }

  // =============================================================== init
  if (synth) {
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
  }

  return {
    speak, cancel, setVoice, setLang, pressTalk, releaseTalk, stopListening, shutdownMic, getFreq,
    get supported() { return { tts: !!synth, stt: !!SR }; },
    get voices() { return voice.list; },
    get selectedVoice() { return voice.selected; },
    get listening() { return st.listening; },
    get micOpen() { return !!meter.stream || st.listening; },
    get denied() { return st.denied; },
    voiceInfo,
  };
}
