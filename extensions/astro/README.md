# Astro

QSO Graph Desktop's extension for where the sun and the moon are at
your Location (`QGD-AST-*`). It ships with the application as an official extension and, like every extension, starts off: turn it on in **Settings → Extensions**. On, it has an item in the rail as well as a
page you can pin.

| On the page | What it is |
|---|---|
| **Grey line now** | A world map with the night greyed out, the twilight down to −10.1° lighter as the grey line, the terminator, the sun and the moon where each is overhead, and the Location marked |
| **Grey line DX check** | Given a DX station's grid, that grid marked on the map, and the windows in the next 24 hours when both ends are in twilight within the same depth, as date, start and end in **UTC**: a contact with another station is UTC |
| **Almanac** | For the Location, on the computer's clock (local), headed with the zone the clock is set to: |
| · Sun | Five days: sunrise and sunset (the centre at −0.833°), solar noon and the length of the day |
| · Twilight | Five days: civil, nautical and astronomical dawn and dusk (−6°, −12°, −18°) |
| · Moon | Five days: phase, moonrise and moonset, how much is lit, declination and distance |
| · Radio depths | Today and tomorrow: when the absorbing D and E layers (−10.1°) and the reflecting F2 layer (−17.2°) go dark and come back into sunlight |

Everything is worked out on this computer: Astro makes no network request at all
(`QGD-AST-0004`). It holds one grant, to read the active Location's name, grid and
position (`station:active`), and reaches the core only through the extension API.

It reports geometry and never predicts: no rating, score or forecast
(`QGD-AST-0050`). The two radio depths are an assumption written down as one, a
layer 100 km and 300 km up entering the earth's shadow, not a standard.

Times are to the minute, the accuracy it claims. The sun is checked against
PyEphem; the moon, a method of its own (Meeus, *Astronomical Algorithms*, chapter
47), against PyEphem as well, at five places from the equator to the Arctic
across a year (`QGD-AST-0005`, `QGD-AST-0006`). The almanac's times are on the
computer's clock, which is the operator's to set, and the page names the zone it is
set to; the grey-line windows with another station are in UTC (KI7MT, 2026-10-23:
Locations are local, logs are UTC).

The world map is made with [Natural Earth](https://www.naturalearthdata.com/): free
vector and raster map data, in the public domain. Thank you to its authors.
