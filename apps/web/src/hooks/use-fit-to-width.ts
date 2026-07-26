import { useLayoutEffect, useRef, useState } from 'react';

/**
 * "Fit to width" preview scaling for phones. A fixed-width, large-font A4 document
 * (sales order / quotation / challan) badly overflows a phone screen. When
 * `enabled` (mobile only) the caller renders it at its full design width inside
 * `innerRef` and this scales the whole thing down to fit `outerRef`'s width — a
 * faithful shrunk-to-fit page, like a PDF viewer. Desktop is left untouched
 * (scale 1, no wrapper styling). The print/PDF path is unaffected: it re-clones
 * the document at its own width, independent of this on-screen transform.
 *
 * Usage:
 *   const fit = useFitToWidth(DESIGN_W, isMobile);
 *   <div ref={fit.outerRef} style={isMobile ? { height: fit.height } : undefined}>
 *     <div ref={fit.innerRef} style={isMobile ? { width: DESIGN_W, transformOrigin: 'top left', transform: `scale(${fit.scale})` } : undefined}>
 *       <div id="…">…the A4 document…</div>
 *     </div>
 *   </div>
 */
export function useFitToWidth(designWidth: number, enabled: boolean) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!enabled) {
      setScale(1);
      setHeight(undefined);
      return;
    }
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const s = Math.min(1, outer.clientWidth / designWidth);
      setScale(s);
      // offsetHeight is the UNSCALED height (CSS transforms don't affect it), so
      // the wrapper must reserve height*scale or a large empty gap appears below.
      setHeight(inner.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth, enabled]);

  return { outerRef, innerRef, scale, height };
}
