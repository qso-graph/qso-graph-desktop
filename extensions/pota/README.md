# Parks On the Air

QSO Graph Desktop's built-in extension for POTA. It ships with the application, is on by default, and can be turned
off; off, its destination leaves the rail and its pins leave Home, and nothing of it runs. It was split from On the Air
on 2026-10-23 so that its switch turns off POTA and nothing else (KI7MT: "On switch, the lights go out").

It is one destination on the rail, Parks On the Air, whose area has three tabs (`QGD-HOM-0003`):

| Tab | Internet | What it shows | Asked at most every |
|---|---|---|---|
| **Near Me** | online or offline | The parks within 300 km of the active Location, nearest first, from POTA's park list on this computer (`pota.near`): distance, bearing and location, narrowed by Program, Entity, Location and distance (`QGD-HOM-0013`) | 10 minutes |
| **Spots** | online only | Who is activating a POTA park now, from POTA's spot list: activator, park, location, frequency, ADIF's band, mode and the time spotted in UTC, newest first, narrowed by Entity, band, mode and location (`QGD-HOM-0011`) | 1 minute; Refresh no sooner than 10 seconds |
| **Most Wanted** | online only | My Area's parks with POTA's count of each one's activations, nearest first, starting on Never activated (`pota.activations`, `QGD-HOM-0014`). Only POTA's API has those counts | 1 hour; the counts themselves once a day |

A tab is asked for only while it is on screen, and a tab that needs the internet not at all while the computer is
offline (`QGD-HOM-0005`). It runs in the extension host and reaches the core only through the extension API
(`QGD-APP-0002`): POTA's spots are fetched by the core from the registered source (`pota-spots`); the park list, each
location's program and entity (`pota.places`), My Area (`area.get`) and the activation counts are the core's to answer
from reference data (`reference:read`, `station:active`). ADIF's bands (`adif.bands`) name each spot's band.

POTA's data is courtesy of Parks on the Air, fetched from POTA and never redistributed.
