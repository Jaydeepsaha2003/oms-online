# Running OMS on this PC

OMS runs entirely on your own machine — a local database and two local servers
(API + web). No internet or cloud is needed for day-to-day use.

## Daily use

1. **Double-click `start.bat`.** It builds anything that changed, starts both
   servers hidden in the background, and closes its own window after a few
   seconds. The servers keep running.
2. Open **https://localhost:6173** on this PC. `start.bat` also prints an
   `https://<this-pc-ip>:6173` address to use on a phone.
3. To stop everything, double-click **`stop.bat`**.

Every expensive step is skipped when nothing it depends on changed, so a
relaunch with no code changes takes seconds.

> First launch only: `start.bat` installs and builds the app once (needs
> internet that one time). After that it starts offline just as fast — nothing
> the servers need at runtime comes from the network.

## After a code change

Run **`restart.bat`**. It builds *first*, while the current servers keep
serving, then relaunches only what actually changed:

- **frontend only** → nothing is restarted; the new bundle is live immediately
- **backend only** → only the API is bounced (~3s); the open page stays put
- **shared package** → both, since API and web are built from it

A build error always leaves the running servers untouched.

## The other scripts

| Script | When |
| ------ | ---- |
| `start.bat` | Start the app (daily) |
| `stop.bat` | Stop the app |
| `restart.bat` | Apply code changes |
| `logs.bat` | Watch the live server log — closing it does **not** stop the servers |
| `dev.bat` | Active coding only: raw Vite dev server on :5173 with fast edit+refresh |
| `setup\phone-url.bat` | Print the URL(s) to open on a phone right now, plus server status |

Everything in **`setup\`** is run **once** per machine:

| Script | What it does |
| ------ | ------------ |
| `setup\enable-lan-access.bat` | Opens the Windows Firewall so phones on the same Wi-Fi can reach the app. Needs administrator. |
| `setup\disable-lan-access.bat` | Closes those firewall ports again. |
| `setup\enable-autostart.bat` | Registers a boot-time task so OMS starts at power-on, **before anyone logs in**. Needs administrator. |
| `setup\disable-autostart.bat` | Removes that task and the logon keep-alive shortcut. |
| `setup\enable-always-on.bat` | The full "on whenever the PC is on" setup: boot task + stops Windows powering down the Wi-Fi adapter + disables Fast Startup and sleep. Needs administrator. |

Other devices on the same Wi-Fi can use OMS too — run
`setup\enable-lan-access.bat` once, then open the `https://<ip>:6173` address
that `start.bat` prints. (The mic/voice feature is the only thing that needs
internet; everything else is fully offline.)

## Backups — important

All your data is in the database file `apps/api/prisma/dev.db`. Back it up.

- **Automatic daily:** double-click `scripts/register-daily-backup.cmd` **once**.
  It schedules a copy every day at 9:00 PM into the `backups/` folder (keeps the
  newest 30). If it says "run as administrator", right-click → Run as administrator.
- **On demand:** double-click `scripts/backup-db.cmd` any time.
- **Off-machine copy:** occasionally copy the `backups/` folder to a USB drive or
  another disk — a single PC has no other safety net.

## Security notes

- Strong JWT secrets are set in `apps/api/.env` (keep this file private).
- **Change the admin password** after first sign-in: open **Settings** in the app.
- Keep this PC's own login/screen lock on; anyone at this machine can reach the app.
