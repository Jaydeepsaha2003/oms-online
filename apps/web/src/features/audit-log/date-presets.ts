/** Date-range quick presets on an Indian fiscal year (Apr–Mar). */
export const PRESETS = ['Today', 'Yesterday', 'This Month', 'Last Month', 'This Quarter', 'Last Quarter', 'This Year', 'Last Year'] as const;

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fyStart = (d: Date) => new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1); // Apr = month index 3

export function presetRange(sel: string): { from: string; to: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fy = fyStart(today);
  switch (sel) {
    case 'Today':
      return { from: ymd(today), to: ymd(today) };
    case 'Yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: ymd(y), to: ymd(y) };
    }
    case 'This Month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
    case 'Last Month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastMonthFirst = new Date(first);
      lastMonthFirst.setMonth(first.getMonth() - 1);
      const lastMonthEnd = new Date(first);
      lastMonthEnd.setDate(0);
      return { from: ymd(lastMonthFirst), to: ymd(lastMonthEnd) };
    }
    case 'This Quarter': {
      const q = Math.floor(((today.getFullYear() - fy.getFullYear()) * 12 + today.getMonth() - fy.getMonth()) / 3);
      const qs = new Date(fy);
      qs.setMonth(fy.getMonth() + q * 3);
      return { from: ymd(qs), to: ymd(today) };
    }
    case 'Last Quarter': {
      const q = Math.floor(((today.getFullYear() - fy.getFullYear()) * 12 + today.getMonth() - fy.getMonth()) / 3);
      const curQs = new Date(fy);
      curQs.setMonth(fy.getMonth() + q * 3);
      const lastQs = new Date(curQs);
      lastQs.setMonth(curQs.getMonth() - 3);
      const lastQe = new Date(curQs);
      lastQe.setDate(0);
      return { from: ymd(lastQs), to: ymd(lastQe) };
    }
    case 'This Year':
      return { from: ymd(fy), to: ymd(today) };
    case 'Last Year': {
      const prevFy = new Date(fy);
      prevFy.setFullYear(fy.getFullYear() - 1);
      const prevFyEnd = new Date(fy);
      prevFyEnd.setDate(fy.getDate() - 1);
      return { from: ymd(prevFy), to: ymd(prevFyEnd) };
    }
    default:
      return null;
  }
}
