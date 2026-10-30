# WSJT-X

QSO Graph Desktop's adapter for [WSJT-X](https://wsjt.sourceforge.io/): it turns what WSJT-X
sends over the network into events for the [Monitor](../monitor/README.md) (`QGD-INT-0022`). It
ships with the application as an official extension and, like every extension, starts off: turn
it on in **Settings → Extensions**. On, Integrations opens its port, WSJT-X's usual 2237, on this
computer alone; Integrations' page is where to change the port, or listen on a network for a
WSJT-X on another computer.

WSJT-X is untouched. In WSJT-X, set **File → Settings → Reporting → UDP Server** to this
computer's address and the port. To have the Monitor fill with what WSJT-X already decoded,
turn on **Accept UDP requests** there too: without it WSJT-X ignores every request it is sent,
Replay included (`Network/MessageClient.cpp`), and the Monitor fills from the next cycle.

| What WSJT-X sends | What it becomes |
|---|---|
| Heartbeat | that this copy of WSJT-X is there |
| Status | the dial frequency, mode, and whether it is transmitting or decoding |
| Decode, WSPRDecode | one decode each, with its time (UTC), report, time and audio offsets, and message |
| Clear, Close | the window cleared; WSJT-X closing |

Each copy of WSJT-X is a source of its own, by the name WSJT-X gives it (its `Id`, which
`--rig-name` sets), so two rigs are two tabs on the Monitor (`QGD-INT-0011`). The first time a copy
is heard it is asked, once, for the decodes already in its window (Replay): that is the only thing
this adapter sends, and only to the copy it heard (`QGD-INT-0009`). Messages of other types are
ignored, as the protocol requires; anything that is not WSJT-X's message read exactly is dropped
and counted on Integrations' page, never shown (`QGD-INT-0008`).

The protocol is read as WSJT-X's own
[`Network/NetworkMessage.hpp`](https://github.com/WSJTX/wsjtx/blob/master/Network/NetworkMessage.hpp)
defines it, schema 3. The decoder is fuzz-tested and checked against messages captured from
WSJT-X (`tests/`), and the end-to-end suites drive it with
[`qso-graph-sim`](https://github.com/qso-graph/qso-graph-sim) (`QGD-INT-0024`).
