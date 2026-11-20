// Klien IoT di browser: polling status dari server AEGIS (/api/iot/*) dan kirim perintah ke perangkat.
// Token disimpan di localStorage browser ini saja. Modul daun: tidak mengimpor modul lain.
//
// hooks: onState(state) · onEvent(event) · onAuth("ok"|"missing"|"bad"|"disabled"|"offline")

const KEY = "aegis.iot.token";
const POLL_MS = 2000;

export function createIot({ hooks = {}, fetchFn = (...a) => fetch(...a) } = {}) {
  const emit = (n, ...a) => { try { hooks[n]?.(...a); } catch (e) { console.error(`[iot ${n}]`, e); } };
  let token = "";
  try { token = localStorage.getItem(KEY) || ""; } catch { /* abaikan */ }
  let timer = null, lastId = null, authState = token ? "ok" : "missing", state = null, busy = false;

  const setAuth = (a) => { if (a !== authState) { authState = a; emit("onAuth", a); } };
  const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  async function poll() {
    if (!token || busy) return;
    busy = true;
    try {
      const res = await fetchFn(`/api/iot/state?since=${lastId ?? 0}`, { headers: headers(), cache: "no-store" });
      if (res.status === 401) { setAuth("bad"); stop(); return; }
      if (res.status === 503) { setAuth("disabled"); stop(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAuth("ok");
      const first = lastId === null;
      lastId = data.lastEventId;
      state = data;
      emit("onState", data);
      if (!first) data.events.forEach((e) => emit("onEvent", e)); // jangan membacakan riwayat lama saat pertama terhubung
    } catch {
      setAuth("offline");
    } finally { busy = false; }
  }

  function start() {
    if (timer || !token) return;
    poll();
    timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }
  function stop() { clearInterval(timer); timer = null; }

  return {
    start, stop,
    setToken(t) {
      token = String(t || "").trim();
      try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch { /* abaikan */ }
      lastId = null; state = null;
      stop();
      setAuth(token ? "ok" : "missing");
      start();
    },
    /** Kirim perintah ke perangkat, mis. command("lampu", "on"). */
    async command(target, value) {
      if (!token) return { ok: false, error: "no-token" };
      try {
        const res = await fetchFn("/api/iot/command", { method: "POST", headers: headers(), body: JSON.stringify({ target, state: value }) });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        poll();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    get auth() { return authState; },
    get state() { return state; },
    get hasToken() { return !!token; },
    /** Perangkat mana pun yang melapor dalam 15 detik terakhir. */
    get online() { return !!state && Object.values(state.devices).some((d) => d.online); },
    sensor(name) { return state?.sensors?.[name]?.value; },
  };
}
