// Simulator ESP32 untuk mencoba panel IoT tanpa hardware.
//   node scripts/iot-sim.mjs [URL] [TOKEN]
//   (default: http://127.0.0.1:5500 dan IOT_TOKEN dari .env)
// Meniru: suhu/lembap yang bergerak pelan, PIR acak, kartu RFID tiap ~15 detik, dan membaca perintah relay dari dashboard.
import fs from "node:fs";

let envToken = "";
try { envToken = (fs.readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^\s*IOT_TOKEN\s*=\s*(.*?)\s*$/m) || [])[1] || ""; } catch { /* tanpa .env */ }
const base = (process.argv[2] || "http://127.0.0.1:5500").replace(/\/+$/, "");
const token = process.argv[3] || envToken.replace(/^["']|["']$/g, "");
if (!token) { console.error("Butuh token: isi IOT_TOKEN di .env atau jalankan  node scripts/iot-sim.mjs URL TOKEN"); process.exit(1); }

let temp = 28, hum = 65, pir = false, tick = 0, lamp = "off";
const cards = (process.env.IOT_CARDS || "").split(",").map((c) => c.split(":")[0].trim()).filter(Boolean);

async function report(event) {
  const body = { device: "sim1", readings: { temp: { value: Math.round(temp * 10) / 10, unit: "°C" }, hum: { value: Math.round(hum), unit: "%" }, pir } };
  if (event) body.event = event;
  const res = await fetch(`${base}/api/iot/report`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 100)}`);
  const { outputs } = await res.json();
  if (outputs.lampu && outputs.lampu !== lamp) { lamp = outputs.lampu; console.log(`💡 relay lampu → ${lamp.toUpperCase()}`); }
}

console.log(`Simulator IoT → ${base}  (Ctrl+C untuk berhenti)`);
setInterval(async () => {
  tick++;
  temp += (Math.random() - 0.5) * 0.4; hum += (Math.random() - 0.5) * 1.2;
  hum = Math.min(90, Math.max(35, hum));
  let event = null;
  const wasPir = pir;
  pir = pir ? Math.random() > 0.35 : Math.random() < 0.08;
  if (pir && !wasPir) event = { type: "motion" };
  if (tick % 7 === 0) event = { type: "rfid", uid: cards.length && Math.random() < 0.7 ? cards[Math.floor(Math.random() * cards.length)] : "DEADBEEF" };
  try { await report(event); if (event) console.log("→ event", JSON.stringify(event)); } catch (e) { console.error("gagal:", e.message); }
}, 2000);
