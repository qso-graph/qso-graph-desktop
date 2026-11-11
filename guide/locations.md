# Locations

Open **Locations** from the rail or **Setup → Locations**. Choose **Add a location**
to name a place and give its grid. You can also fill in its DXCC entity, subdivisions,
zones and activity references. Choose a Location to edit it or make it active.

## Sync from TQSL

If you already keep station locations in TQSL, choose **Sync from TQSL…**. Desktop
reads TQSL's locations on your computer and opens a confirmation showing the folder,
each location's fields and the name it will receive.

- **New**: the name is available. Selected by default.
- **Same**: a Desktop Location with this name already has these fields. No copy is offered.
- **Differs**: the name exists with different fields. Review the two values shown for each
  difference. You can select a separate copy named **(TQSL)**, with a number if needed.
  It starts unselected. Your existing Location stays as it is.
- **Refused**: the location cannot be copied. Read the reason shown beside it.

Tick the Locations you want and choose **Create Locations**. **Cancel** saves nothing.
A TQSL national park code goes into **LoTW park**, separately from a POTA reference.

Desktop reads only TQSL's `station_data` file, when you choose Sync. It leaves TQSL's
files unchanged and keeps no connection to them. Later edits in either program do not
change the other program's locations. No certificate or key is read, and Sync needs
no Internet connection.

Desktop uses TQSL's folder: `TQSLDIR` when set to a nonempty value;
`%APPDATA%\TrustedQSL` on Windows; `$HOME/.tqsl` on macOS and Linux.
If the file is missing, the confirmation says TQSL has no locations and shows the folder.
