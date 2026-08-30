import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * "Fit to width" preview scaling for phones. A fixed-width, large-font A4 document
 * (sales order / quotation / challan) badly overflows a phone screen. When
 * `enabled` (mobile only) the caller renders it at its full design width inside
 * `innerRef` and this scales the whole thing down to fit `outerRef`'s width — a
 * faithful shrunk-to-fit page, like a PDF viewer. Desktop is left untouched
 * (scale 1, no wrapper styling). The print/PDF path is unaffected: it re-clones
 * the document at its own width, independent of this on-screen transform.
 *
 * The refs are CALLBACK refs, and that is load-bearing. Every caller renders a
 * spinner until its data arrives, so on a cold open the document — and both
 * elements this needs to measure — does not exist yet. With plain object refs
 * the layout effect ran once against nulls, bailed out, attached no observer,
 * and never ran again, because neither `designWidth` nor `enabled` had changed
 * by the time the document finally mounted. Scale stayed 1 and the A4 document
 * hung off the side of the screen. Reopening looked fine only because the query
 * was cached by then and the document existed on the first render.
 *
 * Callback refs make the nodes state, so mounting them re-runs the effect and
 * the measure happens whenever the document actually appears.
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
  const [outer, setOuter] = useState<HTMLDivElement | null>(null);
  const [inner, setInner] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const outerRef = useCallback((node: HTMLDivElement | null) => setOuter(node), []);
  const innerRef = useCallback((node: HTMLDivElement | null) => setInner(node), []);

  useLayoutEffect(() => {
    if (!enabled) {
      setScale(1);
      setHeight(undefined);
      return;
    }
    if (!outer || !inner) return;
    const measure = () => {
      const s = Math.min(1, outer.clientWidth / designWidth);
      setScale(s);
      // offsetHeight is the UNSCALED height (CSS transforms don't affect it), so
      // the wrapper must reserve height*scale or a large empty gap appears below.
      setHeight(inner.offsetHeight * s);
    };
    measure();
    // Observing `inner` also covers the logo and web fonts landing after the
    // first measure, which change the document's height.
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth, enabled, outer, inner]);

  return { outerRef, innerRef, scale, height };
}
