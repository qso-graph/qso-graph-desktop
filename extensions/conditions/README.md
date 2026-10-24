# Conditions

QSO Graph Desktop's built-in extension for HF conditions (`QGD-HOM-0008`). It ships with the application, is on by
default, and can be turned off; off, its destination leaves Home and nothing of it runs. It was On the Air's first page
until 2026-10-23, when On the Air was split so that each switch turns off one destination (KI7MT).

| Page | What it shows | Asked at most every |
|---|---|---|
| **Conditions** | Solar flux, the planetary K and A indices, NOAA's space weather scales (R, S, G) with an alert when any is above 0, and the band-by-band outlook as Band, Status and Comment, graded on the scale in [BAND-OUTLOOK.md](BAND-OUTLOOK.md) | 15 minutes |

It is asked for only while it is open, and not at all while the computer is offline (`QGD-HOM-0005`). It runs in the
extension host and reaches the core only through the extension API (`QGD-APP-0002`). Its data is fetched by the core from
the sources the register names: NOAA's `noaa-flux`, `noaa-kp` and `noaa-scales`.

`solar-mcp` is the specification for Conditions. Its parsing and band table are followed here, and both are tested
against the same recorded NOAA responses (`tests/fixtures/noaa`).

NOAA's data is courtesy of the NOAA Space Weather Prediction Center, a work of the US government.
