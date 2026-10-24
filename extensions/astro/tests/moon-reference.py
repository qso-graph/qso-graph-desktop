# SPDX-License-Identifier: GPL-3.0-only
# Makes moon-reference.json: uv run --with ephem==4.2 python extensions/astro/tests/moon-reference.py > extensions/astro/tests/moon-reference.json
# Reference values for Astro's moon, from PyEphem 4.2: an independent
# ephemeris sharing no code with moon.ts. Rise and set with refraction off and
# the horizon at -0:34 on the upper limb, topocentric: Meeus's h0.
import ephem, json, datetime as dt
places = [
  ('Boise DN13sm', 43.625, -116.2083),
  ('Greenwich', 51.4769, 0.0),
  ('Sydney', -33.8688, 151.2093),
  ('Quito', -0.1807, -78.4678),
  ('Tromso', 69.6492, 18.9553),
]
dates = ['2026-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-10-22', '2026-12-21']
out = []
for name, lat, lon in places:
  for day in dates:
    o = ephem.Observer(); o.lat = str(lat); o.lon = str(lon); o.elevation = 0
    o.pressure = 0; o.horizon = '-0:34'
    # The station's own day, at its longitude, as moon.ts takes it.
    d = dt.datetime.strptime(day, '%Y-%m-%d')
    start = d - dt.timedelta(hours=lon / 15)
    o.date = ephem.Date(start)
    m = ephem.Moon()
    def within(fn):
      try:
        t = fn(m, start=ephem.Date(start))
        tt = ephem.Date(t).datetime()
        return tt.strftime('%Y-%m-%dT%H:%M:%SZ') if tt < start + dt.timedelta(days=1) else None
      except (ephem.AlwaysUpError, ephem.NeverUpError):
        return None
    rise = within(o.next_rising); setting = within(o.next_setting)
    noon = ephem.Date(d + dt.timedelta(hours=12))
    g = ephem.Moon(noon)
    out.append({ 'place': name, 'latitude': lat, 'longitude': lon, 'day': day, 'rise': rise, 'set': setting,
      'noon': noon.datetime().strftime('%Y-%m-%dT%H:%M:%SZ'),
      'declination': round(float(g.dec) * 180 / 3.141592653589793, 4),
      'distanceKm': round(g.earth_distance * 149597870.7, 1),
      'illuminated': round(g.moon_phase, 5) })
print(json.dumps(out, indent=1))
