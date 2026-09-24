import * as React from 'react';
import type { AdvanceOffer } from '@oms/shared';
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
  /** Focus the confirm button on open, so Enter proceeds (default focuses Cancel). */
  autoFocusConfirm?: boolean;
  /**
   * A roomier dialog, for a confirmation that has to show a TABLE rather than a
   * sentence. The default `md` is right for prose and squeezes a grid into a
   * horizontal scrollbar.
   */
  wide?: boolean;
  /** A second answer beside Confirm, for `useChoose` — a choice between two
   *  ways forward where closing the dialog must mean neither. */
  altText?: string;
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;
type Choice = 'confirm' | 'alt' | null;
type ChooseFn = (options?: ConfirmOptions) => Promise<Choice>;

const ConfirmContext = React.createContext<{ confirm: ConfirmFn; choose: ChooseFn }>({
  confirm: async () => false,
  choose: async () => null,
});

/** `const confirm = useConfirm(); if (await confirm({...})) { ... }` */
export const useConfirm = () => React.useContext(ConfirmContext).confirm;

/** Two answers and a way out: resolves 'confirm', 'alt' (the `altText` button),
 *  or null when cancelled or dismissed. */
export const useChoose = () => React.useContext(ConfirmContext).choose;

/**
 * "Use the party's advance for this bill?" — the server's ADVANCE_CHOICE offer
 * put to the operator. True to use it, false to keep it, null to go back to the
 * form without saving (closing the dialog must not count as "keep").
 */
export async function askUseAdvance(choose: ChooseFn, offer: AdvanceOffer, party: string, noun: string): Promise<boolean | null> {
  const inr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const sides = [offer.bank > 0 && `bank ${inr(offer.bank)}`, offer.cash > 0 && `cash ${inr(offer.cash)}`].filter(Boolean).join(' · ');
  const answer = await choose({
    title: `Use ${party}'s advance for this ${noun}?`,
    description:
      `${party} has ${inr(offer.bank + offer.cash)} on account (${sides}). Using it now clears ${inr(offer.use)} of this ${noun}. ` +
      `Keep it if that money is meant for something else — the ${noun} then stays due, and no later receipt will spend the advance on it.`,
    confirmText: 'Use advance',
    altText: 'Keep advance',
    cancelText: 'Back',
    autoFocusConfirm: true,
  });
  return answer === null ? null : answer === 'confirm';
}

/** Provides one centered confirmation dialog for the whole app. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions>({});
  const resolver = React.useRef<((value: Choice) => void) | null>(null);

  const choose = React.useCallback<ChooseFn>((opts = {}) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<Choice>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const confirm = React.useCallback<ConfirmFn>(async (opts) => (await choose(opts)) === 'confirm', [choose]);
  const value = React.useMemo(() => ({ confirm, choose }), [confirm, choose]);

  const settle = React.useCallback((value: Choice) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const confirmBtnRef = React.useRef<HTMLButtonElement>(null);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : settle(null))}>
        <DialogContent
          className={options.wide ? "sm:max-w-3xl" : "sm:max-w-md"}
          // Opt-in: land focus on the confirm button so Enter proceeds.
          onOpenAutoFocus={
            options.autoFocusConfirm
              ? (e) => {
                  e.preventDefault();
                  confirmBtnRef.current?.focus();
                }
              : undefined
          }
        >
          <DialogHeader>
            <DialogTitle>{options.title ?? 'Are you sure?'}</DialogTitle>
            {options.description ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(null)}>
              {options.cancelText ?? 'Cancel'}
            </Button>
            {options.altText && (
              <Button variant="secondary" onClick={() => settle('alt')}>
                {options.altText}
              </Button>
            )}
            <Button
              ref={confirmBtnRef}
              variant={options.destructive ? 'destructive' : 'default'}
              onClick={() => settle('confirm')}
            >
              {options.confirmText ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
