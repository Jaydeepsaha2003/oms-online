# Porting a form (page-by-page intake)

We rebuild your existing .NET screens one page at a time. For each page, the less
you have to write the better — **a screenshot + the table structure is usually
enough**, and I'll infer the rest (CRUD, validation from column types, a list
with search/sort/pagination, Excel import/export, PDF for documents, audit
logging, and role-based access). Then I show you the result and we refine.

## The fastest way to send a form

Drop the materials in `docs/forms/<form-name>/` (e.g. `docs/forms/customers/`):

1. **Screenshots** — the list/grid view, and the add/edit form. (Paste images
   into chat too; that works.)
2. **Table structure** — the source is **MS Access**, so the cleanest is a
   **Design View screenshot** of the table (Field Name + Data Type, and Field
   Size / Required in the Field Properties pane). A typed column list works too.
   Include:
   - field name, data type (+ field size), required?, primary key
   - relationships / lookups — which table + field fills each dropdown
     (the Access **Relationships** window screenshot is perfect for this)
3. (Optional) **anything not obvious from the screenshot** — see the short
   template below. Skip anything that's standard.

## Optional per-form notes (only the non-obvious bits)

```
Form: <name / module, e.g. "Customers" under Sales>

List page:    columns to show · default sort · searchable fields · filters
Actions:      [x] create [x] edit [x] delete [ ] approve [ ] print/PDF [x] export [x] import
Validation:   required fields, formats, uniqueness, computed/derived fields
Workflow:     status values + allowed transitions (if any)
Permissions:  who can view / create / edit / delete / export  (by role)
Special:      anything unusual — auto-numbers, calculations, linked records, etc.
```

> Rule of thumb: **don't document what's standard.** If a field is a non-null
> `varchar(100)`, I'll make it a required text input automatically. Tell me only
> the surprises.

## What I deliver per form (full vertical slice)

For each page you send, I build end-to-end and verify on mobile + desktop:

- **Data**: the table(s) in the schema (Prisma model + migration)
- **API**: a NestJS module — list/get/create/update/delete, guarded by
  `@Permissions(...)`, audited, with Excel export/import + PDF where relevant
- **Permissions**: new `resource:action` keys added to the catalog (so roles can grant them)
- **UI**: a React feature page (list + form) using the shared components, with
  Excel up/download and access-aware buttons
- **Menu**: a node in the shared `MENU` so it appears in the sidebar for the right roles

Then you review, we adjust, and move to the next page.

## MS Access → this app

We **rebuild the schema fresh** here (we don't connect to the Access file).
Your Access tables are the blueprint; I map their types like this:

| MS Access type            | This app (Prisma)        | Notes                                  |
| ------------------------- | ------------------------ | -------------------------------------- |
| AutoNumber                | `String @id @default(cuid())` (or `Int @id @default(autoincrement())`) | we standardize on ids |
| Short Text (n)            | `String`                 | length enforced by validation          |
| Long Text / Memo          | `String`                 | rendered as a textarea                  |
| Number — Long Integer     | `Int`                    |                                        |
| Number — Double/Single    | `Float`                  |                                        |
| Currency                  | `Decimal`                | money-safe                              |
| Date/Time                 | `DateTime`               |                                        |
| Yes/No                    | `Boolean`                | checkbox/switch                         |
| Lookup field              | relation + FK            | dropdown sourced from the lookup table  |

**Bringing your data over (later):** export each Access table to Excel/CSV
(External Data → Export) and import it through the screen's built-in Excel
import — the same import we build into every form. No separate migration tool needed.

