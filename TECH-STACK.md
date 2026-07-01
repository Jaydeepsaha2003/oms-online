# OMS — Technology Stack

**Project:** Production & Order Management System (OMS) — a web-based application that ports a legacy MS Access / VB.NET desktop app to a modern online stack.

**Shape:** A TypeScript **monorepo** managed with **npm workspaces**, split into a React frontend, a NestJS backend, and a shared package of types/permissions consumed by both.

```
oms/
├─ apps/
│  ├─ web/      → Frontend  (React + Vite)
│  └─ api/      → Backend   (NestJS + Prisma)
└─ packages/
   └─ shared/  → Shared types, RBAC permissions, roles, dynamic menu (ESM + CJS)
```

---

## At a glance

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript 5.7 (end to end) |
| **Frontend** | React 18, Vite 6, Tailwind CSS 4, shadcn/ui + Radix UI |
| **Backend** | NestJS 11 (Node.js ≥ 20, Express) |
| **Database** | Prisma ORM 6 → **SQLite** (schema portable to MySQL/PostgreSQL) |
| **Auth** | JWT (access + refresh) + PIN login, Passport, RBAC permission guard |
| **State/Data** | TanStack React Query (server state) + Zustand (client state) |
| **Docs/PDF** | pdfmake (server), jsPDF + html2canvas (client) |
| **Excel** | SheetJS (xlsx) on both ends |
| **Monorepo** | npm workspaces + `concurrently` |
| **Tooling** | TypeScript, Prettier, `tsc` type-check as lint |

---

## Frontend — `apps/web`

| Area | Library | Version |
|------|---------|---------|
| UI library | **React** + React DOM | 18.3 |
| Build tool / dev server | **Vite** + `@vitejs/plugin-react` | 6.0 |
| Styling | **Tailwind CSS** (via `@tailwindcss/vite`) + `tw-animate-css` | 4.0 |
| Components | **shadcn/ui** pattern on **Radix UI** primitives (dialog, popover, dropdown, tooltip, avatar, scroll-area, label, separator, slot) | 1.x |
| Class utilities | `class-variance-authority`, `clsx`, `tailwind-merge` | — |
| Command palette / combobox | `cmdk` | 1.1 |
| Icons | **lucide-react** | 0.469 |
| Routing | **React Router** (`react-router-dom`) | 7.1 |
| Server-state / data fetching | **TanStack React Query** | 5.64 |
| Client state | **Zustand** | 5.0 |
| Forms + validation | **React Hook Form** + `@hookform/resolvers` + **Zod** | 7 / 3 |
| HTTP client | **Axios** | 1.7 |
| Toasts | **Sonner** | 1.7 |
| PDF (client) | **jsPDF** + **html2canvas-pro** | 4 / 2 |
| Excel (client) | **xlsx** (SheetJS) | 0.18 |
| Fonts | Inter Variable + JetBrains Mono Variable (`@fontsource-variable`) | 5.2 |

---

## Backend — `apps/api`

| Area | Library | Version |
|------|---------|---------|
| Framework | **NestJS** (`common`, `core`, `platform-express`) | 11.0 |
| Runtime | **Node.js** ≥ 20 on **Express** | — |
| ORM | **Prisma** (`@prisma/client` + `prisma`) | 6.2 |
| Database | **SQLite** (dev/current); schema written to migrate to MySQL/PostgreSQL | — |
| Config | `@nestjs/config` | 3.3 |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `bcryptjs`, `cookie-parser` | — |
| Validation | `class-validator` + `class-transformer` (DTOs) | 0.14 / 0.5 |
| API docs | **Swagger** (`@nestjs/swagger`, OpenAPI at `/api/docs`) | 11.0 |
| Rate limiting | `@nestjs/throttler` | 6.4 |
| Security headers | **Helmet** | 8.0 |
| PDF generation | **pdfmake** (invoices, challans, bills — amount-in-words, etc.) | 0.2 |
| Excel export/import | **xlsx** (SheetJS) | 0.18 |
| Reactive utils | **RxJS** | 7.8 |

### Authentication & access control
- **JWT** access + refresh tokens; plus a **numeric PIN** quick-login for a remembered device.
- Passwords & PINs hashed with **bcryptjs**; `tokenVersion` allows invalidating all tokens.
- **RBAC**: roles → permissions (resource + action keys) enforced by a global `PermissionsGuard`; super-admin gets a `*` wildcard. Guard order is throttle → authenticate → authorize.

### Data & migrations
- Prisma schema + migrations; seed script loads the permission catalog, system roles and a bootstrap admin.
- **Temporary MS Access connector** (data migration): uploads a legacy `.accdb`, exports each table to JSON via the Windows **ACE OLEDB** provider (spawned **PowerShell**), then imports in-process with Prisma. Scoped so it can be deleted cleanly later.

---

## Shared — `packages/shared`

- Framework-agnostic **TypeScript** package holding: shared **types/DTOs**, the **RBAC permission catalog**, **system roles**, and the **dynamic menu registry** (the sidebar is computed from this tree, filtered by the user's permissions).
- Also home to cross-stack business logic that must not drift between client and server (e.g. `computeChallanTotals`).
- Built to **dual ESM + CJS** (`tsc` twice) so the ESM frontend and CJS backend both consume the same source of truth.

---

## Database

- **Prisma ORM** over **SQLite** today (single-file DB, zero external service — easy local/dev).
- The schema is intentionally written to be **portable**: switch the datasource `provider` to `mysql`/`postgresql`, restore enums/`Json` columns, and re-migrate. (`status` fields are validated strings and JSON is stored as serialized strings for SQLite compatibility.)
- Integer primary keys on business tables mirror the legacy IDs to ease import.

---

## Tooling & workflow

| Tool | Purpose |
|------|---------|
| **npm workspaces** | Monorepo dependency + script management |
| **concurrently** | Run shared + api + web dev servers together (`npm run dev`) |
| **TypeScript 5.7** | One language across web, api and shared; `tsc --noEmit` used as the lint gate |
| **Prettier 3** | Code formatting |
| **rimraf** | Clean build artifacts |
| **Prisma CLI** | `migrate`, `db push`, `db seed`, `studio` |
| **Nest CLI** | Backend build/dev (`nest build` / `nest start --watch`) |

### Common commands (run from repo root)
```bash
npm install            # installs all workspaces; builds @oms/shared
npm run dev            # shared (watch) + api (watch) + web (Vite) together
npm run build          # build shared → api → web
npm run db:migrate     # apply DB migrations (api)
npm run db:seed        # seed permissions, roles, admin user
```

### Dev endpoints
- **API** → `http://localhost:4000/api` (Swagger UI at `/api/docs`)
- **Web** → `http://localhost:6173` (Vite dev server)

---

## Application capabilities (what runs on this stack)
Role-based access control & dynamic menu · Customers, Agents, Transporters · Products, Designs, Design names, Combinations · GST rates & Transport rates · Special (customer-specific) rates · Orders & Quotations · Dispatch · **Challans / Tax invoices** (pending list, Form14-style create/edit with configurable prefixes → `PREFIX/FY/serial`, PDF print, item-wise history) · Settings (company branding, order options, challan prefixes) · Audit log · Excel import/export · Server-generated PDFs.

---

*Generated from the workspace manifests (`package.json`) and `prisma/schema.prisma`. Versions shown are the declared ranges (`^`), i.e. the current major line.*
