import type { ReactNode } from 'react';
import { Combobox } from '@/components/ui/combobox';

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
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onInvalidEntry?: (typed: string) => void;
  onType?: (text: string) => void;
  renderOption?: (value: string) => ReactNode;
  listHeader?: ReactNode;
}) {
  return (
    <Combobox
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
    />
  );
}
