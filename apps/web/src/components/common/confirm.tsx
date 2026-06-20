import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (for deletes). */
  destructive?: boolean;
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) { ... }` */
export const useConfirm = () => React.useContext(ConfirmContext);

/** Provides one centered confirmation dialog for the whole app. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions>({});
  const resolver = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts = {}) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : settle(false))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{options.title ?? 'Are you sure?'}</DialogTitle>
            {options.description ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {options.cancelText ?? 'Cancel'}
            </Button>
            <Button
              variant={options.destructive ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {options.confirmText ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
