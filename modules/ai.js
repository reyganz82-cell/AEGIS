// Klien chatbot AI: memanggil /api/chat di server.js, menyimpan riwayat percakapan.
import { getLang } from "./i18n.js";

const MAX_TURNS = 12;
let history = [];
let status = null; // null = belum dicek, {ready, provider, model}

// Kosong = server yang sama (npm run dev / Render). Di Firebase, isi <meta name="aegis-api"> dengan URL Worker.
const API = (typeof document !== "undefined" && document.querySelector('meta[name="aegis-api"]')?.content?.trim().replace(/\/+$/, "")) || "";

export function resetChat() { history = []; }
export function getHistory() { return history.slice(); }

export async function checkAI(fetchFn = fetch) {
  try {
    const r = await fetchFn(`${API}/api/health`,{ cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    status = j && j.ok ? j : { ready: false };
  } catch { status = { ready: false }; }
  return status;
}

export const aiStatus = () => status;

/** Mengembalikan teks jawaban, atau null bila AI tidak tersedia (pemanggil memakai fallback lokal). */
export async function askAI(text, { signal, context = "", fetchFn = fetch } = {}) {
  if (!status || !status.ready) await checkAI(fetchFn); // cek ulang (mis. Ollama baru dinyalakan)
  if (!status.ready) return null;
  const messages = [...history, { role: "user", content: text }];
  try {
    const r = await fetchFn(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, lang: getLang(), context }),
      signal,
    });
    if (!r.ok) return null;
    const { text: answer } = await r.json();
    if (!answer) return null;
    history = [...messages, { role: "assistant", content: answer }].slice(-MAX_TURNS);
    return answer;
  } catch { return null; }
}
