import { cn } from '@/lib/utils';

const NAVY = '#163e64';
const ORANGE_FROM = '#f2914a';
const ORANGE_TO = '#e3601b';

/**
 * Decorative navy-to-orange banner block: a solid navy shape with a
 * lens-pointed right edge sitting over an orange gradient. The point is a
 * pure CSS trick — a very large border-radius on both right corners of the
 * navy layer makes its top and bottom curves meet at a point mid-height
 * (same technique as the Kavish sales-order letterhead in order-bill-page.tsx).
 */
export function GradientCurveBanner({
  className,
  height = 96,
  navyWidth = '56%',
}: {
  className?: string;
  /** Banner height in px. */
  height?: number;
  /** How far across the navy shape's flat edge extends before it curves in. */
  navyWidth?: string;
}) {
  return (
    <div className={cn('relative w-full overflow-hidden rounded-lg', className)} style={{ height }}>
      <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${ORANGE_FROM} 0%, ${ORANGE_TO} 100%)` }} />
      <div
        className="absolute top-0 left-0 h-full"
        style={{
          width: navyWidth,
          background: NAVY,
          borderTopRightRadius: '100% 120%',
          borderBottomRightRadius: '100% 120%',
        }}
      />
    </div>
  );
}
