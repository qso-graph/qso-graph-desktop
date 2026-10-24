# Your first steps

Home's welcome lists these steps and ticks each one as you do it. Each is also in the **Setup** menu.

## 1. Add your callsign

**Callsigns → + New**. Enter the callsign, a description you will recognise (*Home station*, *Club
call*) and, if you like, the dates it is valid, and **Add callsign**.

Each callsign is a row in **Your callsigns**, as each Location is: the active one first, with its
**Active** badge, then the rest by start date, newest first. **Make active** on a row makes it the
active one, and the status bar at the bottom always shows which is; a callsign whose end date has
passed is marked **Expired** and cannot be made active. **Edit** opens a callsign's details and
logins.

## 2. Add its logins

With the callsign selected, choose a **Service** (QRZ.com, QRZ Logbook, Logbook of The World,
eQSL, HamQTH or Club Log), enter your username and password or API key, and save them with the
**Save** button, which names your computer's store.

They are saved in your computer's own credential store, the same place your browser keeps
passwords: Credential Manager on Windows, the keyring on Linux, Keychain on macOS. They are never
shown again, never written to the application's own files, and never leave the computer.
**Test credential** checks that QRZ.com or QRZ Logbook accepts them; testing the other services is
to follow.

## 3. Add a Location

**Locations → Add a location**: the place you operate from. Enter its grid square, DXCC entity,
CQ and ITU zones and state; **Fill the county** fills the county, and the ARRL section with it,
the way LoTW wants them. Add POTA, SOTA, WWFF or IOTA references if it has them, or start the whole
Location from a park or a summit with **Add location from a POTA park** or **Add location from a
SOTA summit**, which fill in its grid and state for you to check.

**Make active** chooses the Location you are at; the status bar shows it beside the callsign.

A Location holds only public facts: no street address, and no latitude and longitude.

## 4. Download the reference data

**Settings → Reference data**: download ADIF's definitions, and POTA's parks and SOTA's summits if
you chase or activate them. Nothing is downloaded until you ask, and each list says when it was
last updated.

## 5. Choose what to add

Everything past callsigns and Locations is an extension, and each starts off.
**Settings → Extensions**: turn on the ones you use (Parks On the Air, Astro, Conditions, ADIF
Lookup). Each appears on the rail at the left and is pinned to Home. Turn one off, and it is gone,
with nothing of it running.

## 6. Your POTA focus area

If you use Parks On the Air: **Setup → My POTA Focus Area…** sets the programs, entities and
locations you work (*US-ID*, a whole entity, or a whole program). Most Wanted asks POTA for those
and nothing else. Left empty, it uses your active Location's.

## Operating away from home

The **active callsign and active Location** are what the application uses for everything you do
with them: what a page shows for where you are, and, as logging arrives, what each QSO records and
what is signed for LoTW. The status bar always shows both. Check it before you start.

**Each callsign can have a default Location** (in Locations). Making a callsign active makes its
default Location active too. Making a Location active changes only the Location.

- **A park next week, as yourself:** add the park as a Location (**Add location from a POTA
  park**) and **Make active**. Your callsign stays as it is. When you are home, make your home
  Location active again yourself: nothing switches it back, because nothing knows the activation is
  over.
- **A special-event call:** add the call, and give it the park or event site as its default.
  **Make active** the special-event call, and its Location comes with it. Afterwards, make your
  own callsign active again, and if your home Location is its default, home comes back with it.

Once a special-event call's end date has passed it is marked **Expired** and cannot be made active
by mistake. Its Locations stay, for the next time.
