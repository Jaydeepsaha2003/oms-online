import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { scrollFocusedFieldIntoView, useVisualViewportInsets } from '@/hooks/use-visual-viewport';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  style,
  onFocusCapture,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  // Recenter within the actually-visible viewport (excludes the on-screen
  // keyboard on mobile) instead of the full layout viewport, and cap the
  // height so a tall form scrolls internally rather than spilling off-screen
  // or behind the keyboard. `top` is set here (not as a `top-[50%]` class) —
  // this project's Tailwind utilities are `!important`, so a class would win
  // over this inline style instead of the other way around.
  const { height, offsetTop } = useVisualViewportInsets();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-background fixed left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-xl border p-6 shadow-lg',
          className,
        )}
        style={{ top: offsetTop + height / 2, maxHeight: Math.max(height - 32, 200), ...style }}
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

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
