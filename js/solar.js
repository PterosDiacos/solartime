// Solar calculations. All instants are epoch milliseconds (UTC).
// Longitude is degrees east (+) / west (-); latitude degrees north (+) / south (-).
//
// Equation of time and declination use the NOAA Solar Calculator formulas, from Jean Meeus,
// "Astronomical Algorithms": declination to about 0.01 deg and equation of time to a few
// seconds for centuries around 2000. Sunrise/sunset use a zenith of 90.833 deg (atmospheric
// refraction + solar disc radius), which is what almanacs publish.

const RAD = Math.PI / 180;
export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
const ZENITH = 90.833;
const JD_UNIX_EPOCH = 2440587.5; // Julian Day of 1970-01-01 00:00 UTC
const J2000 = 2451545;           // Julian Day of 2000-01-01 12:00 TT

/** Sun's declination (deg) and equation of time (min) at instant t (NOAA / Meeus). */
function sunPosition(t) {
  const T = (t / DAY_MS + JD_UNIX_EPOCH - J2000) / 36525;                     // Julian centuries since J2000
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;           // geometric mean longitude, deg
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);                    // mean anomaly, deg
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);               // orbit eccentricity
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))    // equation of centre, deg
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;                                        // Moon's node, for nutation
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);          // apparent longitude, deg
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);                         // obliquity (corrected), deg
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eot };
}

/** Equation of time in minutes (apparent minus mean solar time). */
export function equationOfTime(t) {
  return sunPosition(t).eot;
}

/** Solar declination in radians. */
export function declination(t) {
  return sunPosition(t).decl * RAD;
}

/** Sun's altitude (deg, geometric) at instant t, latitude lat and longitude lon. */
function altitude(t, lat, lon) {
  const { decl, eot } = sunPosition(t);
  const utcMin = (((t % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS;
  const ha = (utcMin + eot + 4 * lon) / 4 - 180;  // hour angle from true solar time, deg
  const phi = lat * RAD, d = decl * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(ha * RAD)) / RAD;
}

/** Solar noon (h = 720) or solar midnight (h = 0) of day k: when true solar time reaches h minutes. */
function solarTime(k, lon, h) {
  const at = (minutes) => k * DAY_MS + minutes * MIN_MS;
  let t = at(h - 4 * lon);
  for (let i = 0; i < 2; i++) t = at(h - 4 * lon - equationOfTime(t));
  return t;
}

/** Instant between a and b where the altitude crosses the horizon (bisection; altitude is monotonic there). */
function crossing(a, b, lat, lon) {
  const up = (t) => altitude(t, lat, lon) > -(ZENITH - 90);
  const rising = up(b);
  for (let i = 0; i < 24; i++) {  // 12 h / 2^24 ≈ 3 ms
    const m = (a + b) / 2;
    if (up(m) === rising) b = m; else a = m;
  }
  return (a + b) / 2;
}

const cache = new Map();

/**
 * Solar day k at a longitude: the solar midnight before it, solar noon, the next solar midnight,
 * whether the sun is up at each (altitude above -0.833°, i.e. refraction and the sun's disc
 * allowed for), and the real sunrise (between midnight and noon) and sunset (between noon and the
 * next midnight). A sunrise or sunset that does not happen is null, and riseStays / setStays say
 * why: 'day' = the sun stays up, 'night' = it stays down. Nothing is invented in its place.
 * Up/down at a solar midnight is decided once, so the sunset before it and the sunrise after it
 * always agree.
 * Day k is UTC [k*DAY_MS, (k+1)*DAY_MS) shifted by -lon/15 hours, so this works regardless of
 * the browser's time zone.
 */
export function dayEvents(k, lat, lon) {
  const key = `${k},${lat},${lon}`;
  if (cache.has(key)) return cache.get(key);
  const up = (t) => altitude(t, lat, lon) > -(ZENITH - 90);
  const midnight = solarTime(k, lon, 0), noon = solarTime(k, lon, 720), nextMidnight = solarTime(k + 1, lon, 0);
  const midnightUp = up(midnight), noonUp = up(noon), nextMidnightUp = up(nextMidnight);
  const ev = {
    midnight, noon, nextMidnight, midnightUp, noonUp, nextMidnightUp,
    sunrise: !midnightUp && noonUp ? crossing(midnight, noon, lat, lon) : null,
    sunset: noonUp && !nextMidnightUp ? crossing(noon, nextMidnight, lat, lon) : null,
    riseStays: !midnightUp && noonUp ? null : midnightUp ? 'day' : 'night',
    setStays: noonUp && !nextMidnightUp ? null : nextMidnightUp ? 'day' : 'night',
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, ev);
  return ev;
}

const bounds = (start, end) => Array.from({ length: 13 }, (_, i) => start + ((end - start) * i) / 12);

function polarCycle(kind, start, end) {
  const span = [start, end], b = bounds(start, end), hour = (end - start) / 12;
  return kind === 'polar-day'
    ? { kind, day: span, night: null, dayBounds: b, nightBounds: null, dayHourMs: hour, nightHourMs: null }
    : { kind, day: null, night: span, dayBounds: null, nightBounds: b, dayHourMs: null, nightHourMs: hour };
}

/**
 * The cycle shown on the dial at instant `now`. Three kinds:
 *
 *  - 'polar-day'   (midnight sun): 12 day hours from one solar midnight to the next.
 *      Switches on at a sunrise that is followed by no sunset before the next solar midnight;
 *      switches off at a solar midnight when a sunset comes before the following solar midnight.
 *  - 'polar-night': 12 night hours from one solar noon to the next.
 *      Switches on at a sunset that is followed by no sunrise before the next solar noon;
 *      switches off at a solar noon when a sunrise comes before the following solar noon.
 *  - 'normal': a night (sunset -> sunrise) and a day (sunrise -> sunset), 12 hours each. The half
 *      that is not current is the previous night (during the day) or the next day (during the
 *      night). Right after polar time a half starts at the switch-off moment instead: a day from
 *      the solar midnight, or a night from the solar noon. If the usual neighbour does not exist
 *      (no night before such a day; no normal day after a sunrise that starts midnight sun), the
 *      neighbour on the other side is shown.
 *
 * Returns { kind, day, night } as [start, end] instants (null when absent), the 13 hour
 * boundaries of each (dayBounds, nightBounds) and the hour lengths in ms.
 */
export function cycleAt(now, lat, lon) {
  const memo = new Map();
  const day = (k) => {
    if (!memo.has(k)) memo.set(k, dayEvents(k, lat, lon));
    return memo.get(k);
  };
  const upAtMidnight = (k) => day(k).midnightUp;  // sun up at the solar midnight before day k
  const downAtNoon = (k) => !day(k).noonUp;        // sun down at solar noon of day k

  const k0 = Math.floor((now + lon * 4 * MIN_MS) / DAY_MS);
  let km = k0; // solar day whose midnight-to-midnight span contains now
  for (let g = 0; g < 3 && now < day(km).midnight; g++) km--;
  for (let g = 0; g < 3 && now >= day(km + 1).midnight; g++) km++;
  let kn = k0; // solar day whose noon-to-noon span contains now
  for (let g = 0; g < 3 && now < day(kn).noon; g++) kn--;
  for (let g = 0; g < 3 && now >= day(kn + 1).noon; g++) kn++;

  // Polar day, judged on the midnight-to-midnight span.
  const dm = day(km);
  const polarDay = upAtMidnight(km)
    ? dm.sunset == null                                              // stays on: no sunset before next midnight
    : dm.sunrise != null && dm.sunset == null && now >= dm.sunrise;  // switches on at this sunrise
  if (polarDay) return polarCycle('polar-day', dm.midnight, day(km + 1).midnight);

  // Polar night, judged on the noon-to-noon span.
  const dn = day(kn), dn1 = day(kn + 1);
  const polarNight = downAtNoon(kn)
    ? dn1.sunrise == null                                             // stays on: no sunrise before next noon
    : dn.sunset != null && dn1.sunrise == null && now >= dn.sunset;   // switches on at this sunset
  if (polarNight) return polarCycle('polar-night', dn.noon, dn1.noon);

  // Normal: segment starts are real sunrises/sunsets, plus the switch-off moments above.
  const marks = [];
  for (let k = km - 2; k <= km + 3; k++) {
    const d = day(k);
    if (d.sunrise != null) marks.push({ t: d.sunrise, type: 'day', real: true });
    if (d.sunset != null) marks.push({ t: d.sunset, type: 'night', real: true });
    if (upAtMidnight(k) && d.sunset != null) marks.push({ t: d.midnight, type: 'day', real: false });
    if (downAtNoon(k) && day(k + 1).sunrise != null) marks.push({ t: d.noon, type: 'night', real: false });
  }
  marks.sort((a, b) => a.t - b.t);
  const nextReal = (after, type) => marks.find((m) => m.t > after && m.type === type && m.real);
  const prevStart = (before, type) => marks.findLast((m) => m.t < before && m.type === type);
  const cur = marks.findLast((m) => m.t <= now);

  // The current half always exists. The other half can be missing near the poles, e.g. a single
  // short night between polar night and polar day; it is then null and drawn without times.
  const ok = (sp) => (sp[0] != null && sp[1] != null ? sp : null);
  let dayspan, nightspan;
  if (cur.type === 'day') {
    dayspan = [cur.t, nextReal(cur.t, 'night').t];
    if (cur.real) nightspan = ok([prevStart(cur.t, 'night')?.t, cur.t]);              // previous night
    else {                                                                            // none before: next night,
      const set = dayspan[1], rise = nextReal(set, 'day');                           // unless polar night starts
      let kNoon = km - 1; // first solar noon after that sunset
      while (day(kNoon).noon <= set) kNoon++;
      nightspan = !rise || rise.t >= day(kNoon).noon ? null : [set, rise.t];
    }
  } else {
    nightspan = [cur.t, nextReal(cur.t, 'day').t];
    const rise = nightspan[1];
    const set = nextReal(rise, 'night');
    let kAfter = km - 1; // first solar midnight after that sunrise
    while (day(kAfter).midnight <= rise) kAfter++;
    const startsPolarDay = !set || set.t >= day(kAfter).midnight;
    if (!startsPolarDay) dayspan = [rise, set.t];                                     // next day
    else dayspan = ok([prevStart(cur.t, 'day')?.t, cur.t]);                          // none after: previous day
  }
  return {
    kind: 'normal',
    day: dayspan,
    night: nightspan,
    dayBounds: dayspan && bounds(...dayspan),
    nightBounds: nightspan && bounds(...nightspan),
    dayHourMs: dayspan && (dayspan[1] - dayspan[0]) / 12,
    nightHourMs: nightspan && (nightspan[1] - nightspan[0]) / 12,
  };
}

/**
 * Where `now` falls in the cycle: day or night, which hour (1-12), and dial position (0-1,
 * clockwise from the bottom). Normal: day fills the left half from the bottom, night the right
 * half from the top. Polar day: the whole ring from the bottom (solar midnight). Polar night:
 * the whole ring from the top (solar noon).
 */
export function phaseAt(now, c) {
  const isDay = c.kind === 'polar-day' || (c.kind === 'normal' && !!c.day && now >= c.day[0] && now < c.day[1]);
  const [start, end] = isDay ? c.day : c.night;
  const hourLen = (end - start) / 12;
  const hours = Math.min(12, Math.max(0, (now - start) / hourLen)); // temporal hours elapsed
  const hour = Math.min(12, Math.floor(hours) + 1);
  const position = c.kind === 'polar-day' ? hours / 12
    : c.kind === 'polar-night' ? (0.5 + hours / 12) % 1
    : (isDay ? 0 : 0.5) + hours / 24;
  return {
    isDay,
    start,
    hours,
    hour,
    hourLen,
    hourStart: start + (hour - 1) * hourLen,
    hourEnd: start + hour * hourLen,
    position,
  };
}

/**
 * Instantaneous quantities, following the PV Education definitions.
 * tzOffsetMin is the local clock's offset from UTC in minutes (east positive).
 */
export function instantQuantities(now, lat, lon, tzOffsetMin) {
  const eot = equationOfTime(now);                 // min
  // Wrap to (-180, 180]: zones such as UTC+14 put the meridian at 210° E = 150° W.
  const wrap = (d) => d - 360 * Math.ceil((d - 180) / 360);
  const lstm = wrap(15 * (tzOffsetMin / 60));      // deg
  const tc = 4 * wrap(lon - lstm) + eot;           // min
  const localClock = now + tzOffsetMin * MIN_MS;   // local time, as a UTC-based number
  const lst = localClock + tc * MIN_MS;            // local (apparent) solar time (LST)
  const lstHours = (((lst % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
  const hra = 15 * (lstHours - 12);                // hour angle, deg
  const decl = declination(now);
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(decl)
    + Math.cos(phi) * Math.cos(decl) * Math.cos(hra * RAD)) / RAD;
  return { eot, lstm, tc, lst, lstHours, hra, declination: decl / RAD, elevation };
}
