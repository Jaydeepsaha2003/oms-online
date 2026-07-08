/**
 * Branded full-screen loader — shown while the session is restored and for any
 * in-app "loading" gate. Matches the instant welcome splash in index.html so the
 * hand-off from splash → app is seamless. Theme-aware (uses CSS vars).
 */
const LOADER_CSS = `
.fsl-logo { animation: fsl-float 3.2s ease-in-out infinite; }
.fsl-ring {
  background: conic-gradient(from 0deg, transparent 0deg, var(--brand-blue) 90deg, var(--brand-orange) 220deg, var(--brand-amber) 300deg, transparent 360deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  animation: fsl-spin 1.15s linear infinite;
}
.fsl-tile svg { animation: fsl-pop 0.6s cubic-bezier(0.16,1,0.3,1) both; }
.fsl-bar > span { animation: fsl-slide 1.25s cubic-bezier(0.65,0,0.35,1) infinite; }
@keyframes fsl-spin { to { transform: rotate(360deg); } }
@keyframes fsl-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes fsl-pop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: none; } }
@keyframes fsl-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
@media (prefers-reduced-motion: reduce) { .fsl-logo, .fsl-tile svg, .fsl-bar > span { animation: none !important; } }
`;

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-5">
      <style>{LOADER_CSS}</style>
      <div className="animate-in fade-in zoom-in-95 flex flex-col items-center gap-5 duration-500">
        <div className="fsl-logo relative grid size-24 place-items-center">
          <span className="fsl-ring absolute inset-0 rounded-full" />
          <span className="bg-gradient-brand grid size-[68%] place-items-center rounded-[26%] text-white shadow-xl shadow-blue-600/30 ring-1 ring-white/25">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="size-[52%]" aria-hidden="true">
              <path d="M16.5 9.4 7.5 4.21" />
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <path d="M3.27 6.96 12 12.01l8.73-5.05" />
              <path d="M12 22.08V12" />
            </svg>
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-gradient-brand text-2xl font-extrabold tracking-[0.14em]">OMS</span>
          <span className="text-muted-foreground text-sm font-medium">{label}</span>
        </div>
        <div className="fsl-bar bg-muted h-1 w-44 overflow-hidden rounded-full">
          <span className="block h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-orange-500" />
        </div>
      </div>
    </div>
  );
}
