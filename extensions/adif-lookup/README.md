# ADIF Lookup

QSO Graph Desktop's extension for looking things up in ADIF's own
definitions: every field, and every value of every enumeration (bands, modes,
DXCC entities, and the rest), as the ADIF Development Group publishes them.
It ships with the application as an official extension and, like every extension, starts off: turn it on in **Settings → Extensions**. On, it has an item in the rail as well as a page you can pin.

Type a field, a band, a mode or any ADIF value, as `FT8`, `20m` or
`MY_GRIDSQUARE`. Exact names come first, then names that begin with what you
typed, then entries whose text holds it. Each match is shown on its own, headed by
its name, with a row for each of ADIF's columns, and the matches can be narrowed to
one list.

What it shows is ADIF's text whole, under ADIF's own column names: nothing is added,
joined, reworded or cut. It needs ADIF's definitions downloaded (Setup, Reference Data), and
makes no network request of its own: the core answers its search from the data
it loaded. It holds one grant, `reference:read`.
