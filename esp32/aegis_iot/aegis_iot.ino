/*
  A.E.G.I.S. IoT node — ESP32-C3
  Sensor: PIR, RFID RC522, DHT22 (suhu+lembap), reed switch pintu, relay (lampu).
  Matikan yang tidak kamu punya dengan mengubah ENABLE_xxx menjadi 0.

  ── Library (Arduino IDE → Library Manager) ──
    ArduinoJson (Benoit Blanchon) v7  ·  MFRC522 (GithubCommunity)  ·  DHT sensor library (Adafruit) + Adafruit Unified Sensor
  ── Board ──
    Arduino IDE → Tools → Board: "ESP32C3 Dev Module" · USB CDC On Boot: "Enabled" (agar Serial Monitor jalan & GPIO20/21 bebas)

  ── Kabel (nomor = GPIO ESP32-C3) ──
    RC522  : SDA→7  SCK→4  MOSI→6  MISO→5  RST→10  3.3V→3V3  GND→GND      ⚠ RC522 HANYA 3.3V, jangan 5V
    PIR    : OUT→3   VCC→5V (pin 5V/VBUS)   GND→GND                      (HC-SR501 butuh 5V; sinyalnya 3.3V, aman)
    DHT22  : DATA→1  VCC→3V3  GND→GND   (modul 3-pin sudah ada resistor pull-up)
    Reed   : satu kaki→0, kaki lain→GND   (pintu tertutup = magnet dekat = sambung)
    Relay  : IN→20   VCC→5V   GND→GND   (untuk demo pakai LED + resistor atau buzzer 5V; JANGAN listrik 220V kalau belum paham)

  Data dikirim tiap ~2 detik ke  SERVER_URL/api/iot/report  dengan header  Authorization: Bearer IOT_TOKEN.
  Balasan server berisi perintah dari dashboard, mis. {"outputs":{"lampu":"on"}}.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ───────────── PENGATURAN ─────────────
#define WIFI_SSID   "NAMA_WIFI"
#define WIFI_PASS   "PASSWORD_WIFI"
#define SERVER_URL  "https://nama-app-kamu.onrender.com"   // tanpa "/" di akhir. Lokal: "http://192.168.1.10:5500" + USE_HTTPS 0
#define IOT_TOKEN   "SAMA_DENGAN_IOT_TOKEN_DI_SERVER"
#define DEVICE_ID   "esp1"
#define USE_HTTPS   1
#define REPORT_MS   2000

#define ENABLE_PIR   1
#define ENABLE_RFID  1
#define ENABLE_DHT   1
#define ENABLE_REED  0
#define ENABLE_RELAY 1

#define PIN_PIR   3
#define PIN_DHT   1
#define PIN_REED  0
#define PIN_RELAY 20
#define RELAY_ACTIVE_LOW 0          // modul relay "active low" → ubah ke 1
#define RFID_SS   7
#define RFID_RST  10
#define SPI_SCK   4
#define SPI_MISO  5
#define SPI_MOSI  6
// ───────────────────────────────────────

#if ENABLE_RFID
  #include <SPI.h>
  #include <MFRC522.h>
  MFRC522 rfid(RFID_SS, RFID_RST);
#endif
#if ENABLE_DHT
  #include <DHT.h>
  DHT dht(PIN_DHT, DHT22);
#endif

#if USE_HTTPS
  WiFiClientSecure netClient;   // setInsecure(): enkripsi aktif, tapi sertifikat server tidak diverifikasi (cukup untuk rumah)
#else
  WiFiClient netClient;
#endif

struct Ev { char type[12]; char arg[24]; };
Ev queue[6];
int queueN = 0;
unsigned long lastReport = 0, lastCardAt = 0;
bool lastPir = false, lastDoorOpen = false;
String lastUid = "";

void pushEvent(const char *type, const char *arg) {
  if (queueN >= 6) return;
  strncpy(queue[queueN].type, type, 11); queue[queueN].type[11] = 0;
  strncpy(queue[queueN].arg, arg ? arg : "", 23); queue[queueN].arg[23] = 0;
  queueN++;
}

void setRelay(bool on) {
#if ENABLE_RELAY
  digitalWrite(PIN_RELAY, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
#endif
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("WiFi menyambung");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK " + WiFi.localIP().toString() : " gagal, coba lagi nanti");
}

void pollInputs() {
#if ENABLE_PIR
  bool p = digitalRead(PIN_PIR);
  if (p && !lastPir) pushEvent("motion", "");
  lastPir = p;
#endif
#if ENABLE_REED
  bool open = digitalRead(PIN_REED) == HIGH;   // INPUT_PULLUP: terbuka = HIGH
  if (open != lastDoorOpen) pushEvent("door", open ? "open" : "closed");
  lastDoorOpen = open;
#endif
#if ENABLE_RFID
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uid;
    for (byte i = 0; i < rfid.uid.size; i++) { char b[3]; sprintf(b, "%02X", rfid.uid.uidByte[i]); uid += b; }
    if (uid != lastUid || millis() - lastCardAt > 3000) {   // cegah satu tap terbaca berkali-kali
      pushEvent("rfid", uid.c_str());
      lastUid = uid; lastCardAt = millis();
    }
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }
#endif
}

void sendReport() {
  if (WiFi.status() != WL_CONNECTED) return;
  JsonDocument doc;
  doc["device"] = DEVICE_ID;
  JsonObject r = doc["readings"].to<JsonObject>();
#if ENABLE_DHT
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (!isnan(t)) { r["temp"]["value"] = round(t * 10) / 10.0; r["temp"]["unit"] = "°C"; }
  if (!isnan(h)) { r["hum"]["value"] = round(h); r["hum"]["unit"] = "%"; }
#endif
#if ENABLE_PIR
  r["pir"] = lastPir;
#endif
#if ENABLE_REED
  r["door"] = lastDoorOpen;
#endif
  if (queueN > 0) {   // kirim satu kejadian per laporan (urutan tetap), sisanya langsung menyusul
    JsonObject ev = doc["event"].to<JsonObject>();
    ev["type"] = queue[0].type;
    ev[strcmp(queue[0].type, "rfid") == 0 ? "uid" : "detail"] = queue[0].arg;
  }
  String body; serializeJson(doc, body);

  HTTPClient http;
  http.setReuse(true);
  http.setTimeout(6000);
  if (!http.begin(netClient, String(SERVER_URL) + "/api/iot/report")) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + IOT_TOKEN);
  int code = http.POST(body);
  if (code == 200) {
    if (queueN > 0) { for (int i = 1; i < queueN; i++) queue[i - 1] = queue[i]; queueN--; }
    JsonDocument resp;
    if (!deserializeJson(resp, http.getString())) {
      const char *lampu = resp["outputs"]["lampu"];
      if (lampu) setRelay(strcmp(lampu, "on") == 0);
    }
  } else {
    Serial.printf("Laporan gagal: HTTP %d%s\n", code, code == 401 ? " (token salah)" : "");
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
#if ENABLE_PIR
  pinMode(PIN_PIR, INPUT);
#endif
#if ENABLE_REED
  pinMode(PIN_REED, INPUT_PULLUP);
  lastDoorOpen = digitalRead(PIN_REED) == HIGH;
#endif
#if ENABLE_RELAY
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(false);
#endif
#if ENABLE_DHT
  dht.begin();
#endif
#if ENABLE_RFID
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, RFID_SS);
  rfid.PCD_Init();
#endif
#if USE_HTTPS
  netClient.setInsecure();
#endif
  ensureWifi();
}

void loop() {
  ensureWifi();
  pollInputs();
  if (queueN > 0 || millis() - lastReport >= REPORT_MS) {
    sendReport();
    lastReport = millis();
  }
  delay(20);
}
