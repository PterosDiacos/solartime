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

/** Hour angle of sunrise in degrees, or a polar flag when the sun does not cross the horizon. */
function sunriseHourAngle(lat, decl) {
  const phi = Math.max(-89.9999, Math.min(89.9999, lat)) * RAD;
  const cosH = Math.cos(ZENITH * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  if (cosH > 1) return { polar: 'night' };
  if (cosH < -1) return { polar: 'day' };
  return { ha: Math.acos(cosH) / RAD };
}

/**
 * Sunrise, solar noon and sunset for "local mean solar day" k at a longitude.
 * Day k spans UTC [k*DAY_MS, (k+1)*DAY_MS) shifted by -lon/15 hours, so this
 * works regardless of the browser's time zone.
 */
export function dayEvents(k, lat, lon) {
  const base = k * DAY_MS;
  const at = (minutes) => base + minutes * MIN_MS;

  let noon = at(720 - 4 * lon);
  for (let i = 0; i < 2; i++) noon = at(720 - 4 * lon - equationOfTime(noon));

  let polar = null;
  const event = (sign) => {
    let t = noon + sign * 6 * HOUR_MS;
    for (let i = 0; i < 3; i++) {
      const r = sunriseHourAngle(lat, declination(t));
      if (r.polar) { polar = r.polar; return null; }
      t = at(720 - 4 * lon - equationOfTime(t) + sign * 4 * r.ha);
    }
    return t;
  };
  let sunrise = event(-1);
  let sunset = event(+1);
  if (sunrise == null || sunset == null) {
    // Midnight sun / polar night: fall back to equal hours around solar noon.
    sunrise = noon - 6 * HOUR_MS;
    sunset = noon + 6 * HOUR_MS;
  }
  return { noon, sunrise, sunset, polar };
}

const bounds = (start, end) => Array.from({ length: 13 }, (_, i) => start + ((end - start) * i) / 12);

/**
 * The sunset-to-sunset cycle containing `now`:
 * night = previous sunset -> sunrise, day = sunrise -> sunset, each split into 12 hours.
 */
export function cycleAt(now, lat, lon) {
  let k = Math.floor((now + lon * 4 * MIN_MS) / DAY_MS);
  let ev = dayEvents(k, lat, lon);
  for (let guard = 0; now >= ev.sunset && guard < 3; guard++) ev = dayEvents(++k, lat, lon);
  let prev = dayEvents(k - 1, lat, lon);
  for (let guard = 0; now < prev.sunset && guard < 3; guard++) {
    ev = prev;
    prev = dayEvents(--k - 1, lat, lon);
  }
  return {
    prevSunset: prev.sunset,
    sunrise: ev.sunrise,
    noon: ev.noon,
    sunset: ev.sunset,
    polar: ev.polar || prev.polar,
    dayHourMs: (ev.sunset - ev.sunrise) / 12,
    nightHourMs: (ev.sunrise - prev.sunset) / 12,
    dayBounds: bounds(ev.sunrise, ev.sunset),
    nightBounds: bounds(prev.sunset, ev.sunrise),
  };
}

/** Where `now` falls in the cycle: day or night, which hour (1-12), and dial position (0-1). */
export function phaseAt(now, c) {
  const isDay = now >= c.sunrise;
  const start = isDay ? c.sunrise : c.prevSunset;
  const end = isDay ? c.sunset : c.sunrise;
  const hourLen = (end - start) / 12;
  const hours = Math.min(12, Math.max(0, (now - start) / hourLen)); // temporal hours elapsed
  const hour = Math.min(12, Math.floor(hours) + 1);
  return {
    isDay,
    hours,
    hour,
    hourLen,
    hourStart: start + (hour - 1) * hourLen,
    hourEnd: start + hour * hourLen,
    // Dial runs clockwise from the bottom: day fills the left half, night the right.
    position: (isDay ? 0 : 0.5) + hours / 24,
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
