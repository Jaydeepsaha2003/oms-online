# Running OMS offline on this PC

OMS runs entirely on your own machine — a local **SQLite** database file and one
local server. No internet or cloud is needed for day-to-day use.

## Daily use

1. **Double-click `START-OMS.cmd`.**
2. A window opens (leave it open) and your browser goes to **http://localhost:4000/**.
3. Sign in. To stop the app, **close that window**.

Other devices on the same Wi-Fi can use it too — open `http://<this-pc-name-or-IP>:4000/`
on their browser while `START-OMS` is running on this PC. (The mic/voice feature is
the only thing that needs internet; everything else is fully offline.)

> First launch only: `START-OMS` installs and builds the app once (needs internet
> that one time). After that it starts instantly and works offline.

## After a code change

Run **`BUILD-OMS.cmd`** once (needs internet), then use `START-OMS` as usual.

## Backups — important

All your data is in a single file: `apps/api/prisma/dev.db`. Back it up.

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

## Auto-start on boot (optional)

If you want OMS to start whenever the PC turns on, put a shortcut to `START-OMS.cmd`
in your Startup folder: press `Win+R`, type `shell:startup`, and drop a shortcut there.
