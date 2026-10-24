# Offline and the Internet lamp

QSO Graph Desktop works without the internet. What needs it says so, and waits for the network
rather than failing.

**The Internet lamp**, in the header beside the clock:

- **Green**: online.
- **Yellow**: on a network, but the last request could not get through.
- **Red**: offline.

**Works offline:** callsigns and Locations, Astro, ADIF Lookup, and Parks On the Air's Near Me,
once the reference data is downloaded.

**Needs the internet:** Conditions, Parks On the Air's Spots and Most Wanted, testing a login,
downloading reference data, and checking for updates. Each waits until you are back online.

Nothing is fetched in the background: a page asks only while it is open.
