import { Check, Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Numeric PIN entry: animated dots + a glossy keypad. Large touch targets for mobile. */
export function PinPad({
  value,
  onChange,
  onSubmit,
  minLength = 4,
  maxLength = 6,
  disabled = false,
}: PinPadProps) {
  const press = (digit: string) => {
    if (disabled || value.length >= maxLength) return;
    onChange(value + digit);
  };
  const backspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  const keyClass =
    'flex h-14 items-center justify-center rounded-xl border border-white/60 bg-white/60 text-xl font-medium text-foreground shadow-sm backdrop-blur transition-all duration-150 hover:bg-white active:scale-95 disabled:opacity-40 disabled:active:scale-100';

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-3" aria-label={`PIN, ${value.length} digits entered`}>
        {Array.from({ length: maxLength }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'size-3 rounded-full border transition-all duration-200',
              i < value.length
                ? 'scale-110 border-primary bg-primary'
                : 'border-muted-foreground/30 bg-transparent',
            )}
          />
        ))}
      </div>

      <div className="grid w-full max-w-[19rem] grid-cols-3 gap-2.5">
        {KEYS.map((k) => (
          <button key={k} type="button" className={keyClass} onClick={() => press(k)} disabled={disabled}>
            {k}
          </button>
        ))}
        <button
          type="button"
          className={keyClass}
          onClick={backspace}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
        >
          <Delete className="size-5" />
        </button>
        <button key="0" type="button" className={keyClass} onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button
          type="button"
          className={cn(
            keyClass,
            'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
          onClick={onSubmit}
          disabled={disabled || value.length < minLength}
          aria-label="Submit PIN"
        >
          <Check className="size-5" />
        </button>
      </div>
    </div>
  );
}
