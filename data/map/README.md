# Natural Earth: land, 1:110m

`ne_110m_land.geojson` is [Natural Earth](https://www.naturalearthdata.com/)'s
1:110m land polygons, version **5.1.2**, exactly as published at
<https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson>,
SHA-256 `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`
(pinned in `data/map-sources.json`).

It is **Natural Earth's work, not ours.** Natural Earth is in the public domain:
"You may use the maps in any manner, including modifying the content and design,
electronic dissemination, and offset printing. … No permission is needed to use
Natural Earth." We credit it anyway, in `NOTICE` and under every map the application
draws: *Made with Natural Earth. Free vector and raster map data @
naturalearthdata.com.* Thank you to its authors.

It is plain GeoJSON text, coordinates only, so it can be read and diffed like any
other file. `scripts/build-map.mjs` checks it against the SHA-256 above, then keeps
the coastlines as one outline to a tenth of a degree, which is what ships inside
the application. To update it, replace the file with a newer release and update
the URL, version and SHA-256 here and in `data/map-sources.json`.
