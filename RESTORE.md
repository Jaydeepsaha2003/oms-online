# Restoring the OMS database

The whole business lives in one file: `apps\api\prisma\dev.db`. A restore means
putting a backup copy of that file back in its place. Use **Route A** whenever
the app is working. Use **Route B** when the app won't start, or when Route A
says the backup is too old.

Both routes were practised on 21-09-2026 against a copy of the real data, and
both worked (see "Practice record" at the bottom).

---

## Where the backups are

| File | Where | Made by / when |
|---|---|---|
| `oms-weekly-backup-YYYY-MM-DD.db` (newest) | `backups\` | The app, **every 5 minutes**, into this week's file. Never more than 5 minutes behind |
| `oms-weekly-backup-YYYY-MM-DD.db` (older) | `backups\` | Each previous week, frozen as it stood at week's end. The newest 12 weeks are kept |
| `pre-restore-*.db` | `backups\` | The app, just before every restore: the database that was replaced |
| `pre-*.db` | `backups\` | Taken by hand before a risky change |
| `oms-backup-YYYY-MM-DD-HHMM.db` | Your **Downloads** folder | Settings → Database backup → **Download backup** |

**Which backup to pick:**

- **Lost the PC's data or the file is damaged?** Use the **newest** weekly file. It's at most 5 minutes old.
- **Someone entered or deleted wrong data?** The newest file **already contains the mistake** once 5 minutes
  have passed. Use the **previous week's** file instead, then re-enter the week's good work.
  There's no "yesterday" copy in between, so take a **Download backup** before any big change.

> ⚠️ Every file in `backups\` is on the **same PC** as the live database. If that disk
> dies, they go with it. Copy the newest backup to a USB drive or another PC regularly.

---

## Route A: from inside the app (normal case)

Use when the app is running and you can sign in as an admin.

1. Ask everyone to stop entering data.
2. Go to **Settings → Database backup → Restore from a backup**.
3. Choose the backup `.db` file and click **Restore this file**.
4. Wait for **"Restored — … now live"**, then refresh the page on every PC.

What the app does for you, in this order:
- Checks the file really is an OMS database and isn't damaged. If not, it refuses, and nothing changes.
- Checks the backup matches this version of the app. **A backup older than the current app is refused.** Use Route B for that.
- **Saves the current database first** as `backups\pre-restore-<date>.db`, so a mistaken restore can itself be undone.
- Swaps the file in, and proves the new one answers before reporting success.

## Route B: by hand (app won't start, or the backup is "too old")

1. Double-click **`stop.bat`**. The app must be fully stopped.
2. In `apps\api\prisma\`, **rename** (don't delete) `dev.db` to `dev.db.broken-<today's date>`.
   If files named `dev.db-journal`, `dev.db-wal` or `dev.db-shm` are there, rename them the same way.
   They belong to the old file.
3. Copy the backup you chose into `apps\api\prisma\` and rename the copy to **`dev.db`**.
4. Delete the file **`.db-sync-stamp`** at the project root. This makes the next start check the database.
5. Double-click **`start.bat`**. It automatically applies any updates the backup is missing
   (`prisma migrate deploy`, which only adds, never drops data), then starts the app.
6. Sign in and check the numbers (below).

To undo Route B, stop the app and put `dev.db.broken-…` back as `dev.db`.

---

## After any restore: check it

- Open **Challans** and **Payments**. The newest entries should be what you expect
  for the backup's date. Anything entered **after** that date is gone and must be re-entered.
- Open one customer in **Party Ledger** and compare their balance with a recent printout.
- Tell everyone the date the data now runs up to.

---

## Practice record

**21-09-2026:** practised on a copy laid out like the server (the live database was not touched):

- Route A, using the app's real restore code: today's backup restored over a deliberately damaged copy.
  Deleted bill lines came back (4458 → 4467), changes made after the backup disappeared,
  row counts matched the backup exactly (2165 challans, 723 ledger rows, 144 customers),
  integrity check `ok`. The safety copy of the replaced database was written.
- Route A correctly **refused** a file that wasn't a database, and **refused** the
  weekly backup because it was older than the app.
- Route B, using that same "too old" weekly backup: `migrate deploy` brought it up to date,
  and it then matched the current app exactly (no differences).

Practise again after any big update, or every few months, so you know it still works.
