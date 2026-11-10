# LoTW certificates

Turn on **LoTW** in **Settings → Extensions**, then open **Certificates** from the rail.
LoTW manages ARRL Logbook of The World certificates through QG Trust on your computer.
Certificate management and signing work offline. Uploading is a separate action.

Choose **Load certificate…** to open a `.tq6` certificate or a `.p12` file. Choose
**Restore TQSL backup…** to open a `.tbk` backup. Desktop inspects the file, asks for a
password when one is needed, and shows the proposed changes for you to confirm.
A backup can also offer to create Desktop Locations from its station locations.

The table shows each certificate's callsign, DXCC entity, serial number, QSO date
range, validity and whether its key is installed. A certificate without its key
cannot sign QSOs. **Trusted roots** lists the certificate authorities QG Trust trusts.

To remove a certificate and its key, choose **Delete…** on its row and review the
confirmation. After any operation, the status line says what happened and the table
refreshes. **Cancelled** means no changes were made. A refused certificate stays unchanged.
If an outcome is unknown, refresh the page and check the store before trying again.

## Sign a log

Choose **Sign log…** and open an ADI (`.adi`), ADX (`.adx`) or Cabrillo (`.log`)
file. Review the QSO count, dates, and station calls in the log. Choose your
**Callsign**, **Certificate**, and **Location**. Desktop starts with your active
callsign and Location. The station fields shown are the fields LoTW receives.
Your Location needs a DXCC entity, and the certificate needs its installed key.

Leave both dates blank for all dates, or enter a **From** or **To** date in UTC.
Review the counts and refused records. A record that disagrees with your Location
or callsign is left out; the reason names its field and line or record number.
There is no option to replace your Location with the log's station values.
Already-signed QSOs are left out unless you select **Sign again**.

Choose **Sign…**, then select where to save the `.tq8`. The proposed name is the
log's name, in the same folder. Choose a new filename if it already exists.
The result shows how many QSOs were signed, left out as already signed, or
refused. Signing does not upload your log.

## Upload a signed log

Choose **Upload signed log…** and open a `.tq8`, or choose **Upload to LoTW…**
from a signing result. Review the filename, certificate callsign and serial,
QSO count and dates, then choose **Upload**. **Cancel** sends nothing.
The signed file includes its public certificate.

Acceptance means LoTW received the log for processing; it does not confirm the
QSOs. If the connection fails or the answer is not recognized, check LoTW before
trying again. Desktop does not retry automatically.
