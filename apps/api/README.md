# @oms/api

NestJS + Prisma (MySQL) backend for the OMS.

## Layout

```
src/
├─ main.ts                 # bootstrap: helmet, CORS, validation, Swagger
├─ app.module.ts           # wires global guards / interceptors / filter
├─ config/                 # typed env configuration + validation
├─ prisma/                 # PrismaService (+ global module)
├─ common/                 # decorators, guards, interceptors, filters, dto
│  ├─ decorators/          # @Public @Permissions @CurrentUser @Audit
│  ├─ guards/              # JwtAuthGuard, PermissionsGuard
│  ├─ interceptors/        # TransformInterceptor (response envelope)
│  └─ filters/             # HttpExceptionFilter (error envelope)
├─ auth/                   # login / refresh / logout / me / change-password
├─ users/                  # user CRUD + role assignment + Excel export
├─ roles/                  # role CRUD + permission grants
├─ permissions/            # permission catalog (for the role editor)
├─ menu/                   # permission-filtered navigation
├─ audit/                  # AuditService + global AuditInterceptor
├─ excel/                  # ExcelService (SheetJS import/export)
└─ pdf/                    # PdfService (pdfmake)
prisma/
├─ schema.prisma           # data model
└─ seed.ts                 # permissions + system roles + bootstrap admin
```

## Security model

- **Authentication** is global (`JwtAuthGuard`); opt out per route with `@Public()`.
- **Authorization** uses `@Permissions('resource:action')`; the `PermissionsGuard`
  checks the user's live permission set (rebuilt from the DB each request, so role
  changes apply immediately). `*` and `<resource>:manage` act as wildcards.
- **Refresh tokens** are random, hashed (SHA-256) and stored, enabling rotation
  and revocation. Access tokens carry a `tokenVersion`; bumping it (e.g. on
  password change) invalidates all of a user's sessions.
- **Audit logging** is automatic: `AuditInterceptor` records every mutating
  request (who / what / when / where / status). Annotate routes with
  `@Audit({ action, resource })` for richer entries.

## Add a feature module (recipe)

```ts
@Controller('orders')
export class OrdersController {
  @Get()  @Permissions('order:view')   list(@Query() q: PaginationDto) { ... }
  @Post() @Permissions('order:create') @Audit({ action: 'create', resource: 'order' })
  create(@Body() dto: CreateOrderDto, @CurrentUser('id') userId: string) { ... }

  // Excel export — inject ExcelService:
  @Get('export') @Permissions('order:export')
  async export(@Res({ passthrough: true }) res: Response) {
    res; // this.excel.setDownloadHeaders(res, 'orders');
    // return new StreamableFile(this.excel.export(rows, columns));
  }
}
```

Then add a node to `MENU` in `@oms/shared` and the screen appears in the sidebar
for users with `order:view`.

## Scripts

`npm run dev` · `npm run build` · `npm run db:generate` · `npm run db:migrate` ·
`npm run db:seed` · `npm run db:studio` (run from repo root with `-w @oms/api`, or
inside `apps/api`).
