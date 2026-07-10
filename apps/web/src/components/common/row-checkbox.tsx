import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A clearly-visible, custom-styled checkbox for use inside table rows — a
 * bordered box + check icon, matching this app's existing hand-rolled checkbox
 * look (see the Designs page row-selection indicator). Deliberately NOT a bare
 * native `<input type="checkbox">`: those render tiny/low-contrast on some
 * mobile browsers, which is why the rate-list checkbox was reported invisible.
 */
export function RowCheckbox({
  checked,
  onChange,
  disabled,
  loading,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:border-primary/60',
      )}
    >
      {loading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        checked && <Check className="size-3.5" strokeWidth={3} />
      )}
    </button>
  );
}
