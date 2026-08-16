import { NativeSelect } from '@/components/common/combo';
import { PAGE_SIZE_OPTIONS } from '@/hooks/use-page-size';

/** "Rows per page" control dropped into every paginated table's footer, next
 *  to Prev/Next — same NativeSelect used throughout the app's toolbars. */
export function PageSizeSelect({
  value,
  onChange,
  options = PAGE_SIZE_OPTIONS,
  hideLabel = false,
}: {
  value: number;
  onChange: (n: number) => void;
  options?: readonly number[];
  /** Drop the "Rows/page" caption — for tight phone footers, where the number
   *  in the dropdown says the same thing in a fraction of the width. */
  hideLabel?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {!hideLabel && <span className="text-muted-foreground text-[12px] font-medium whitespace-nowrap">Rows/page</span>}
      <NativeSelect
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        options={options.map(String)}
        className="h-8 w-[4.25rem] text-[12px] font-semibold"
      />
    </div>
  );
}
