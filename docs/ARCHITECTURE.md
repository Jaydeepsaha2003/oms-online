# OMS Architecture

A guide to how the system fits together and how to extend it.

## Big picture

```
┌─────────────────────────┐         HTTPS / JSON         ┌──────────────────────────┐
│        apps/web         │  ─────────────────────────▶  │         apps/api          │
│  React + Vite + shadcn  │   Bearer access token +      │   NestJS + Prisma         │
│                         │   httpOnly refresh cookie    │                           │
│  • dynamic menu         │  ◀─────────────────────────  │  • JWT auth + RBAC guards │
│  • RBAC-gated routes    │                              │  • audit interceptor      │
│  • Excel / PDF helpers  │                              │  • Excel / PDF services   │
└───────────┬─────────────┘                              └───────────┬──────────────┘
            │                                                        │
            └──────────────────  packages/shared  ───────────────────┘
               types · permission catalog · roles · MENU registry
                          (the contract both sides import)
                                       │
                                  ┌────┴────┐
                                  │  MySQL  │  (Prisma)
                                  └─────────┘
```

`packages/shared` is the contract: defining an `Order` type, a permission, or a
menu node once makes it available to both the API and the web app.

## Access control (RBAC), end to end

1. **Catalog** — `packages/shared/src/permissions.ts` lists every
   `resource:action` permission. The seed inserts them into the `Permission` table.
2. **Roles** — map to sets of permissions (`role_permissions`). Users map to roles
   (`user_roles`). Both are editable at runtime (Roles & Users screens).
3. **API enforcement** — `@Permissions('order:create')` on a route; `PermissionsGuard`
   checks the user’s live permission set (rebuilt from the DB each request).
   `*` (super admin) and `<resource>:manage` are wildcards.
4. **UI gating** — `usePermissions().can(...)` hides actions; `<RequirePermission>`
   gates routes; `filterMenu()` hides menu entries. Same rules, shared code.

> UI gating is for UX only. The API is the source of truth — every protected
> action is enforced server-side regardless of what the client shows.

## Authentication & sessions

- **Access token** (JWT, short-lived) in the `Authorization` header; carries a
  `tokenVersion` so all sessions can be invalidated at once.
- **Refresh token** (random, hashed, stored) in an httpOnly cookie; rotated on
  every refresh and revocable (logout / password change).
- The web axios client refreshes transparently on a 401 (single-flight).

## Audit logging

`AuditInterceptor` records every mutating request automatically: user, action,
resource, resource id, method, path, status, IP, user-agent, timestamp.
Annotate routes with `@Audit({ action, resource, description })` for richer
entries. Auth events are logged explicitly by `AuthService`.

## Cross-cutting services

| Concern | API | Web |
| ------- | --- | --- |
| Excel   | `ExcelService` (`export`, `jsonToBuffer`, `parse`, `template`) | `lib/excel.ts` (`exportToExcel`, `parseExcelFile`, `downloadTemplate`) |
| PDF     | `PdfService` (pdfmake — `render`, `renderTable`) | `lib/pdf.ts` (`downloadPdf`, `openPdf`) |

Both Excel and PDF services are `@Global()` — inject them into any module.

## Recipe: add a new module (e.g. Orders)

1. **Schema** — add the `Order` model to `apps/api/prisma/schema.prisma`,
   then `npm run db:migrate`.
2. **Permissions** — the `order` resource already exists in the shared catalog;
   re-run `npm run db:seed` if you add new resources/actions.
3. **API** — generate `apps/api/src/orders/{module,controller,service}.ts`.
   Guard routes with `@Permissions('order:*')`, annotate with `@Audit`, inject
   `ExcelService`/`PdfService` for export/PDF endpoints.
4. **Shared types** — add `OrderDto`, `CreateOrderDto`, etc. to `@oms/shared`.
5. **Web** — add `src/features/orders/*`, hooks using `http` + React Query, and a
   form with `react-hook-form` + `zod`.
6. **Menu** — the `orders` node is already in `MENU`; for new screens add a node
   with the right `permission`. It appears in the sidebar and gets a route.

## Conventions

- Permissions are `resource:action` (lowercase).
- API responses are wrapped `{ success, data }`; the web client unwraps them.
- List endpoints accept `PaginationDto` (`page`, `pageSize`, `search`, `sortBy`,
  `sortOrder`) and return `Paginated<T>`.
- Errors return the `ApiError` envelope; the web reads `.message`.
