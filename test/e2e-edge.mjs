import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

// Uji end-to-end: Edge/Chrome headless + webcam virtual. Butuh server berjalan di :5500 (npm run dev).`n// Jalankan: npm run test:e2e   (opsional: set BROWSER=path\ke\browser.exe)`nconst EDGE = process.env.BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
setTimeout(() => { console.log('WATCHDOG: timeout 200s'); try { proc.kill(); } catch {} process.exit(2); }, 200000);
const proc = spawn(EDGE, [
  "--headless=new", "--remote-debugging-port=9334", "--no-first-run", "--disable-gpu",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  "--user-data-dir=" + process.env.TEMP + "\\aegis-e2e2", "about:blank",
], { stdio: "ignore" });

let ws, id = 0;
const pending = new Map();
const logs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
const evalJS = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); if (targets.length) break; } catch {} await sleep(500); }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) logs.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    else if (d.method === "Runtime.exceptionThrown") logs.push("EXC: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: "http://localhost:5500/index.html?cpu=1" });
  await sleep(3000);

  const txt = (sel) => `document.querySelector(${JSON.stringify(sel)})?.textContent`;
  const cmd = async (text, wait = 2500) => {
    await evalJS(`(()=>{const i=document.getElementById('chatInput');i.value=${JSON.stringify(text)};document.getElementById('chatForm').requestSubmit();})()`);
    await sleep(wait);
    return await evalJS(`document.getElementById('aegisText').textContent`);
  };
  const snap = () => evalJS(`JSON.stringify({cam:document.getElementById('camStatus').textContent, camLive:!document.getElementById('camLive').hidden, lib:document.getElementById('libStatus').textContent, engine:document.getElementById('engineStatus').textContent, hands:document.getElementById('st-hands').textContent, objects:document.getElementById('st-objects').textContent, faces:document.getElementById('st-faces').textContent, pose:document.getElementById('st-pose').textContent, motion:document.getElementById('st-motion').textContent, fps:document.getElementById('fpsText').textContent, motionBadge:document.getElementById('motionBadge').textContent, motionEvents:document.getElementById('motionEvents').textContent, vcError:document.getElementById('vcError').hidden?'':document.getElementById('vcError').textContent})`);

  await evalJS(`document.getElementById('bootBtn').click()`);
  await sleep(2500);
  console.log("BOOT   ", await evalJS(`document.getElementById('aegisText').textContent`));
  console.log("LIB    ", await evalJS(txt("#libStatus")));

  console.log("\n> aktifkan deteksi gerakan (kamera mati)");
  console.log("  ->", await cmd("Jarvis, aktifkan deteksi gerakan."));
  console.log("> aktifkan kamera");
  console.log("  ->", await cmd("Jarvis, aktifkan kamera.", 9000));
  console.log("  ", await snap());
  console.log("> aktifkan deteksi gerakan");
  console.log("  ->", await cmd("Jarvis, aktifkan deteksi gerakan."));
  console.log("> aktifkan pose");
  console.log("  ->", await cmd("aktifkan deteksi pose tubuh", 6000));
  console.log("> hand tracking");
  console.log("  ->", await cmd("Jarvis, aktifkan hand tracking."));
  console.log("> deteksi objek");
  console.log("  ->", await cmd("Jarvis, deteksi objek.", 5000));
  await sleep(4000);
  console.log("  ", await snap());
  console.log("> apa yang kamu lihat");
  console.log("  ->", await cmd("Jarvis, apa yang kamu lihat?"));
  console.log("> apakah ada orang");
  console.log("  ->", await cmd("Jarvis, apakah ada orang?"));
  console.log("> kualitas tinggi");
  console.log("  ->", await cmd("kualitas deteksi tinggi"));
  await sleep(3000);
  console.log("  ", await snap());
  console.log("> ambil foto");
  console.log("  ->", await cmd("ambil foto"));
  console.log("> hentikan vision system");
  console.log("  ->", await cmd("Jarvis, hentikan vision system."));
  console.log("  ", await snap());
  console.log("> matikan kamera (sudah mati)");
  console.log("  ->", await cmd("Jarvis, matikan kamera."));
  console.log("> aktifkan kamera lagi + emergency");
  await cmd("aktifkan kamera", 4000);
  await evalJS(`document.getElementById('emergencyBtn').click()`);
  await sleep(1500);
  console.log("  ", await snap());
  console.log("\nCONSOLE ERRORS/WARNINGS:", logs.length ? "\n" + logs.join("\n") : "none");
} catch (e) {
  console.log("E2E FAILED:", e.message, "\n", logs.join("\n"));
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  process.exit(0);
}

