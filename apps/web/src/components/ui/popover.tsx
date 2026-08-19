import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /**
   * Where to portal the content. Defaults to `document.body`.
   *
   * Pass the surrounding Sheet/Dialog panel when the popover opens inside one:
   * Radix's Dialog wraps its content in react-remove-scroll, which cancels wheel
   * and touch-move events whose target sits OUTSIDE that content — and a
   * body-portalled popover is outside it, so its list could not be scrolled at
   * all while a sheet was open. Positioning is unaffected (Radix positions with
   * `strategy: fixed`, so an ancestor's `overflow` cannot clip it).
   */
  container?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container'];
}) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-md border p-4 shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
