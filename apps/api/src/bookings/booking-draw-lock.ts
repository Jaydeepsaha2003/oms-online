/** Keep capacity checks and writes together across order and booking routes.
 * This coordinates one API process. Multiple instances require a database lock.
 * Do not nest calls: the caller holds the queue until its entire write finishes.
 */
let bookingDrawQueue: Promise<unknown> = Promise.resolve();
export function serializeBookingDraw<T>(needed: boolean, run: () => Promise<T>): Promise<T> {
  if (!needed) return run();
  const next = bookingDrawQueue.then(run, run);
  bookingDrawQueue = next.catch(() => undefined);
  return next;
}
