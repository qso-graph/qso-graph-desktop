# Astro

QSO Graph Desktop's built-in extension for where the sun and the moon are at
your Location (`QGD-AST-*`). It ships with the application, is on by default,
can be turned off, and has an item in the rail as well as a page you can pin.

| On the page | What it is |
|---|---|
| **Sun** | Sunrise and sunset (the centre at −0.833°), solar noon and the length of the day |
| **Twilight** | Civil, nautical and astronomical dawn and dusk (−6°, −12°, −18°) |
| **Radio depths** | When the absorbing D and E layers (−10.1°) and the reflecting F2 layer (−17.2°) go dark and come back into sunlight |
| **Moon** | Moonrise and moonset, phase and how much is lit, declination and distance |
| **Grey line** | Given a DX grid, the windows in the next 24 hours when both ends are within the same depth |

Everything is worked out on this computer: Astro makes no network request at all
(`QGD-AST-0004`). It holds one grant, to read the active Location's name, grid and
position (`station:active`), and reaches the core only through the extension API.

It reports geometry and never predicts: no rating, score or forecast
(`QGD-AST-0050`). The two radio depths are an assumption written down as one, a
layer 100 km and 300 km up entering the earth's shadow, not a standard.

Times are to the minute, the accuracy it claims. The sun is checked against
PyEphem; the moon, a method of its own (Meeus, *Astronomical Algorithms*, chapter
47), against PyEphem as well, at five places from the equator to the Arctic
across a year (`QGD-AST-0005`, `QGD-AST-0006`). Times are in UTC and on this
computer's clock where that differs; the Location's own time zone is not known
yet (`QGD-AST-0011`).
