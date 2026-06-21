import { useCallback, type ComponentProps, type Key, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
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
  align?: 'right';
  /** Freeze this column to the left: 'left0' is the first frozen column, 'left1'
   *  the next (offset by the first column's 7rem min-width). */
  pin?: 'left0' | 'left1';
  /** When true the column is always shown and excluded from the arrange panel. */
  fixed?: boolean;
  cell: (row: T) => ReactNode;
}

const SHADOW_L = 'shadow-[6px_0_12px_-6px_rgba(2,6,23,0.18)]';
const SHADOW_R = 'shadow-[-6px_0_12px_-6px_rgba(2,6,23,0.18)]';

function pinHead(pin: 'left0' | 'left1' | undefined, stickyTop: boolean): string {
  const top = stickyTop ? 'top-0 ' : '';
  if (pin === 'left0') return `${top}sticky left-0 z-30 w-28 min-w-28`;
  if (pin === 'left1') return `${top}sticky left-28 z-30 ${SHADOW_L}`;
  return '';
}
function pinCellPos(pin?: 'left0' | 'left1'): string {
  if (pin === 'left0') return 'sticky left-0 z-10 w-28 min-w-28';
  if (pin === 'left1') return `sticky left-28 z-10 ${SHADOW_L}`;
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
  maxBodyHeight,
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
}) {
  const span = columns.length + (actions ? 1 : 0);
  const stickyTop = !!maxBodyHeight;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <Table
        containerClassName={cn(maxBodyHeight, maxBodyHeight && 'overflow-y-auto')}
        className={cn(
          '[&_td]:border-r [&_td]:border-border/30 [&_th]:border-r [&_th]:border-border/30',
          '[&_thead_th]:bg-muted [&_thead_th]:h-9 [&_thead_th]:text-[10px] [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-wider',
          // Compact rows everywhere: halve the vertical cell padding and shrink the
          // (icon-only) action buttons so no row is taller than it needs to be.
          '[&_td]:py-1.5 [&_tbody_button]:size-7',
          '[&_tbody_td]:bg-card [&_tbody_tr:nth-child(even)_td]:bg-slate-50 [&_tbody_tr:hover_td]:bg-muted',
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
                  pinHead(col.pin, stickyTop),
                )}
              >
                {col.label}
              </TableHead>
            ))}
            {actions && (
              <TableHead
                className={cn('sticky right-0 z-30 w-24 border-r-0 text-right', stickyTop && 'top-0', SHADOW_R)}
              >
                Actions
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
            rows.map((row, idx) => {
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
                        className={cn(col.align === 'right' && 'text-right tabular-nums', pinCellPos(col.pin))}
                      >
                        {col.cell(row)}
                      </StickyCell>
                    ) : (
                      <TableCell
                        key={col.id}
                        className={cn('whitespace-nowrap', col.align === 'right' && 'text-right tabular-nums')}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ),
                  )}
                  {actions && (
                    <StickyCell
                      bg={pinBg}
                      onClick={(e) => e.stopPropagation()}
                      className={cn('sticky right-0 z-10 w-24 border-r-0 text-right', SHADOW_R)}
                    >
                      {actions(row)}
                    </StickyCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
