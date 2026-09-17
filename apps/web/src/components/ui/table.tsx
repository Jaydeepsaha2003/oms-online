import * as React from 'react';
import { cn } from '@/lib/utils';

function Table({
  className,
  containerClassName,
  containerRef,
  width = 'full',
  ...props
}: React.ComponentProps<'table'> & {
  containerClassName?: string;
  /** Ref to the scroll container (for e.g. syncing an external top scrollbar). */
  containerRef?: React.Ref<HTMLDivElement>;
  width?: 'full' | 'auto';
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      {/* width='auto' autofits columns to their content AND stretches to fill the
          screen when narrower (min-w-full = no blank area), while still scrolling
          horizontally when the columns are wider than the viewport. */}
      <table data-slot="table" className={cn(width === 'auto' ? 'w-auto min-w-full' : 'w-full', 'caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        /*
         * No `[&:has([role=checkbox])]:pr-0` here.
         *
         * That is a shadcn default meant for its own borderless demo table,
         * where a select column should hug its checkbox. Every table in this app
         * draws a divider between cells and keeps a 12px rhythm, so stripping the
         * right padding left the checkbox pressed flat against the next column's
         * border — the select cell measured 33px wide holding a 20px checkbox at
         * a 12px inset, with 1px to spare. A checkbox cell now pads like any
         * other cell.
         */
        'text-muted-foreground h-10 px-3 text-left align-middle font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-3 align-middle whitespace-nowrap', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
