# LoTW

Manage ARRL Logbook of The World certificates through QG Trust. Turn LoTW on in
Settings → Extensions, then open Certificates from the rail.

The extension uses `lotw:read` to show certificates and trusted roots, and
`lotw:manage` to request loading a certificate, restoring a TQSL backup or deleting
a certificate. Desktop chooses files, asks for passwords and confirms changes.
The extension receives public metadata and outcomes through the extension API.
It works offline and uploads nothing to LoTW.

See the [user guide](../../guide/lotw.md). Page actions use `QGD-HOM-0018` through
`QGD-HOM-0020`; LoTW uses `QGD-LTW-0002`.
