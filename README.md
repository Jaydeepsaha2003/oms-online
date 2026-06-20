# OMS — Production & Order Management System

A multi-user web application for production and order management, built as a
TypeScript monorepo.

| Layer        | Stack                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Backend**  | Node.js · NestJS · Prisma · **MySQL** · JWT auth · RBAC · audit logging     |
| **Frontend** | React · Vite · TypeScript · Tailwind v4 · shadcn/ui · TanStack Query        |
| **Shared**   | End-to-end TypeScript types, permission constants, the dynamic menu registry |
| **Cross-cutting** | Excel import/export (SheetJS) · PDF generation (pdfmake) · per-level access control · audit trail |

> **Status:** architectural scaffold. The foundation, security model, shared
> services and the dynamic permission-aware menu are in place. Business screens
> (orders, products, production, etc.) are added form-by-form on top of this.

---

## Repository layout

```
oms/
├─ packages/
│  └─ shared/            # @oms/shared — types, permissions, roles, MENU registry
├─ apps/
│  ├─ api/              # @oms/api  — NestJS + Prisma (MySQL)
│  └─ web/              # @oms/web  — Vite + React + shadcn/ui
├─ package.json          # npm workspaces + root scripts
├─ tsconfig.base.json    # shared TS compiler options + path aliases
└─ .env.example          # copy to .env and fill in
```

See [`apps/api/README.md`](apps/api/README.md) and
[`apps/web/README.md`](apps/web/README.md) for app-specific details, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together
and how to add a new module/screen.

---

## Prerequisites

- **Node.js ≥ 20** (22 recommended — see `.nvmrc`)
- **A MySQL database (8.x) or MariaDB.** None is bundled. Options:
  - **Local:** MySQL Community Server, or XAMPP/WAMP/MariaDB on Windows.
  - **Cloud free tier:** [Aiven](https://aiven.io), [Railway](https://railway.app),
    or [PlanetScale](https://planetscale.com) — grab a connection string and paste it
    into `DATABASE_URL`.

---

## Getting started

```bash
# 1. Install all workspaces in one shot
npm install

# 2. Configure environment (per-app files)
cp apps/api/.env.example apps/api/.env   # then edit DATABASE_URL + JWT secrets
cp apps/web/.env.example apps/web/.env

# 3. Build shared types and generate the Prisma client
npm run build:shared
npm run db:generate

# 4. Create the database schema and seed roles + an admin user
npm run db:migrate            # runs prisma migrate dev (needs a reachable MySQL)
npm run db:seed

# 5. Run everything (shared watcher + API + web) together
npm run dev
```

- API → http://localhost:4000/api (Swagger docs at `/api/docs`)
- Web → http://localhost:6173

> First time without a database yet? You can still run `npm install` and
> `npm run build` — only `db:migrate`/`db:seed`/`db:studio` need a live MySQL.

---

## Root scripts

| Script                 | What it does                                              |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Run shared (watch) + API + web concurrently              |
| `npm run build`        | Build shared → api → web                                  |
| `npm run db:generate`  | Generate the Prisma client                               |
| `npm run db:migrate`   | Create/apply a dev migration                             |
| `npm run db:deploy`    | Apply migrations in production (no prompts)              |
| `npm run db:seed`      | Seed permissions, roles and the bootstrap admin          |
| `npm run db:studio`    | Open Prisma Studio (visual DB browser)                   |
| `npm run lint`         | Lint api + web                                            |
| `npm run format`       | Prettier-format the repo                                 |

---

## Auto-starting the dev servers

`npm run dev` runs the shared watcher + API + web together. To avoid typing it,
pick whichever is most convenient:

1. **Double-click** `dev.bat` (repo root). It installs deps on first run, starts
   everything, and opens http://localhost:6173 in your browser. Keep the window
   open; press `Ctrl+C` to stop.

2. **Auto-start when you open the project** in VS Code / Cursor. `.vscode/tasks.json`
   has a `folderOpen` task. The first time, allow it via Command Palette →
   **Tasks: Manage Automatic Tasks** → **Allow Automatic Tasks in Folder**, then
   reopen the project. (To stop auto-running, choose *Disallow* there.)

3. **Auto-start on Windows login** (opt-in). Run this once in PowerShell to add a
   Startup shortcut to `dev.bat`:

   ```powershell
   $w = New-Object -ComObject WScript.Shell
   $lnk = $w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'OMS Dev.lnk'))
   $lnk.TargetPath = 'C:\Users\user\Documents\Swaroop Ji New OMS Work\OMS - Online 19.06.2026\dev.bat'
   $lnk.WorkingDirectory = 'C:\Users\user\Documents\Swaroop Ji New OMS Work\OMS - Online 19.06.2026'
   $lnk.Save()
   ```

   To undo: `Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'OMS Dev.lnk')`

The servers hot-reload on code changes, so you rarely need to restart them.

## The cross-cutting features

Every screen you build later inherits these automatically:

- **Access control at every level** — permissions are `resource:action` strings
  (e.g. `order:create`). Backend routes are protected with `@Permissions(...)`
  guards; the frontend hides/disables actions and whole menu entries the user
  can't access. See `packages/shared/src/permissions.ts`.
- **Audit logging** — a NestJS interceptor records who did what, when, from where
  (user, action, resource, IP, user-agent, before/after) for every mutating
  request. See `apps/api/src/audit`.
- **Excel everywhere** — `ExcelService` (API) + `lib/excel.ts` (web) give you
  one-line import and export for any table, powered by SheetJS.
- **PDF generation** — `PdfService` (pdfmake) renders documents (invoices, work
  orders, reports) server-side; the web app downloads them.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before adding a feature.
