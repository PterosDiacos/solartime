import { cycleAt, phaseAt, instantQuantities, MIN_MS } from './solar.js';
import { Dial } from './clock.js';
import tzlookup from './vendor/tz-lookup.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'solar-time.location';

// ---------- time zone of the location ----------
// Every clock time, the UTC offset (and so LSTM and TC) and the day of year use the time zone
// at the chosen location, looked up offline from its coordinates. The device only supplies "now".

/** Nautical time zone from longitude, used at sea or if the lookup fails. Etc/GMT signs are inverted. */
function nauticalZone(lon) {
  const n = Math.round(lon / 15);
  return n === 0 ? 'Etc/GMT' : `Etc/GMT${n > 0 ? '-' : '+'}${Math.abs(n)}`;
}
function zoneFor(lat, lon) {
  for (const zone of [() => tzlookup(lat, lon), () => nauticalZone(lon)]) {
    try {
      const z = zone();
      new Intl.DateTimeFormat('en-US', { timeZone: z }); // throws if the browser doesn't know it
      return z;
    } catch { /* try the next one */ }
  }
  return 'UTC';
}

/** Formatters and calendar helpers bound to one time zone. */
function zoneClock(timeZone) {
  const hm = new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const wall = (t) => Object.fromEntries(parts.formatToParts(t).map(({ type, value }) => [type, +value]));
  return {
    zone: timeZone,
    hm: (t) => hm.format(t),
    /** Minutes the zone's clock is ahead of UTC at instant t (DST included). */
    offset(t) {
      const p = wall(t);
      const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      return Math.round((asUTC - Math.floor(t / 1000) * 1000) / MIN_MS);
    },
    /** Day of year and year length for the zone's calendar date at instant t. */
    dayOfYear(t) {
      const p = wall(t);
      const doy = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 86_400_000) + 1;
      const y = p.year;
      return { doy, daysInYear: (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365 };
    },
  };
}

const fmtHM = (t) => state.clock.hm(t);
const pad = (n) => String(n).padStart(2, '0');
const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const minutes = (ms) => `${(ms / MIN_MS).toFixed(1)} min`;
/** A time of day given in hours (0-24) as hh:mm:ss. */
const hoursToHMS = (h) => {
  const s = Math.floor(h * 3600 + 1e-6) % 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
const signedMinSec = (min) => {
  const s = Math.round(Math.abs(min) * 60);
  const sign = min < 0 ? '−' : '+';
  return s < 60 ? `${sign}${s} s` : `${sign}${Math.floor(s / 60)} min ${pad(s % 60)} s`;
};
const deg = (d, digits = 2) => `${d < 0 ? '−' : ''}${Math.abs(d).toFixed(digits)}°`;
const duration = (ms) => {
  const m = Math.round(ms / MIN_MS);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};
// Short UTC offset: UTC+1, UTC−5, UTC+5:30, UTC+0.
const utcOffset = (min) => {
  const h = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60;
  return `UTC${min < 0 ? '−' : '+'}${h}${m ? `:${pad(m)}` : ''}`;
};

const state = { loc: null, clock: null, cycleKey: null, cycle: null, hovering: false };

// Theme follows the sun: cream "day" palette by day, deep navy "night" palette at night.
// Until a location is set, the device's dark-mode setting picks the night palette.
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');
function setTheme(isDay) {
  const day = isDay == null ? !prefersDark?.matches : isDay;
  const theme = day ? 'day' : 'night';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}
setTheme(null);
prefersDark?.addEventListener?.('change', () => { if (!state.loc) setTheme(null); });

const dial = new Dial($('dial'), (info) => {
  state.hovering = !!info;
  if (info) {
    const name = info.phase === 'day' ? 'Day' : 'Night';
    $('hover-info').textContent =
      `${name} hour ${info.hour} · ${fmtHM(info.start)} – ${fmtHM(info.end)}`;
  } else {
    showCurrentHourInfo();
  }
});

function showCurrentHourInfo() {
  if (state.hovering) return;
  const canHover = window.matchMedia?.('(hover: hover)').matches;
  $('hover-info').textContent = !state.loc
    ? 'Set a location to draw the hours'
    : canHover ? 'Hover or click an hour to see its span' : 'Tap an hour to see its span';
}

function tick() {
  if (!state.loc) return;
  const now = Date.now();
  const { lat, lon } = state.loc;
  const clock = state.clock;
  const tz = clock.offset(now); // location's UTC offset, minutes
  const { doy, daysInYear } = clock.dayOfYear(now);
  $('d-doy').textContent = `${doy} of ${daysInYear}`;
  const c = cycleAt(now, lat, lon);
  const p = phaseAt(now, c);
  const q = instantQuantities(now, lat, lon, tz);

  const span = (sp) => (sp ? sp.map((t) => Math.round(t / MIN_MS)).join('-') : '');
  const key = `${lat},${lon},${clock.zone},${c.kind},${span(c.day)},${span(c.night)}`;
  if (key !== state.cycleKey) {
    state.cycleKey = key;
    state.cycle = c;
    dial.setCycle(c, fmtHM);
  }
  dial.setNow(p.position, p.isDay, p.hour);

  document.body.dataset.phase = p.isDay ? 'day' : 'night';
  setTheme(p.isDay);
  $('phase-badge').textContent = p.isDay ? 'Day' : 'Night';
  // Time left in this hour: whole minutes, switching to a per-second countdown in the last minute.
  const secLeft = Math.max(0, Math.ceil((p.hourEnd - now) / 1000));
  const left = secLeft < 60 ? `${secLeft} s` : `${Math.round(secLeft / 60)} min`;
  $('hour-line').textContent =
    `${ordinal(p.hour)} hour of the ${p.isDay ? 'day' : 'night'} ends ${fmtHM(p.hourEnd)} in ${left}`;
  // Local solar time is a time of day, not an instant in the location's zone: format it directly.
  // (Formatting now + TC with the zone would use the offset at that other instant, which is an
  // hour off for up to |TC| after a clock change.)
  $('d-lst').textContent = hoursToHMS(q.lstHours);
  // A missing half: zero during midnight sun / polar night (there really is no night / day);
  // "—" only in the rare normal cycle near a pole where the neighbouring half is unknown.
  const none = c.kind === 'normal' ? '—' : null;
  $('d-dayhour').textContent = c.dayHourMs ? minutes(c.dayHourMs) : none ?? minutes(0);
  $('d-nighthour').textContent = c.nightHourMs ? minutes(c.nightHourMs) : none ?? minutes(0);

  $('d-eot').textContent = signedMinSec(q.eot);
  const offset = document.createElement('span');
  offset.className = 'sub';
  offset.textContent = utcOffset(tz);
  $('d-lstm').replaceChildren(`${Math.abs(q.lstm).toFixed(1)}° ${q.lstm < 0 ? 'W' : 'E'} `, offset);
  $('d-tc').textContent = signedMinSec(q.tc);
  $('d-hra').textContent = deg(q.hra);
  $('d-decl').textContent = deg(q.declination);
  $('d-elev').textContent = deg(q.elevation, 1);
  $('d-daylen').textContent = c.day ? duration(c.day[1] - c.day[0]) : none ?? duration(0);
  $('d-nightlen').textContent = c.night ? duration(c.night[1] - c.night[0]) : none ?? duration(0);
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

// Readout: temporal time = unequal hours elapsed since sunrise (day) or sunset (night).
// It has its own timer that fires at each temporal second (hour length / 3600: under a real second
// when day hours are short, over one when they are long), so every value is shown exactly once.
// Everything else on the page refreshes once per real second in tick().
let temporalTimer = 0;
function temporalTick() {
  clearTimeout(temporalTimer);
  if (!state.loc) return;
  const now = Date.now();
  const p = phaseAt(now, cycleAt(now, state.loc.lat, state.loc.lon));
  const secLen = p.hourLen / 3600;                        // one temporal second, in ms
  const totalSec = Math.floor(p.hours * 3600 + 1e-6);
  const h = Math.floor(totalSec / 3600), m = Math.floor(totalSec / 60) % 60, s = totalSec % 60;
  $('temporal-hm').textContent = `${pad(h)}:${pad(m)}`;
  $('temporal-s').textContent = `:${pad(s)}`;
  const next = p.start + (totalSec + 1) * secLen;     // next temporal second boundary
  temporalTimer = setTimeout(temporalTick, Math.max(20, next - now + 5));
}

function setLocation(lat, lon, source) {
  state.loc = { lat, lon, source };
  state.clock = zoneClock(zoneFor(lat, lon));
  state.cycleKey = null;
  save(state.loc);
  document.body.classList.remove('no-loc');
  $('lat').value = lat.toFixed(4);
  $('lon').value = lon.toFixed(4);
  const where = source === 'device' ? 'Using your device location' : 'Using the entered coordinates';
  const zone = state.clock.zone;
  // Etc/GMT±n zones (at sea) have inverted signs, so show them as a plain UTC offset.
  const zoneName = zone.startsWith('Etc/') ? `${utcOffset(state.clock.offset(Date.now()))} (sea)` : zone.replace(/_/g, ' ');
  setStatus(`${where} · times in ${zoneName}`);
  showCurrentHourInfo();
  tick();
  temporalTick();
}

// Each device request, and each manual entry, takes a new number. A device answer is used only if
// nothing newer has happened since, so a slow GPS fix cannot overwrite coordinates typed meanwhile.
let locationRequest = 0;

function requestDeviceLocation() {
  if (!('geolocation' in navigator)) {
    setStatus('This browser cannot share location. Enter coordinates instead.', true);
    return;
  }
  const id = ++locationRequest;
  setStatus('Waiting for permission…');
  navigator.geolocation.getCurrentPosition(
    (pos) => { if (id === locationRequest) setLocation(pos.coords.latitude, pos.coords.longitude, 'device'); },
    (err) => {
      if (id !== locationRequest) return;
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
  locationRequest++; // supersedes any device request still in flight
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
