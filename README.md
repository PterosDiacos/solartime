# solartime

https://pterosdiacos.github.io/solartime/

A static web app showing **solar time with unequal hours**: each cycle runs from sunset to the next sunset. The night from sunset to sunrise is split into 12 night hours, then the daylight from sunrise to sunset into 12 day hours.

## What it shows

- **Readout:** the current temporal time (how many unequal hours and minutes have passed since sunrise or sunset), and which hour you're in.
- **Dial:** day hours climb the left half from sunrise (bottom) to sunset (top); night hours run down the right half from sunset back to sunrise. The hand points at the current moment. Hours 3, 6, 9 and 12 always show their time. Hover over, click or tap any other hour to see its time, and its span (start – end) appears under the dial; click or tap it again, or anywhere else, to hide it.
- **Calculations:** day of year, local standard time meridian, equation of time, declination, time correction, local solar time, hour angle, solar elevation, night and day length, and how many real minutes one night hour and one day hour last.

Each label marks the moment its hour **ends**, so day 6 is solar noon, day 12 is sunset and night 12 is sunrise.

Everything follows the **location**, whether it comes from the device (with permission) or is typed in. Its time zone is looked up offline from the coordinates, and all clock times, the UTC offset (so LSTM and TC) and the day of year use that zone. At sea, the nautical zone (longitude ÷ 15) is used. The device only supplies the current moment.

## Method

| Quantity | Formula |
|---|---|
| Equation of time (EoT), declination | NOAA Solar Calculator formulas, from Meeus, *Astronomical Algorithms* (EoT to a few seconds, declination to about 0.01°) |
| Local standard time meridian | LSTM = 15° × (the location's offset from UTC in hours) |
| Time correction | TC = 4 min/° × (longitude − LSTM) + EoT |
| Local solar time | LST = local clock time + TC |
| Hour angle | HRA = 15° × (LST − 12 h) |
| Sunrise / sunset | the moment the solar zenith crosses 90.833° (allows for refraction and the sun's disc); whether the sun is up at each solar noon and midnight decides which sunrises and sunsets happen |

When the sun doesn't set or rise (midnight sun or polar night), no sunrise or sunset is invented; the dial switches to a full-ring clock anchored on solar noon and midnight:

- **Midnight sun:** 12 day hours round the whole ring from solar midnight (bottom) to the next; the 6th hour ends at solar noon (top). It switches on at a sunrise that is followed by no sunset before the next solar midnight, and off at a solar midnight when a sunset comes before the following one.
- **Polar night:** 12 night hours round the whole ring from solar noon (top) to the next; the 6th hour ends at solar midnight (bottom). It switches on at a sunset that is followed by no sunrise before the next solar noon, and off at a solar noon when a sunrise comes before the following one.

Right after either, the first normal day starts at that solar midnight, or the first night at that solar noon.

The code is plain ES modules with no build step:

- `js/solar.js`: the calculations (pure functions)
- `js/clock.js`: the SVG dial
- `js/app.js`: location and its time zone, the readouts (refreshed every real second; the temporal time at every temporal second)
- `js/vendor/tz-lookup.js`: [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) 11.8.0 (CC0), coordinates → time zone, offline

## Run locally

Serve the folder instead:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Geolocation works on `localhost` and over HTTPS.

Your location is used only in your browser. It is never sent anywhere.
