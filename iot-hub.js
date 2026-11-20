// Jembatan IoT A.E.G.I.S. (tanpa dependency): ESP32 melapor lewat HTTPS, dashboard membaca status dan mengirim perintah.
//
//  ESP32 ──POST /api/iot/report──▶ server ◀──GET /api/iot/state (polling)── dashboard AEGIS
//          ◀── balasan: {outputs}      ▲──POST /api/iot/command── dashboard (nyalakan lampu, dll)
//
// Semua endpoint memakai token rahasia: header  Authorization: Bearer <IOT_TOKEN>.
// Tanpa IOT_TOKEN di .env, seluruh fitur IoT nonaktif (semua endpoint membalas 503).
import crypto from "node:crypto";

const MAX_EVENTS = 100;
const OFFLINE_MS = 15000; // perangkat dianggap offline bila tidak melapor selama ini
const NAME_RE = /^[a-z0-9_-]{1,24}$/i;

/** Perbandingan token tanpa bocor lewat waktu. */
export function tokenOk(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** "04A1B2C3:Budi,0511AA22:Ani" → Map(UID → nama) */
export function parseCards(str = "") {
  const m = new Map();
  for (const part of String(str).split(",")) {
    const [uid, ...name] = part.split(":");
    if (uid && name.length) m.set(uid.trim().toUpperCase(), name.join(":").trim().slice(0, 40));
  }
  return m;
}

const clean = (s, n = 40) => String(s ?? "").replace(/[^\p{L}\p{N} _.:%°\-]/gu, "").slice(0, n);

export function createHub({ cards = new Map(), now = () => Date.now() } = {}) {
  const sensors = {};   // nama → {value, unit, at, device}
  const devices = {};   // id → {lastSeen}
  const outputs = {};   // nama → "on" | "off" (kondisi yang DIMINTA dashboard)
  const events = [];
  let nextId = 1;

  function pushEvent(e) {
    events.push({ id: nextId++, at: now(), ...e });
    if (events.length > MAX_EVENTS) events.shift();
  }

  return {
    /** Laporan dari perangkat. body: {device, readings?:{nama:nilai|{value,unit}}, event?:{type, ...}} */
    report(body) {
      const device = clean(body?.device, 24);
      if (!NAME_RE.test(device)) throw Object.assign(new Error("device tidak valid"), { status: 400 });
      devices[device] = { lastSeen: now() };
      for (const [name, v] of Object.entries(body.readings || {})) {
        if (!NAME_RE.test(name)) continue;
        const value = typeof v === "object" && v ? v.value : v;
        if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string") continue;
        sensors[name] = { value: typeof value === "string" ? value.slice(0, 40) : value, unit: clean(v?.unit, 6), at: now(), device };
      }
      const ev = body.event;
      if (ev && typeof ev === "object" && NAME_RE.test(String(ev.type || ""))) {
        const out = { type: ev.type, device };
        if (ev.type === "rfid") {
          const uid = clean(ev.uid, 20).replace(/\s/g, "").toUpperCase();
          out.uid = uid;
          out.name = cards.get(uid) || null;
        } else if (ev.detail !== undefined) out.detail = clean(ev.detail, 60);
        pushEvent(out);
      }
      return { ok: true, outputs: { ...outputs } };
    },

    /** Perintah dari dashboard ke perangkat, mis. {target:"lampu", state:"on"}. */
    command({ target, state }) {
      if (!NAME_RE.test(String(target || "")) || !["on", "off"].includes(state)) throw Object.assign(new Error("perintah tidak valid"), { status: 400 });
      outputs[target] = state;
      pushEvent({ type: "command", detail: `${target} ${state}` });
      return { ok: true, outputs: { ...outputs } };
    },

    /** Status untuk dashboard; since = id event terakhir yang sudah diterima klien. */
    state(since = 0) {
      const t = now();
      return {
        now: t,
        devices: Object.fromEntries(Object.entries(devices).map(([id, d]) => [id, { lastSeen: d.lastSeen, online: t - d.lastSeen < OFFLINE_MS }])),
        sensors,
        outputs: { ...outputs },
        events: events.filter((e) => e.id > since),
        lastEventId: nextId - 1,
      };
    },
  };
}
