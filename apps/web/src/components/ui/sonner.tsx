import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** App-wide toast host. Mounted once near the app root; call `toast()` anywhere. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      richColors
      closeButton
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
