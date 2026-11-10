# LoTW

Manage ARRL Logbook of The World certificates through QG Trust. Turn LoTW on in
Settings → Extensions, then open Certificates from the rail.

The extension uses `lotw:read` to show certificates and trusted roots, and
`lotw:manage` to request loading a certificate, restoring a TQSL backup or deleting
a certificate. Desktop chooses files, asks for passwords, and confirms changes.
The extension receives public metadata and outcomes through the extension API.
Signing and certificate management work offline. `lotw:sign` requests signing a
log into a `.tq8`; `lotw:upload` requests a separately confirmed upload. Signing
does not upload. Files and confirmations stay with main and the credential core.

See the [user guide](../../guide/lotw.md). Page actions use `QGD-HOM-0018` through
`QGD-HOM-0020`; LoTW uses `QGD-LTW-0002`.
