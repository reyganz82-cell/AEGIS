# A.E.G.I.S. — Full Vision System v2.0

Asisten AI pribadi di browser: melihat lewat webcam, mengenali gestur tangan dan objek, mendeteksi manusia dan gerakan,
memahami pose tubuh, serta berbicara dengan suara pria Bahasa Indonesia. Semua pemrosesan vision berjalan **lokal di browser**.

## 1. Instalasi

Butuh Node.js 18+ dan Chrome atau Edge (untuk pengenalan suara).

```bash
npm install        # memasang @mediapipe/tasks-vision ke node_modules/
npm run setup      # mengunduh 4 model AI ke models/ (~22 MB, sekali saja)
npm test           # (opsional) uji logika perintah suara, deteksi gerakan, pose
```

Setelah `npm run setup`, AEGIS tidak membutuhkan internet untuk vision. Pengenalan suara Chrome/Edge tetap memakai layanan online browser.
Jika `node_modules/` atau `models/` tidak ada, AEGIS otomatis mencoba CDN jsdelivr dan Google Storage sebagai cadangan.

## 2. Menjalankan

**VS Code Live Server:** klik kanan `index.html` → *Open with Live Server* (alamat `http://127.0.0.1:5500`).
**Atau:** `npm run dev` (membuka `http://localhost:5500`).

Jangan membuka `index.html` langsung dengan klik dua kali (`file://`). ES module dan kamera tidak berfungsi di sana.

## 3. Izin kamera dan mikrofon

1. Tekan **INITIALIZE SYSTEM**, lalu tombol **CAMERA** (atau katakan "aktifkan kamera").
2. Browser menampilkan popup izin kamera → **Izinkan**.
3. Jika sudah terlanjur memblokir: klik ikon gembok di address bar → *Kamera/Mikrofon* → **Izinkan** → muat ulang halaman.
4. Kamera hanya jalan di `localhost`, `127.0.0.1`, atau HTTPS.
5. Jika muncul "IN USE", tutup aplikasi lain yang memakai webcam (Zoom, Teams, dll).

Indikator **● CAMERA LIVE** (merah) di header dan **● LIVE** di layar kamera menyala selama kamera aktif.
**● MIC LIVE** menyala saat mikrofon mendengarkan.

## 4. Cara berbicara (Push-to-Talk)

**Tahan** tombol **HOLD TO TALK** atau tombol **Spasi** (saat kursor tidak di kolom ketik) → bicara → **lepas** untuk mengirim.
Mikrofon hanya terbuka selama ditahan.

Perintah suara. Awalan "Jarvis," atau "AEGIS," boleh dipakai atau dilewatkan:

| Ucapan | Efek |
|---|---|
| "Jarvis, aktifkan kamera" / "matikan kamera" | Menyalakan atau mematikan kamera |
| "aktifkan deteksi gerakan" / "matikan deteksi gerakan" | Motion detection |
| "apa yang kamu lihat?" | Deskripsi objek, wajah, pose, gerakan, pencahayaan |
| "apakah ada orang?" | Menjawab ya/tidak beserta jumlah orang |
| "deteksi objek" | Mengaktifkan pengenalan objek lalu melaporkan hasilnya |
| "aktifkan hand tracking" / "matikan hand tracking" | Pelacakan tangan dan gestur |
| "hentikan vision system" | Mematikan kamera dan seluruh pemrosesan vision |
| "aktifkan deteksi pose tubuh", "aktifkan deteksi wajah" | Modul pose dan wajah |
| "mode jaga" / "matikan alarm" | Alarm, foto, dan klip saat ada gerakan |
| "ambil foto", "laporan gerakan", "kualitas deteksi tinggi/sedang/rendah" | Snapshot, statistik, kualitas |
| "emergency stop" | Penghentian darurat |

AEGIS mengucapkan **konfirmasi** setiap perintah yang berhasil. Jika gagal (izin ditolak, model gagal dimuat, kamera belum aktif),
AEGIS menyebutkan alasannya dan tidak mengonfirmasi sukses. Perintah vision saat kamera mati dijawab "Kamera belum aktif"
dan tidak mengaktifkan apa pun secara diam-diam. Obrolan biasa (jam, tanggal, cuaca, dll.) juga bisa diketik di kolom perintah.

## 5. Vision Control Center

- **Saklar** untuk Hand Tracking, Object Detection, Face Detection, Body Pose, Motion Detection. Statusnya OFF, LOADING, READY, atau ERROR per modul.
- **Kualitas deteksi** (RENDAH, SEDANG, TINGGI): mengatur resolusi kamera, seberapa sering model dijalankan, dan ambang keyakinan.
  Rendah (480p) untuk laptop lemah, tinggi (720p) untuk akurasi terbaik. Pilihan tersimpan di browser.
- **Sensitivitas gerakan**, kotak gerakan, peta zona, FPS, dan indikator pencahayaan.
- **Mode jaga:** saat ada gerakan, AEGIS membunyikan alarm, berkedip merah, mengambil foto, merekam klip (tail 3 detik, maks 30 detik), dan mengucapkan peringatan.
  Opsi "hanya jika ada orang" mengurangi alarm palsu (butuh Object Detection).
- **Emergency Stop** (tombol merah): mematikan kamera, mikrofon, rekaman, mode jaga, dan seluruh loop vision seketika.

## 6. Privasi

- Video diproses di browser lewat MediaPipe (WASM). **Tidak ada gambar atau video yang dikirim ke server mana pun.**
- Snapshot dan klip hanya ada di memori browser; tersimpan ke disk hanya jika Anda mengklik untuk mengunduh.
- Satu-satunya pemakaian jaringan: pengenalan suara bawaan Chrome/Edge (Web Speech API) dan cadangan CDN bila file lokal tidak ada.
- Kamera dan mikrofon dilepas saat tab ditutup.

## 7. Suara pria Bahasa Indonesia

AEGIS memilih suara id-ID, mengutamakan suara pria (Ardi, Andika, dll.). Panel *Voice Module* menampilkan suara yang aktif dan memberi peringatan bila
suara pria Indonesia tidak ada (dalam kasus itu nadanya direndahkan). Untuk memasang:

- **Edge:** biasanya sudah ada "Microsoft Ardi Online (Natural) - Indonesian".
- **Windows:** Pengaturan → Waktu & Bahasa → Bicara → *Kelola suara* → tambahkan Indonesia.
- **Chrome:** memakai suara sistem. Suara "Google Bahasa Indonesia" bersuara wanita dan tidak bisa diubah nadanya.

## 8. Struktur proyek

```
index.html            UI (Vision Control Center, panel, command bar)
style.css             Tema HUD
script.js             Shell aplikasi: UI, log, dashboard, otak percakapan umum, mode jaga,
                      snapshot/klip, visualizer, emergency stop, penghubung voice ↔ vision
modules/
  config.js           Path, URL cadangan, preset kualitas, konstanta
  visionLib.js        Pemuat MediaPipe (lokal → CDN) dan pembuat task (model lokal → CDN, GPU → CPU)
  visionController.js Pemilik kamera dan loop deteksi; status modul, kualitas, penanganan error per modul
  handDetection.js    Hand tracking + gestur (GestureRecognizer) + pemicu sapaan jempol
  faceDetection.js    Deteksi wajah (BlazeFace)
  objectDetection.js  Pengenalan objek (EfficientDet-Lite0, 80 kelas, label Indonesia)
  poseDetection.js    Pose tubuh 33 titik + analisis (tangan terangkat, posisi horizontal, aktivitas)
  humanDetection.js   Menggabungkan objek/wajah/pose menjadi "ada orang?" + deskripsi adegan
  motionDetection.js  Deteksi gerakan frame-differencing (tanpa AI, tanpa internet)
  voiceAssistant.js   Text-to-speech (suara pria id-ID), push-to-talk, mic meter untuk visualizer
  commands.js         Parser perintah suara/teks → aksi dengan konfirmasi suara
models/               Model AI (hasil `npm run setup`)
scripts/              download-models.mjs
test/                 vision.test.mjs (npm test)
```

## 9. Pemecahan masalah

| Gejala | Solusi |
|---|---|
| Layar boot menampilkan peringatan merah | Buka lewat Live Server / `npm run dev`, bukan `file://` |
| "Library MediaPipe gagal dimuat" | `npm install`; atau pastikan internet aktif untuk CDN |
| Status modul ERROR | `npm run setup`; atau cek internet. Modul lain tetap berjalan |
| Kamera "DENIED" / "IN USE" | Lihat bagian 3 |
| FPS rendah / laptop panas | Kualitas deteksi → RENDAH; matikan Body Pose dan Face Detection |
| Model berat atau macet di GPU tertentu | Buka dengan `?cpu=1` di URL untuk memaksa CPU |
| "Pengenalan suara membutuhkan internet" | Fitur ini milik Chrome/Edge; ketik perintah sebagai alternatif |
| Spasi tidak memicu mic | Klik di luar kolom ketik dulu, atau tahan tombol HOLD TO TALK |

## 10. Batasan jujur

- Pengenalan objek memakai model ringan (EfficientDet-Lite0): objek kecil atau cahaya buruk bisa meleset.
- Analisis pose adalah heuristik sederhana. "Posisi horizontal" bukan deteksi jatuh yang andal.
- Cuaca di dashboard adalah **data nyata** dari Open-Meteo (tanpa API key). Lokasi diambil dari izin geolokasi browser; bila ditolak, dipakai perkiraan kota dari zona waktu. Hanya koordinat yang dikirim ke Open-Meteo.
- Klip video disimpan di memori browser (maks 8 item di galeri). Unduh klip penting sebelum menutup tab.

## Chatbot AI (gratis)

Pertanyaan di luar perintah bawaan dijawab oleh AI lewat `server.js`.
1. Salin `.env.example` menjadi `.env`, pilih penyedia (`ollama` lokal, atau `groq`/`gemini`/`openrouter` dengan key gratis).
2. Jalankan `npm run dev` (bukan `http-server` lagi), buka http://localhost:5500.
Tanpa AI yang aktif, program tetap memakai jawaban bawaan.

## 11. Deploy (HP + PC)

AEGIS adalah satu server Node (`server.js`) yang menyajikan halaman, model AI, dan proxy chat. Pilih hosting yang menjalankan Node dan memberi **HTTPS**
(Render, Railway, Fly.io, atau VPS + Caddy/Nginx). **HTTPS wajib**: tanpa itu browser HP menolak kamera, mikrofon, dan lokasi. Hosting statis saja (GitHub Pages, dll) tidak cukup karena `/api/chat` butuh server.

1. Unggah proyek (tanpa `node_modules/` dan **tanpa `.env`**; keduanya sudah ada di `.gitignore`). Folder `models/` (~22 MB) ikut diunggah, atau jalankan `npm run setup` saat build.
2. Build command: `npm install`. Start command: `npm start`. (Atau pakai `Dockerfile` yang tersedia.)
3. Isi environment variable di dashboard hosting, **jangan** di file:
   - `AI_PROVIDER=groq` (atau `gemini`/`openrouter`) dan `AI_API_KEY=...`. Jangan pakai `ollama`, karena tidak ada di server hosting.
   - `TRUST_PROXY=1` agar batas laju memakai IP pengunjung asli.
   - Opsional: `CHAT_RATE_PER_MIN=20`.
4. `PORT` dan host diatur otomatis (server mendengarkan `0.0.0.0` saat `PORT` diset). Health check: `/healthz`.

Catatan:
- Chat AI memakai kuota API key milikmu. Server membatasi 20 pesan/menit per IP, tetapi siapa pun yang tahu URL bisa memakainya. Jangan bagikan URL luas bila key berbayar.
- Kamera diproses di browser pengunjung, tidak ada video yang dikirim ke server.
- HP: kualitas otomatis RENDAH dan Body Pose mati secara default (bisa dinyalakan manual). Pengenalan suara (tahan MIC) hanya jalan di Chrome Android; di iPhone/Safari pakai kolom ketik.
- Uji di HP saat development: `http://IP-LAN:5500` hanya menampilkan UI, kamera tetap diblokir (bukan HTTPS). Gunakan tunnel HTTPS (mis. `cloudflared tunnel --url http://localhost:5500`) atau deploy.

### Pasang sebagai aplikasi di HP (PWA)

Setelah di-deploy dengan HTTPS, AEGIS bisa dipasang ke layar utama dan terbuka layar penuh seperti aplikasi:

- **Android (Chrome):** buka URL-nya → menu ⋮ → **Instal aplikasi** / **Tambahkan ke layar utama**.
- **iPhone (Safari):** buka URL-nya → tombol Bagikan → **Tambah ke Layar Utama**.

Yang dipasang hanya shortcut ke situs. Halaman dan model AI di-cache oleh browser, jadi buka berikutnya cepat; chat AI dan cuaca tetap butuh internet.
Izin kamera dan mikrofon tetap ditanyakan sekali. Setelah update kode, tutup lalu buka ulang aplikasinya agar versi baru terpakai.
Ikon dibuat oleh `node scripts/make-icons.mjs` (hasil ada di `icons/`).

## 12. IoT rumah (ESP32-C3: PIR, RFID, suhu, relay)

```
ESP32-C3 ──HTTPS──▶ server AEGIS ◀──(polling 2 dtk)── panel IoT di dashboard
         ◀── balasan: perintah lampu/relay
```

**Di server (`.env` lokal, atau environment variable di hosting):**
```
IOT_TOKEN=kata-acak-yang-panjang
IOT_CARDS=04A1B2C3:Budi,0511AA22:Ani      # opsional: UID kartu → nama
```
Tanpa `IOT_TOKEN`, fitur IoT mati. Jalankan ulang server setelah mengisinya.

**Coba dulu tanpa alat:** `node scripts/iot-sim.mjs` (membaca token dari `.env`). Buka dashboard → ikon rumah di kanan atas → masukkan token yang sama.

**Pasang ESP32-C3:** buka `esp32/aegis_iot/aegis_iot.ino` di Arduino IDE, baca komentar di bagian atasnya (library, board, tabel kabel), isi `WIFI_SSID`, `WIFI_PASS`, `SERVER_URL`, `IOT_TOKEN`, lalu upload. Sensor yang tidak kamu punya: ubah `ENABLE_xxx` menjadi `0`.
UID kartu baru terlihat di panel (dan log) saat kartu ditempelkan: salin ke `IOT_CARDS` supaya AEGIS menyebut namanya.

**Yang terjadi di dashboard:**
- Panel menampilkan suhu, kelembapan, PIR, pintu, dan tombol **LAMPU** (relay).
- Kartu RFID dikenal → AEGIS: "Selamat datang, Budi." Kartu asing → peringatan suara.
- PIR mendeteksi gerak saat **Mode Jaga** aktif → alarm, foto otomatis, dan klip (sama seperti gerakan dari kamera).
- Perintah suara/teks: "nyalakan lampu", "matikan lampu", "suhu ruangan", "status sensor".
- Konteks sensor ikut dikirim ke AI chatbot, jadi bisa ditanya "apa kondisi rumah sekarang?".

**Keamanan:** semua endpoint `/api/iot/*` butuh token (percobaan salah dibatasi 10x/menit per IP). Jangan bagikan token. Di hosting, wajib HTTPS (sudah otomatis di Render/Railway/Fly).
`setInsecure()` di sketch berarti sertifikat server tidak diverifikasi (data tetap terenkripsi); cukup untuk rumah.
⚠ RC522 hanya 3,3 V. Jangan menyambung relay ke listrik 220 V bila belum paham; untuk demo pakai LED atau buzzer.
Status sensor disimpan di memori server: hilang saat server restart sampai ESP32 melapor lagi (beberapa detik). Hosting gratis yang "tidur" membuat laporan pertama lambat.
