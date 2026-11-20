// Cuaca nyata dari Open-Meteo (gratis, tanpa API key, CORS terbuka).
// Lokasi: geolokasi browser (izin pengguna); bila ditolak, perkiraan kota dari zona waktu.
// Modul daun: tidak mengimpor modul lain.

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

/** Kode cuaca WMO → kunci i18n + ikon. */
export function describeCode(code) {
  if (code === 0) return { cond: "wx.clear", icon: "sun" };
  if (code === 1 || code === 2) return { cond: "wx.partly", icon: "cloudSun" };
  if (code === 3) return { cond: "wx.overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { cond: "wx.fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { cond: "wx.drizzle", icon: "rain" };
  if (code === 61 || code === 63 || code === 66 || code === 80 || code === 81) return { cond: "wx.rain", icon: "rain" };
  if (code === 65 || code === 67 || code === 82) return { cond: "wx.heavy", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { cond: "wx.snow", icon: "snow" };
  if (code >= 95) return { cond: "wx.storm", icon: "storm" };
  return { cond: "wx.unknown", icon: "cloud" };
}

async function getJSON(url, fetchFn = fetch, timeout = 10000) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Ambil kondisi cuaca saat ini untuk koordinat tertentu. */
export async function fetchWeather({ lat, lon }, fetchFn = fetch) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    wind_speed_unit: "kmh",
    timezone: "auto",
  });
  const data = await getJSON(`${FORECAST}?${q}`, fetchFn);
  const c = data?.current;
  if (!c || typeof c.temperature_2m !== "number") throw new Error("Respons cuaca tidak valid");
  return {
    ...describeCode(c.weather_code),
    temp: c.temperature_2m,
    humidity: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    feels: c.apparent_temperature,
    at: Date.now(),
  };
}

function geolocate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no-geo"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, exact: true }),
      reject,
      { timeout: 10000, maximumAge: 3600000 },
    );
  });
}

/** Perkiraan lokasi dari nama zona waktu IANA (mis. "Asia/Jakarta" → Jakarta). */
async function locateByTimezone(fetchFn = fetch) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const city = tz.split("/").pop()?.replace(/_/g, " ");
  if (!city) throw new Error("no-tz");
  const data = await getJSON(`${GEOCODE}?${new URLSearchParams({ name: city, count: "1" })}`, fetchFn);
  const r = data?.results?.[0];
  if (!r) throw new Error("tz-not-found");
  return { lat: r.latitude, lon: r.longitude, exact: false, name: r.name };
}

/** Geolokasi dulu, kalau ditolak/gagal pakai perkiraan dari zona waktu. */
export async function resolveLocation(fetchFn = fetch) {
  try { return await geolocate(); } catch { /* ditolak atau tidak tersedia */ }
  return locateByTimezone(fetchFn);
}
