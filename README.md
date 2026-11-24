# solartime

`https://pterosdiacos.github.io/solartime/`

A static web app showing **solar time with unequal hours**: each cycle runs from sunset to the next sunset. The night from sunset to sunrise is split into 12 night hours, then the daylight from sunrise to sunset into 12 day hours.

## What it shows

- **Readout:** the current temporal time (how many unequal hours and minutes have passed since sunrise or sunset), which hour you're in, the apparent solar time, and how many real minutes one day hour and one night hour last.
- **Dial:** day hours climb the left half from sunrise (bottom) to sunset (top); night hours run down the right half from sunset back to sunrise. The hand points at the current moment. Hours 3, 6, 9 and 12 always show their time. Hover over (or tap) any other hour to see its time.
- **Calculations:** equation of time, local standard time meridian, time correction, hour angle, declination, solar elevation, previous sunset, solar noon, and day and night length.

Each label marks the moment its hour **ends**, so day 6 is solar noon, day 12 is sunset and night 12 is sunrise.

## Method

| Quantity | Formula |
|---|---|
| Equation of time (EoT) | NOAA fractional-year series (Spencer 1971) |
| Local standard time meridian | LSTM = 15° × (offset from UTC in hours) |
| Time correction | TC = 4 min/° × (longitude − LSTM) + EoT |
| Local solar time | LST = local clock time + TC |
| Hour angle | HRA = 15° × (LST − 12 h) |
| Sunrise / sunset | hour angle where the solar zenith is 90.833° (allows for refraction and the sun's disc) |

At latitudes where the sun doesn't rise or set (polar night or midnight sun), the app says so and falls back to equal hours centred on solar noon.

The code is plain ES modules with no build step:

- `js/solar.js`: the calculations (pure functions)
- `js/clock.js`: the SVG dial
- `js/app.js`: location, the 1-second refresh, and the readouts

## Run locally

Serve the folder instead:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Geolocation works on `localhost` and over HTTPS.

Your location is used only in your browser. It is never sent anywhere.
