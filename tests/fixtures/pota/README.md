# POTA spots, made up

`activator.json` is **made up**, in the shape `https://api.pota.app/spot/activator`
sends, for the Parks On the Air page (`QGD-HOM-0011`). No real spot is recorded
here: the callsigns are KI7MT's own and the `N0CALL` placeholder, and the parks are
named "Made-up Park". The last three entries are each wrong in one way, so the page
is shown to leave them out rather than draw them.

It is named for the URL's last segment, as `packages/main/source-fixtures.ts`
looks it up, and `tests/fixtures/noaa/quiet/activator.json` is the same file, so
the window suites and the screenshots draw it rather than the network.
