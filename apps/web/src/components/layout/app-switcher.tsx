import { cn } from '@/lib/utils';

/** Which app this page is: the same build serves OMS at /oms/ and WMS at /wms/. */
export const isWms = () => /^\/wms(\/|$)/.test(window.location.pathname);

/** OMS | WMS toggle for the right corner of either app's header. Plain links:
 *  each app has its own router basename, so switching is a page load. */
export function AppSwitcher() {
  const wms = isWms();
  return (
    <div role="group" aria-label="Switch app" className="bg-muted flex shrink-0 rounded-lg p-0.5 text-xs font-bold">
      {[
        { label: 'OMS', href: '/oms/', on: !wms, title: 'Order Management' },
        { label: 'WMS', href: '/wms/', on: wms, title: 'Warehouse Management' },
      ].map((a) => (
        <a
          key={a.label}
          href={a.href}
          title={a.title}
          aria-current={a.on ? 'page' : undefined}
          className={cn(
            'rounded-md px-2.5 py-1.5 transition-colors',
            a.on ? 'bg-gradient-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {a.label}
        </a>
      ))}
    </div>
  );
}
