# Monitor

QSO Graph Desktop's Monitor: what WSJT-X decodes, as it decodes it, read-only (`QGD-INT-0023`).
It ships with the application as an official extension and, like every extension, starts off:
turn it on in **Settings → Extensions**, with the [WSJT-X adapter](../wsjtx/README.md) it reads
from. On, it is a destination in the rail.

| On the page | What it is |
|---|---|
| **All** | every source together, each decode marked with the copy of WSJT-X it came from |
| one tab per source | one copy of WSJT-X, by the name WSJT-X gives it (`QGD-INT-0011`) |
| **Settings** | how the grid looks, and nothing else: how many cycles it shows, 10, 20 or 40 |

Each tab shows its source's status line, from WSJT-X's Status: the dial frequency, the mode, and
whether it is transmitting, decoding or receiving, with when it was last heard. Below it are the
decodes, grouped by cycle as they arrive, newest first: the time (UTC), the report in dB, the time
offset, the audio offset in hertz, and the message, with low-confidence and off-air decodes
marked. The window is bounded: the last 40 cycles, at most 500 decodes. When WSJT-X clears its
window, or closes, so does the Monitor's.

WSJT-X writes a hashed callsign in angle brackets, `<PJ4/K1ABC>`; a page draws no markup, so the
Monitor shows them as `‹PJ4/K1ABC›`.

The Monitor holds one grant, `integration:events`, and receives events the core has already
checked (`QGD-INT-0021`). It never receives a byte or an address, opens nothing and sends nothing
to any program. Nothing it receives changes your data (`QGD-INT-0009`).
