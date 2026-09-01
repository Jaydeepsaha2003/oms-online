import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { scrollFocusedFieldIntoView, useVisualViewportInsets } from '@/hooks/use-visual-viewport';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

/** A slide-over panel. Defaults to the right edge; `bottom` gives a mobile-style
 *  bottom sheet (slides up, capped height, rounded top corners) instead. */
function SheetContent({
  className,
  children,
  side = 'right',
  style,
  onFocusCapture,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'right' | 'left' | 'bottom' }) {
  // Anchor to the actually-visible viewport (excludes the on-screen keyboard on
  // mobile) instead of the full layout viewport — a `bottom-0`/`inset-y-0` sheet
  // otherwise stays pinned to the bottom of the *full* screen, ending up hidden
  // behind the keyboard once it opens. Set via inline `style`, not a class: this
  // project's Tailwind utilities are `!important` and would win over it.
  const { height, offsetTop } = useVisualViewportInsets();
  const keyboardGap = Math.max(window.innerHeight - (offsetTop + height), 0);
  const positionStyle: React.CSSProperties =
    side === 'bottom'
      ? { bottom: keyboardGap, maxHeight: Math.min(height * 0.85, height) }
      : { top: offsetTop, height };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background fixed z-50 flex flex-col gap-4 p-5 shadow-xl outline-none overflow-y-auto',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-300',
          side === 'right' &&
            'right-0 w-full max-w-md border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          side === 'left' &&
            'left-0 w-full max-w-md border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          side === 'bottom' &&
            'inset-x-0 w-full rounded-t-xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          className,
        )}
        style={{ ...positionStyle, ...style }}
        onFocusCapture={(e) => {
          scrollFocusedFieldIntoView(e);
          onFocusCapture?.(e);
        }}
        {...props}
      >
        {/*
          Sticky, and ahead of the content — not absolute, and not after it.

          These panels are their own scroll container, and an absolutely
          positioned child scrolls away with the content it is positioned
          against. On a desktop most dialogs fit, so the X stayed on screen and
          the bug never showed. On a phone almost everything scrolls, so the
          close disappeared the moment you moved a finger — "there is no close
          button in the PWA".

          A zero-height sticky row keeps it in the corner while costing no
          layout (the negative margin cancels the flex/grid gap it would
          otherwise introduce), and the top offset clears the notch: a
          full-screen dialog reaches into the safe area, where a plain `top-4`
          put the X underneath the status bar.

          Sized for a fingertip rather than a cursor, with a backing so it is
          visible over whatever it floats above.
        */}
        <div
          className="pointer-events-none sticky z-20 -mb-4 flex h-0 justify-end"
          style={{ top: 'max(0.25rem, env(safe-area-inset-top, 0px))' }}
        >
          <DialogPrimitive.Close
            className="bg-background/85 ring-border/70 focus-visible:ring-ring pointer-events-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-90 shadow-sm ring-1 backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Close"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mt-auto flex justify-end gap-2 border-t pt-4', className)} {...props} />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
};
