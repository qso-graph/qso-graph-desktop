# On the Air

QSO Graph Desktop's built-in extension for what is happening on the air now (`QGD-HOM-0007`). It ships with the application, is on by default, and
can be turned off.

| Card | What it shows | Refreshed at most every |
|---|---|---|
| **Conditions** | Solar flux, the planetary K and A indices, NOAA's space weather scales (R, S, G) with an alert when any is above 0, and the band-by-band outlook as Band, Status and Comment, graded on the scale in [BAND-OUTLOOK.md](BAND-OUTLOOK.md) (`QGD-HOM-0008`) | 15 minutes |
| **Parks On the Air** | Who is activating a POTA park now, from POTA's spot list: activator, park reference, name and location, frequency, ADIF's band, mode and the time spotted in UTC, newest first, sortable, and narrowed by band, mode and location (`QGD-HOM-0011`). In the rail as well as a pin | 1 minute; Refresh no sooner than 10 seconds |

Each page is asked for only while it is open, and not at all while the computer is
offline (`QGD-HOM-0005`). It runs in the extension host and reaches the core only
through the extension API (`QGD-APP-0002`). Its data is fetched by the core from the
sources the register names: NOAA's (`noaa-flux`, `noaa-kp`, `noaa-scales`) and POTA's
(`pota-spots`). It reads ADIF's bands from the reference data (`reference:read`,
`adif.bands`) to name each spot's band by ADIF's own edges.

Its second card, **Your station**, was retired on 2026-10-22 (KI7MT): everything
on it is shown elsewhere or moves. The header carries UTC and local time and the
status bar the callsign, the location and its grid (`QGD-FRM-0014`); sunrise and
sunset move to the Astro extension's page.

`solar-mcp` is the specification for Conditions. Its parsing and band table are
followed here, and both are tested against the same recorded NOAA responses
(`tests/fixtures/noaa`).

NOAA's data is courtesy of the NOAA Space Weather Prediction Center, a work of
the US government.
