import { isValidElement, useCallback, useMemo, useState, type ComponentProps, type Key, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** A column for the shared {@link DataTable}. Also satisfies `OrderableColumn`. */
export interface DataColumn<T> {
  id: string;
  label: string;
  /** Optional custom header content (e.g. label + an icon); falls back to `label`. */
  header?: ReactNode;
  align?: 'right';
  /** Freeze this column to the left: 'left0' is the first frozen column, 'left1'
   *  the next (offset by the first column's 7rem min-width). */
  pin?: 'left0' | 'left1';
  /** Override the pinned column's default 7rem width (e.g. `'sm:w-16 sm:min-w-16'`)
   *  for short content like a numeric id — only meaningful with `pin: 'left0'`. */
  pinWidthClass?: string;
  /** When true the column is always shown and excluded from the arrange panel. */
  fixed?: boolean;
  /** Custom sort key. When omitted the column still sorts — the table falls back to
   *  the cell's rendered text. Set `noSort` to make a column non-sortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Opt this column out of sorting (e.g. a pure indicator/action column). */
  noSort?: boolean;
  cell: (row: T) => ReactNode;
}

/** Recursively pull the plain text out of a rendered cell so any column can sort
 *  by what the user actually sees, even without an explicit `sortValue`. */
function nodeText(node: ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

const SHADOW_L = 'shadow-[6px_0_12px_-6px_rgba(2,6,23,0.18)]';
const SHADOW_R = 'shadow-[-6px_0_12px_-6px_rgba(2,6,23,0.18)]';

// Frozen-left columns only stick from `sm:` up — on phones they scroll like any
// other column so every column is reachable.
function pinHead(pin: 'left0' | 'left1' | undefined, stickyTop: boolean, widthClass?: string): string {
  const top = stickyTop ? 'top-0 ' : '';
  if (pin === 'left0') return `${top}z-30 sm:sticky sm:left-0 ${widthClass ?? 'sm:w-28 sm:min-w-28'}`;
  if (pin === 'left1') return `${top}z-30 sm:sticky sm:left-28 sm:${SHADOW_L}`;
  return '';
}
function pinCellPos(pin?: 'left0' | 'left1', widthClass?: string): string {
  if (pin === 'left0') return `z-10 sm:sticky sm:left-0 ${widthClass ?? 'sm:w-28 sm:min-w-28'}`;
  if (pin === 'left1') return `z-10 sm:sticky sm:left-28 sm:${SHADOW_L}`;
  return '';
}

/**
 * A frozen/sticky cell. This project's Tailwind utilities are `!important`, so a
 * normal class/style can't win on a sticky cell — we set the (zebra) background
 * inline with `!important` via a ref instead.
 */
function StickyCell({ bg, className, children, ...props }: { bg: string } & ComponentProps<'td'>) {
  const ref = useCallback(
    (el: HTMLTableCellElement | null) => {
      if (el) el.style.setProperty('background-color', bg, 'important');
    },
    [bg],
  );
  return (
    <td ref={ref} className={cn('p-3 align-middle whitespace-nowrap', className)} {...props}>
      {children}
    </td>
  );
}

/**
 * The shared, polished data table: rounded card, uppercase header, light vertical
 * dividers, alternating (zebra) rows, frozen identity columns + a sticky actions
 * column. Columns are auto-fit and the whole table scrolls horizontally.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  actions,
  isLoading,
  emptyText = 'No records found.',
  // No height cap by default: the table grows to fit its rows (a page of ~50)
  // and the page itself scrolls. Pass this only where a table needs its own
  // internal scroll region (e.g. a long picklist inside a fixed-height panel).
  maxBodyHeight,
  dense,
  hideRowView,
  className,
  mobileCard,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  onRowClick?: (row: T) => void;
  /** Renders the content of the sticky actions cell; omit for no actions column. */
  actions?: (row: T) => ReactNode;
  isLoading?: boolean;
  emptyText?: string;
  /** Cap the table height (e.g. 'max-h-[40vh]') so rows scroll inside, header sticks. */
  maxBodyHeight?: string;
  /** Compact padding so columns auto-fit their content and more fit on screen. */
  dense?: boolean;
  /** Suppress the automatic "view" icon shown when rows are clickable (e.g. when
   *  the row click toggles selection rather than opening a form). */
  hideRowView?: boolean;
  /** Extra classes merged onto the table (e.g. bump the data font). twMerge lets
   *  a font-size / padding utility here override the dense/comfortable defaults. */
  className?: string;
  /** Opt in to a stacked-card layout below the `sm` breakpoint instead of a
   *  horizontally-scrolling table — renders one card per row; the table itself
   *  is hidden on phones. Omit to keep the table on every screen size (default). */
  mobileCard?: (row: T) => ReactNode;
}) {
  // When a row opens a form/detail but has no other action buttons, show an
  // explicit "view" (eye) icon so it's obvious the row is clickable.
  const showView = !!onRowClick && !actions && !hideRowView;
  const hasActionsCol = !!actions || showView;
  const span = columns.length + (hasActionsCol ? 1 : 0);
  const stickyTop = !!maxBodyHeight;

  // Client-side sorting for any column that supplies `sortValue`. Cycles a column
  // through asc → desc → unsorted.
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const toggleSort = (id: string) =>
    setSort((s) => (s?.id !== id ? { id, dir: 'asc' } : s.dir === 'asc' ? { id, dir: 'desc' } : null));
  // Every column sorts unless it opts out. Columns without an explicit `sortValue`
  // fall back to their rendered cell text, so all headers get a sort control.
  const sortValueFor = useCallback(
    (col: DataColumn<T>) => col.sortValue ?? ((row: T) => nodeText(col.cell(row))),
    [],
  );
  const sortedRows = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!sort || !col || col.noSort) return rows;
    const val = sortValueFor(col);
    const out = [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls/blanks last
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  return (
    <div
      className={cn(
        'rounded-[5px]',
        // On phones the table is replaced by a stack of individually-carded rows
        // (see below) — the table's own bordered/shadowed wrapper would just double
        // up as an outer box around them, so it's dropped below `sm`.
        mobileCard
          ? 'overflow-visible border-0 bg-transparent shadow-none sm:overflow-hidden sm:border sm:bg-card sm:shadow-sm'
          : 'overflow-hidden border bg-card shadow-sm',
      )}
    >
      <Table
        width="auto"
        containerClassName={cn(maxBodyHeight, maxBodyHeight && 'overflow-y-auto', mobileCard && 'hidden sm:block')}
        className={cn(
          '[&_td]:border-r [&_td]:border-border/60 [&_th]:border-r [&_thead_th]:border-white/25',
          // Brand blue→indigo gradient, bold, uppercase header with white text on every page.
          '[&_thead_th]:bg-gradient-to-b [&_thead_th]:from-blue-800 [&_thead_th]:to-indigo-800 [&_thead_th]:text-white [&_thead_th]:font-bold [&_thead_th]:uppercase [&_thead_th]:tracking-wider',
          '[&_tbody_td]:bg-card [&_tbody_tr:nth-child(even)_td]:bg-slate-50 [&_tbody_tr:hover_td]:bg-muted',
          dense
            ? // Compact: tight padding so columns shrink to their content and the
              // most columns possible stay on screen. Heights are auto (padding-based).
              '[&_thead_th]:py-2 [&_thead_th]:text-[13px] [&_td]:py-2 [&_tbody_button:not([role=switch]):not([role=checkbox])]:size-8 text-[14px] [&_td]:px-2.5 [&_th]:px-2.5'
            : // Comfortable: larger type, snug padding so rows auto-fit their content
              // (height grows only as much as the content needs). Action buttons are
              // size-8 so they don't force tall rows.
              '[&_thead_th]:py-2 [&_thead_th]:text-[14px] [&_td]:py-1.5 [&_tbody_button:not([role=switch]):not([role=checkbox])]:size-8 text-[16px] [&_td]:px-3 [&_th]:px-3 sm:[&_td]:px-5 sm:[&_th]:px-5',
          // Page override (twMerge lets a passed font-size/padding win over the above).
          className,
        )}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.id}
                className={cn(
                  'whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  stickyTop && !col.pin && 'sticky top-0 z-20',
                  pinHead(col.pin, stickyTop, col.pinWidthClass),
                )}
              >
                {col.noSort ? (
                  (col.header ?? col.label)
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.id)}
                    className={cn(
                      // `uppercase` here too: Tailwind preflight resets `button` to
                      // text-transform:none, so the th's uppercase doesn't inherit.
                      'group/sort inline-flex items-center gap-1 uppercase hover:text-white',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                    title="Sort"
                  >
                    {col.header ?? col.label}
                    {sort?.id === col.id ? (
                      sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-40 group-hover/sort:opacity-70" />
                    )}
                  </button>
                )}
              </TableHead>
            ))}
            {hasActionsCol && (
              <TableHead
                className={cn('sticky right-0 z-30 w-24 border-r-0 text-right', stickyTop && 'top-0', SHADOW_R)}
              >
                {actions ? 'Actions' : 'View'}
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={span} className="h-24 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={span} className="h-24 text-center text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((row, idx) => {
              const pinBg = idx % 2 === 1 ? 'oklch(0.984 0.003 247.858)' : 'oklch(1 0 0)';
              return (
                <TableRow
                  key={rowKey(row)}
                  className={cn('group', onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) =>
                    col.pin ? (
                      <StickyCell
                        key={col.id}
                        bg={pinBg}
                        className={cn(col.align === 'right' && 'text-right tabular-nums font-semibold', pinCellPos(col.pin, col.pinWidthClass))}
                      >
                        {col.cell(row)}
                      </StickyCell>
                    ) : (
                      <TableCell
                        key={col.id}
                        className={cn('whitespace-nowrap', col.align === 'right' && 'text-right tabular-nums font-semibold')}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ),
                  )}
                  {hasActionsCol && (
                    <StickyCell
                      bg={pinBg}
                      onClick={(e) => e.stopPropagation()}
                      className={cn('sticky right-0 z-10 w-24 border-r-0 text-right', SHADOW_R)}
                    >
                      {actions ? (
                        actions(row)
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRowClick?.(row)}
                          title="View / open"
                          aria-label="View"
                          className="text-muted-foreground hover:text-primary hover:bg-muted inline-flex items-center justify-center rounded-md transition-colors"
                        >
                          <Eye className="size-4" />
                        </button>
                      )}
                    </StickyCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {mobileCard && (
        <div className="sm:hidden">
          {isLoading ? (
            <div className="text-muted-foreground flex h-24 items-center justify-center rounded-lg border bg-card">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border bg-card px-4 py-10 text-center text-sm">{emptyText}</div>
          ) : (
            <div className="space-y-3">
              {sortedRows.map((row) => (
                <div
                  key={rowKey(row)}
                  className={cn(
                    'bg-card rounded-lg border p-3 shadow-sm transition-colors',
                    onRowClick && 'active:bg-muted cursor-pointer',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {mobileCard(row)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
