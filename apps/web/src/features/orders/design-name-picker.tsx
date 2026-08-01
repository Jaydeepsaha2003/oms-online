import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { OrderLookups } from '@oms/shared';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/common/combo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface DesignNameChoice {
  designType: string;
  designName: string;
}

const norm = (value: string | null | undefined) => (value ?? '').trim().toUpperCase();

/** Resolve names from every component of a combination, in component order. */
export function resolveDesignNameChoices(
  lookups: OrderLookups | undefined,
  designType: string,
  category: string,
  subCategory: string,
): { choices: DesignNameChoice[]; multiple: boolean } {
  const code = norm(designType);
  if (!code) return { choices: [], multiple: false };

  const selected =
    lookups?.designs.find(
      (design) =>
        norm(design.designType) === code &&
        norm(design.category) === norm(category) &&
        norm(design.subCategory) === norm(subCategory),
    ) ?? lookups?.designs.find((design) => norm(design.designType) === code);
  let componentTypes = selected?.componentDesignTypes?.length
    ? selected.componentDesignTypes
    : [designType];
  // Older catalogues sometimes stored a combination directly as "DL+FULL LASER"
  // instead of linking it through the Combination master. When that composite
  // code has no names of its own, resolve its standalone component masters too.
  const hasDirectNames = (lookups?.designNames ?? []).some((name) => norm(name.designType) === code);
  if (componentTypes.length === 1 && !hasDirectNames && designType.includes('+')) {
    const parsed = designType.split('+').map((part) => part.trim()).filter(Boolean);
    if (parsed.length > 1 && parsed.every((part) => (lookups?.designNames ?? []).some((name) => norm(name.designType) === norm(part)))) {
      componentTypes = parsed;
    }
  }
  const seen = new Set<string>();
  const choices: DesignNameChoice[] = [];

  for (const componentType of componentTypes) {
    for (const designName of lookups?.designNames ?? []) {
      const key = norm(designName.designName);
      if (norm(designName.designType) !== norm(componentType) || seen.has(key)) continue;
      seen.add(key);
      choices.push({ designType: componentType, designName: designName.designName });
    }
  }

  return { choices, multiple: componentTypes.length > 1 };
}

/** Single-select for a base design; grouped multi-select for a combination. */
export function DesignNamePicker({
  value,
  onChange,
  choices,
  multiple,
  disabled,
  className,
  onInvalidEntry,
}: {
  value: string;
  onChange: (value: string) => void;
  choices: DesignNameChoice[];
  multiple: boolean;
  disabled?: boolean;
  className?: string;
  onInvalidEntry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const names = useMemo(() => choices.map((choice) => choice.designName), [choices]);

  if (!multiple) {
    return (
      <NativeSelect
        value={disabled ? 'NA' : value}
        onChange={onChange}
        options={disabled ? ['NA'] : names}
        placeholder="Design name"
        disabled={disabled}
        className={className}
        onInvalidEntry={() => onInvalidEntry?.()}
      />
    );
  }

  const selected = value
    .split('+')
    .map((name) => name.trim())
    .filter(Boolean);
  const selectedSet = new Set(selected.map(norm));
  const filtered = choices.filter((choice) => {
    const q = norm(search);
    return !q || `${choice.designType} ${choice.designName}`.toUpperCase().includes(q);
  });
  const choiceByName = new Map(choices.map((choice) => [norm(choice.designName), choice]));

  const toggle = (choice: DesignNameChoice) => {
    const key = norm(choice.designName);
    let next: string[];
    if (selectedSet.has(key)) {
      next = selected.filter((name) => norm(name) !== key);
    } else {
      // One selected name per component design type. A combination can therefore
      // become exactly "AK RING+CHINA", without two DL names being picked by mistake.
      next = selected.filter((name) => norm(choiceByName.get(norm(name))?.designType) !== norm(choice.designType));
      next.push(choice.designName);
    }
    const order = new Map(choices.map((item, index) => [norm(item.designName), index]));
    next.sort((a, b) => (order.get(norm(a)) ?? 0) - (order.get(norm(b)) ?? 0));
    onChange(next.join('+'));
  };

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Design Name"
          disabled={disabled}
          className={cn('h-9 w-full justify-between rounded-sm px-3 font-normal', !value && 'text-muted-foreground', className)}
        >
          <span className="truncate">{value || 'Select design names'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1.5">
        <div className="relative mb-1.5">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search design names..."
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {filtered.length ? (
            filtered.map((choice) => {
              const checked = selectedSet.has(norm(choice.designName));
              return (
                <button
                  key={`${choice.designType}:${choice.designName}`}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(choice)}
                  className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                >
                  <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-[3px] border', checked && 'border-primary bg-primary text-primary-foreground')}>
                    {checked && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{choice.designName}</span>
                  <span className="text-muted-foreground shrink-0 text-[10px] font-semibold uppercase">{choice.designType}</span>
                </button>
              );
            })
          ) : (
            <p className="text-muted-foreground px-2 py-5 text-center text-sm">No design names found.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
