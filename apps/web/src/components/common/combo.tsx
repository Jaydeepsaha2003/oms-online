import type { ReactNode } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/** Creatable searchable dropdown — type to filter or add a new value. */
export function Combo({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      creatable
    />
  );
}

/** Fixed-list searchable dropdown (pick from options only). */
export function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  onInvalidEntry,
  onType,
  renderOption,
  listHeader,
  digitsFirst,
}: {
  /** Passed to the underlying field so a `<Label htmlFor>` can point at it. */
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | ComboboxOption)[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onInvalidEntry?: (typed: string) => void;
  onType?: (text: string) => void;
  renderOption?: (value: string) => ReactNode;
  listHeader?: ReactNode;
  /** Digits-first keyboard, extent decided by the options — see {@link Combobox}. */
  digitsFirst?: boolean;
}) {
  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onInvalidEntry={onInvalidEntry}
      onType={onType}
      renderOption={renderOption}
      listHeader={listHeader}
      digitsFirst={digitsFirst}
    />
  );
}
