import { cycleAt, phaseAt, instantQuantities, MIN_MS } from './solar.js';
import { Dial } from './clock.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'solar-time.location';

const hm = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hms = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fmtHM = (t) => hm.format(t);
const pad = (n) => String(n).padStart(2, '0');
const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const minutes = (ms) => `${(ms / MIN_MS).toFixed(1)} min`;
const signedMinSec = (min) => {
  const s = Math.round(Math.abs(min) * 60);
  const sign = min < 0 ? '−' : '+';
  return s < 60 ? `${sign}${s} s` : `${sign}${Math.floor(s / 60)} min ${pad(s % 60)} s`;
};
const deg = (d, digits = 2) => `${d < 0 ? '−' : ''}${Math.abs(d).toFixed(digits)}°`;
const duration = (ms) => {
  const m = Math.round(ms / MIN_MS);
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
};
const utcOffset = (min) => `UTC${min < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

const state = { loc: null, cycleKey: null, cycle: null, hovering: false };

const dial = new Dial($('dial'), (info) => {
  state.hovering = !!info;
  if (info) {
    const name = info.phase === 'day' ? 'Day' : 'Night';
    $('hover-info').textContent =
      `${name} hour ${info.hour} · ${fmtHM(info.start)} – ${fmtHM(info.end)} (${minutes(info.end - info.start)})`;
  } else {
    showCurrentHourInfo();
  }
});

function showCurrentHourInfo() {
  if (state.hovering) return;
  $('hover-info').textContent = state.loc
    ? 'Hover or tap an hour number to see when it ends'
    : 'Set a location to draw the hours';
}

function tick() {
  const now = Date.now();
  const tz = -new Date(now).getTimezoneOffset();
  const d = new Date(now);
  const y = d.getFullYear();
  const doy = Math.round((Date.UTC(y, d.getMonth(), d.getDate()) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  $('d-doy').textContent = `${doy} of ${daysInYear}`;
  if (!state.loc) return;

  const { lat, lon } = state.loc;
  const c = cycleAt(now, lat, lon);
  const p = phaseAt(now, c);
  const q = instantQuantities(now, lat, lon, tz);

  const key = `${lat},${lon},${Math.round(c.prevSunset / MIN_MS)},${Math.round(c.sunset / MIN_MS)}`;
  if (key !== state.cycleKey) {
    state.cycleKey = key;
    state.cycle = c;
    dial.setCycle(c, fmtHM);
  }
  dial.setNow(p.position, p.isDay, p.hour);

  // Readout: temporal time = unequal hours elapsed since sunrise (day) or sunset (night).
  const totalSec = Math.floor(p.hours * 3600);
  const h = Math.floor(totalSec / 3600), m = Math.floor(totalSec / 60) % 60, s = totalSec % 60;
  document.body.dataset.phase = p.isDay ? 'day' : 'night';
  $('phase-badge').textContent = p.isDay ? 'Day' : 'Night';
  $('temporal-hm').textContent = `${pad(h)}:${pad(m)}`;
  $('temporal-s').textContent = `:${pad(s)}`;
  const left = Math.max(0, Math.round((p.hourEnd - now) / MIN_MS));
  $('hour-line').textContent =
    `${ordinal(p.hour)} hour of the ${p.isDay ? 'day' : 'night'} · ends ${fmtHM(p.hourEnd)} (in ${left} min)`;
  $('d-lst').textContent = hms.format(q.lst - tz * MIN_MS);
  $('day-len').textContent = minutes(c.dayHourMs);
  $('night-len').textContent = minutes(c.nightHourMs);

  $('polar').hidden = !c.polar;
  if (c.polar) {
    $('polar').textContent = c.polar === 'day'
      ? 'Midnight sun: the sun does not set today. Showing equal hours around solar noon.'
      : 'Polar night: the sun does not rise today. Showing equal hours around solar noon.';
  }

  $('d-eot').textContent = signedMinSec(q.eot);
  $('d-lstm').textContent = `${Math.abs(q.lstm).toFixed(1)}° ${q.lstm < 0 ? 'W' : 'E'} (${utcOffset(tz)})`;
  $('d-tc').textContent = signedMinSec(q.tc);
  $('d-hra').textContent = deg(q.hra);
  $('d-decl').textContent = deg(q.declination);
  $('d-elev').textContent = deg(q.elevation, 1);
  $('d-noon').textContent = fmtHM(c.noon);
  $('d-prev').textContent = fmtHM(c.prevSunset);
  $('d-daylen').textContent = duration(c.sunset - c.sunrise);
  $('d-nightlen').textContent = duration(c.sunrise - c.prevSunset);
}

// ---------- location ----------

function save(loc) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(loc)); } catch { /* storage unavailable */ }
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v;
  } catch { /* ignore */ }
  return null;
}

function setStatus(msg, isError = false) {
  $('loc-status').textContent = msg;
  $('loc-status').classList.toggle('error', isError);
}

function setLocation(lat, lon, source) {
  state.loc = { lat, lon, source };
  state.cycleKey = null;
  save(state.loc);
  document.body.classList.remove('no-loc');
  $('lat').value = lat.toFixed(4);
  $('lon').value = lon.toFixed(4);
  setStatus(source === 'device' ? 'Using your device location.' : 'Using the coordinates you entered.');
  showCurrentHourInfo();
  tick();
}

function requestDeviceLocation() {
  if (!('geolocation' in navigator)) {
    setStatus('This browser cannot share location. Enter coordinates instead.', true);
    return;
  }
  setStatus('Waiting for permission…');
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, 'device'),
    (err) => {
      const why = err.code === err.PERMISSION_DENIED
        ? 'Location permission was denied.'
        : 'Could not get your location.';
      setStatus(`${why} You can enter coordinates instead.`, true);
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
}

$('use-location').addEventListener('click', requestDeviceLocation);
$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
    setStatus('Latitude must be between −90 and 90, longitude between −180 and 180.', true);
    return;
  }
  setLocation(lat, lon, 'manual');
});

const saved = load();
if (saved) {
  setLocation(saved.lat, saved.lon, saved.source);
  // If permission was already granted earlier, refresh silently without prompting.
  navigator.permissions?.query({ name: 'geolocation' })
    .then((p) => { if (p.state === 'granted' && saved.source !== 'manual') requestDeviceLocation(); })
    .catch(() => {});
} else {
  // First visit: ask for location straight away.
  showCurrentHourInfo();
  requestDeviceLocation();
}

tick();
setInterval(tick, 1000);
