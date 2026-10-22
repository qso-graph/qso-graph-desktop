# On the Air

QSO Graph Desktop's built-in extension for Home's cards: what is happening on the
air now (`QGD-HOM-0007`). It ships with the application, is on by default, and
can be turned off.

| Card | What it shows | Refreshed at most every |
|---|---|---|
| **Conditions** | Solar flux, the planetary K and A indices, NOAA's space weather scales (R, S, G) with an alert when any is above 0, and the band-by-band outlook as Band, Status and Comment, graded on the scale in [BAND-OUTLOOK.md](BAND-OUTLOOK.md) (`QGD-HOM-0008`) | 15 minutes |

It runs in the extension host and reaches the core only through the extension
API (`QGD-APP-0002`). NOAA's data is fetched by the core from the sources the
register names (`noaa-flux`, `noaa-kp`, `noaa-scales`).

Its second card, **Your station**, was retired on 2026-10-22 (KI7MT): everything
on it is shown elsewhere or moves. The header carries UTC and local time and the
status bar the callsign, the location and its grid (`QGD-FRM-0014`); sunrise and
sunset move to the Astro extension's page.

`solar-mcp` is the specification for Conditions. Its parsing and band table are
followed here, and both are tested against the same recorded NOAA responses
(`tests/fixtures/noaa`).

NOAA's data is courtesy of the NOAA Space Weather Prediction Center, a work of
the US government.
