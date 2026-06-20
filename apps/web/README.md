# @oms/web

Vite + React + TypeScript frontend with shadcn/ui and Tailwind v4.

## Layout

```
src/
├─ main.tsx               # entry: providers + router
├─ App.tsx                # bootstraps the session, renders routes
├─ index.css             # Tailwind v4 + shadcn design tokens
├─ app/
│  ├─ providers.tsx      # React Query + Tooltip + Toaster
│  └─ router.tsx         # routes generated from the shared MENU, permission-gated
├─ components/
│  ├─ ui/                # shadcn/ui primitives (add more with the shadcn CLI)
│  ├─ layout/            # app-shell, sidebar (dynamic menu), topbar
│  ├─ auth/              # ProtectedRoute, RequirePermission
│  └─ common/            # placeholders, loaders
├─ features/             # one folder per screen (auth, dashboard, …)
├─ hooks/                # use-auth, use-permissions
├─ lib/                  # api (axios), excel, pdf, icons, query, utils
└─ stores/               # auth-store (zustand)
```

## Key pieces

- **Dynamic menu** — `components/layout/sidebar.tsx` renders `filterMenu(permissions, MENU)`
  from `@oms/shared`. Items the user can’t access never show. Add a node to `MENU`
  → it appears here and a permission-gated route is created automatically.
- **Auth** — `lib/api.ts` attaches the bearer token and silently refreshes on 401
  (using the httpOnly refresh cookie). `stores/auth-store.ts` holds the session.
- **Access control in UI** — `usePermissions().can('order:create')` to show/hide
  buttons; `<RequirePermission>` to gate routes.
- **Excel** — `lib/excel.ts`: `exportToExcel`, `parseExcelFile`, `downloadTemplate`.
  For server exports use `downloadFile()` in `lib/api.ts`.
- **PDF** — `lib/pdf.ts`: `downloadPdf` / `openPdf` for server-generated documents.

## Add a shadcn component

```bash
cd apps/web
npx shadcn@latest add table dialog select   # etc.
```

## Scripts

`npm run dev` · `npm run build` · `npm run preview` · `npm run lint` (typecheck).
Configure `apps/web/.env` (copy from `.env.example`) with `VITE_API_URL`.
