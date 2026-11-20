import test from "node:test";
import assert from "node:assert/strict";
import { createHub, tokenOk, parseCards } from "../iot-hub.js";
import { createServer } from "../server.js";

test("tokenOk: hanya token yang sama persis", () => {
  assert.equal(tokenOk("rahasia", "rahasia"), true);
  assert.equal(tokenOk("salah", "rahasia"), false);
  assert.equal(tokenOk("", "rahasia"), false);
  assert.equal(tokenOk("x", ""), false);
  assert.equal(tokenOk(undefined, "rahasia"), false);
});

test("parseCards: UID → nama", () => {
  const m = parseCards("04a1b2c3:Budi, 0511AA22:Ani Putri");
  assert.equal(m.get("04A1B2C3"), "Budi");
  assert.equal(m.get("0511AA22"), "Ani Putri");
  assert.equal(parseCards("").size, 0);
});

test("hub: laporan sensor, event RFID dikenal/tak dikenal, perintah relay", () => {
  let t = 1000;
  const hub = createHub({ cards: parseCards("04A1B2C3:Budi"), now: () => t });
  assert.throws(() => hub.report({ device: "bad name!" }), /device/);

  let r = hub.report({ device: "esp1", readings: { temp: { value: 28.5, unit: "C" }, pir: false, "x y": 1, junk: { a: 1 } } });
  assert.deepEqual(r.outputs, {});
  hub.report({ device: "esp1", event: { type: "rfid", uid: "04 a1 b2 c3" } });
  hub.report({ device: "esp1", event: { type: "rfid", uid: "FFFF" } });
  hub.report({ device: "esp1", event: { type: "motion" } });

  let s = hub.state(0);
  assert.equal(s.sensors.temp.value, 28.5);
  assert.equal(s.sensors.pir.value, false);
  assert.equal(s.sensors["x y"], undefined);
  assert.equal(s.sensors.junk, undefined);
  assert.equal(s.devices.esp1.online, true);
  assert.deepEqual(s.events.map((e) => e.type), ["rfid", "rfid", "motion"]);
  assert.equal(s.events[0].name, "Budi");
  assert.equal(s.events[1].name, null);

  // hanya event baru setelah `since`
  assert.equal(hub.state(s.lastEventId).events.length, 0);

  // perintah dari dashboard sampai ke perangkat lewat balasan report berikutnya
  assert.throws(() => hub.command({ target: "lampu", state: "maybe" }), /tidak valid/);
  hub.command({ target: "lampu", state: "on" });
  assert.deepEqual(hub.report({ device: "esp1" }).outputs, { lampu: "on" });

  t += 20000; // perangkat berhenti melapor
  assert.equal(hub.state(0).devices.esp1.online, false);
});

test("API IoT: tanpa/dengan token yang salah ditolak, token benar diterima", async () => {
  process.env.IOT_TOKEN = "tok123";
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const h = { Authorization: "Bearer tok123", "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/iot/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/iot/state`, { headers: { Authorization: "Bearer nope" } })).status, 401);
    const rep = await fetch(`${base}/api/iot/report`, { method: "POST", headers: h, body: JSON.stringify({ device: "esp1", readings: { temp: 27 } }) });
    assert.equal(rep.status, 200);
    const st = await (await fetch(`${base}/api/iot/state`, { headers: h })).json();
    assert.equal(st.sensors.temp.value, 27);
    delete process.env.IOT_TOKEN;
    assert.equal((await fetch(`${base}/api/iot/state`, { headers: h })).status, 503);
  } finally { s.close(); delete process.env.IOT_TOKEN; }
});