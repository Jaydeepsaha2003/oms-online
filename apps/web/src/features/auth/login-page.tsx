import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { isInstalledApp } from '@/lib/app-session';
import { isTouchPrimary } from '@/lib/device';
import { useLogin, usePinLogin } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { reapplyTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PinPad } from '@/components/auth/pin-pad';
import { IntroVideo } from '@/features/auth/intro-video';
import { useCompany } from '@/features/settings/use-settings';
import { UntrustedCertBanner } from '@/components/common/untrusted-cert-banner';
import kavishLogo from '@/assets/kavish-logo-order.png';

type Mode = 'password' | 'pin';
const LAST_EMAIL_KEY = 'oms:last-email';
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'OMS';
const emailValid = (v: string) => /.+@.+\..+/.test(v.trim());
/** Cycles under the welcome line. */
const TAGLINE = ['orders', 'dispatch', 'payments', 'accounts'];

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  // Always light here, whatever the saved theme (see lib/theme.ts). Re-applied on
  // leave so signing in restores the user's dark mode.
  useEffect(() => {
    reapplyTheme();
    return reapplyTheme;
  }, []);

  const login = useLogin();
  const pinLogin = usePinLogin();
  const pending = login.isPending || pinLogin.isPending;

  // On the installed app the login screen is now reached on every launch, so it
  // opens on the PIN pad for the remembered account — a four-digit re-entry
  // rather than a full password, with the password form one tap away. A browser
  // tab is reached far less often and keeps opening on the password form.
  const [mode, setMode] = useState<Mode>(() =>
    isInstalledApp() && localStorage.getItem(LAST_EMAIL_KEY) ? 'pin' : 'password',
  );
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  // Desktop only. On a phone the login screen is now reached on every launch of
  // the app, and a 2.3 MB video in front of it each time is a toll on the one
  // path the user cannot avoid — worse over the VPN, where it is also the part
  // most likely to stall. Desktop sees the login screen rarely, so it keeps the
  // intro.
  const [showIntro, setShowIntro] = useState(() => !isTouchPrimary());
  const { data: company } = useCompany();

  // The account PIN sign-in applies to — the last account used on this device.
  // PIN mode never shows an email field; it signs in as this remembered account.
  const [rememberedEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? '');

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  const finish = useCallback(
    (usedEmail: string) => {
      localStorage.setItem(LAST_EMAIL_KEY, usedEmail.trim());
      navigate(from, { replace: true });
    },
    [from, navigate],
  );

  const submitPassword = useCallback(() => {
    if (!emailValid(email)) return toast.error('Enter a valid email');
    if (!password) return toast.error('Enter your password');
    login.mutate(
      { email: email.trim(), password },
      { onSuccess: () => finish(email), onError: (e) => toast.error(getApiErrorMessage(e, 'Sign in failed')) },
    );
  }, [email, password, login, finish]);

  const submitPin = useCallback(() => {
    if (!rememberedEmail) {
      setMode('password');
      return;
    }
    if (pin.length !== 4) return toast.error('Enter your 4-digit PIN');
    pinLogin.mutate(
      { email: rememberedEmail, pin },
      {
        onSuccess: () => finish(rememberedEmail),
        onError: (e) => {
          setPin('');
          toast.error(getApiErrorMessage(e, 'Sign in failed'));
        },
      },
    );
  }, [rememberedEmail, pin, pinLogin, finish]);

  // Physical keyboard support for the PIN pad.
  useEffect(() => {
    if (mode !== 'pin' || !rememberedEmail) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key >= '0' && e.key <= '9') setPin((p) => (p.length < 4 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submitPin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, rememberedEmail, submitPin]);

  // Rotating tagline word.
  const [word, setWord] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setWord((w) => (w + 1) % TAGLINE.length), 2200);
    return () => window.clearInterval(id);
  }, []);

  // Cursor spotlight + card tilt. Mouse/trackpad only (a touch "hover" would
  // just jolt the card), skipped under reduced motion, one write per frame.
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = stageRef.current;
      if (!el) return;
      const x = clientX / window.innerWidth - 0.5;
      const y = clientY / window.innerHeight - 0.5;
      el.style.setProperty('--mx', `${clientX}px`);
      el.style.setProperty('--my', `${clientY}px`);
      el.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
    });
  };
  const onPointerLeave = () => {
    stageRef.current?.style.setProperty('--rx', '0deg');
    stageRef.current?.style.setProperty('--ry', '0deg');
  };

  if (user) return <Navigate to={from} replace />;
  if (showIntro) return <IntroVideo onFinish={() => setShowIntro(false)} />;

  return (
    <div
      ref={stageRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="oms-login-blue relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10"
    >
      {/* Absolute, not in the flex flow: untrusted cert banner */}
      <div className="absolute inset-x-0 top-0 z-20">
        <UntrustedCertBanner />
      </div>

      {/* ── Background: blue half / orange half (50/50, see .oms-login-orange) ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Blue side glows */}
        <div
          className="oms-blob absolute -top-24 -left-24 size-80 rounded-full bg-cyan-400/40 blur-3xl sm:size-[30rem]"
          style={{ animation: 'oms-float 20s ease-in-out infinite' }}
        />
        <div
          className="oms-blob absolute -bottom-32 left-1/4 size-80 rounded-full bg-indigo-500/50 blur-3xl sm:size-[28rem]"
          style={{ animation: 'oms-float-reverse 24s ease-in-out infinite', animationDelay: '-6s' }}
        />

        {/* Orange half — its own glows ride along inside it */}
        <div className="oms-login-orange">
          {/* Light pulses running along the seam */}
          <div className="oms-seam-streak absolute left-0 h-[22vmax] w-[3px] -translate-x-1/2 bg-gradient-to-b from-transparent via-white to-transparent shadow-[0_0_14px_3px_rgba(255,255,255,0.7)]" />
          <div className="oms-seam-streak absolute left-0 h-[14vmax] w-[2px] -translate-x-1/2 bg-gradient-to-b from-transparent via-amber-100 to-transparent" style={{ ['--delay' as string]: '-2.2s' }} />
          <div
            className="oms-blob absolute size-[26rem] rounded-full bg-amber-300/55 blur-3xl"
            style={{ left: '6vmax', top: 'calc(50% - 34vmax)', animation: 'oms-float 18s ease-in-out infinite' }}
          />
          <div
            className="oms-blob absolute size-[30rem] rounded-full bg-rose-500/35 blur-3xl"
            style={{ left: '18vmax', top: 'calc(50% + 8vmax)', animation: 'oms-float-reverse 22s ease-in-out infinite', animationDelay: '-4s' }}
          />
        </div>

        {/* Soft dots + cursor spotlight */}
        <div className="bg-dotted absolute inset-0 opacity-25 mix-blend-overlay" />
        <div className="oms-login-spotlight absolute inset-0" />

        {/* Rising sparks */}
        {[
          { left: '8%', size: '6px', delay: '0s', duration: '13s', color: 'bg-cyan-200 shadow-[0_0_12px_#22d3ee]' },
          { left: '20%', size: '8px', delay: '4s', duration: '16s', color: 'bg-white shadow-[0_0_12px_#60a5fa]' },
          { left: '33%', size: '5px', delay: '7s', duration: '12s', color: 'bg-sky-200 shadow-[0_0_12px_#38bdf8]' },
          { left: '58%', size: '7px', delay: '2s', duration: '15s', color: 'bg-amber-200 shadow-[0_0_12px_#f59e0b]' },
          { left: '72%', size: '6px', delay: '6s', duration: '14s', color: 'bg-white shadow-[0_0_12px_#fb923c]' },
          { left: '88%', size: '9px', delay: '1s', duration: '17s', color: 'bg-yellow-200 shadow-[0_0_12px_#fbbf24]' },
        ].map((e, idx) => (
          <div
            key={idx}
            className={cn('oms-blob absolute rounded-full', e.color)}
            style={{
              left: e.left,
              width: e.size,
              height: e.size,
              animation: `oms-ember-float ${e.duration} linear infinite`,
              animationDelay: e.delay,
            }}
          />
        ))}
      </div>

      {/* ── Login Card: spinning blue/orange border around a frosted panel ── */}
      <div className="oms-rise relative z-10 w-full max-w-[350px] sm:max-w-md">
        <div className="oms-login-ring oms-login-tilt rounded-[1.4rem] p-[2px] shadow-[0_30px_90px_-20px_rgba(15,23,42,0.75)] sm:rounded-[1.9rem]">
        <div className="relative overflow-hidden rounded-[1.3rem] bg-white/85 p-5 backdrop-blur-2xl sm:rounded-[1.8rem] sm:p-8">
          {/* Top glass highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white via-white/40 to-transparent"
          />

          <div className="relative flex flex-col items-center text-center">
            {/* Logo with a spinning brand halo */}
            <div className="oms-rise relative mb-3" style={{ animationDelay: '120ms' }}>
              <div aria-hidden className="oms-login-ring absolute -inset-1.5 rounded-full opacity-90 blur-[3px]" />
              <div className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-white p-1 shadow-xl sm:size-24">
                <img src={company?.logo || kavishLogo} alt={company?.name || APP_NAME} className="size-full object-contain p-1.5 sm:p-2" />
                <span aria-hidden className="oms-logo-glint pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
              </div>
            </div>
            <h1 className="oms-rise text-xl font-bold tracking-tight text-slate-900 sm:text-2xl" style={{ animationDelay: '200ms' }}>
              Welcome to <span className="text-gradient-blue-orange-shimmer font-extrabold">{APP_NAME}</span>
            </h1>
            <p className="oms-rise mt-0.5 text-xs font-medium text-slate-600 sm:mt-1 sm:text-sm" style={{ animationDelay: '260ms' }}>
              Sign in to manage your{' '}
              <span key={word} className="inline-block font-semibold text-blue-700 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
                {TAGLINE[word]}
              </span>
            </p>
          </div>

          {/* Mode toggle */}
          <div style={{ animationDelay: '320ms' }} className="oms-rise relative mt-4 sm:mt-6 flex rounded-full border border-white/60 bg-slate-900/10 backdrop-blur-md p-1">
            <span
              className={cn(
                'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white/90 shadow-md transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                mode === 'pin' ? 'translate-x-full' : 'translate-x-0',
              )}
            />
            {(['password', 'pin'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'relative z-10 flex-1 rounded-full py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition-colors',
                  mode === m ? 'text-slate-900' : 'text-slate-700 hover:text-slate-900',
                )}
              >
                {m === 'password' ? 'Password' : 'PIN'}
              </button>
            ))}
          </div>

          {/* Panels */}
          <div key={mode} className="mt-4 sm:mt-6 duration-300 animate-in fade-in-0">
            {mode === 'password' ? (
              /* A REAL form with a real submit button, on purpose. Browser
                 password managers offer to save a login when they observe a form
                 submission — with the fields loose in <div>s and sign-in wired to
                 a click handler, Chrome and iOS have nothing to observe and the
                 "save password?" prompt never appears. `name` attributes and the
                 autocomplete tokens below are the other half of that detection. */
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitPassword();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-semibold text-slate-800 drop-shadow-sm">Email</Label>
                  <div className="group relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 transition-all duration-300 group-focus-within:scale-125 group-focus-within:text-blue-600" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      placeholder="you@company.com"
                      className="pl-9 bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 shadow-sm transition-all duration-200"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="font-semibold text-slate-800 drop-shadow-sm">Password</Label>
                  <div className="group relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 transition-all duration-300 group-focus-within:scale-125 group-focus-within:text-blue-600" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9 bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 shadow-sm transition-all duration-200"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="oms-login-cta relative h-11 w-full overflow-hidden border-none font-semibold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-110 active:translate-y-0 active:scale-[0.99]"
                  disabled={pending}
                >
                  <span aria-hidden className="oms-login-cta-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {pending ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            ) : rememberedEmail ? (
              <div className="space-y-5">
                {/* Account identity (read-only) — no email field in PIN mode */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 rounded-full border bg-muted/50 py-1.5 pl-1.5 pr-3 text-sm">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {rememberedEmail[0]?.toUpperCase()}
                    </span>
                    <span className="max-w-[200px] truncate font-medium">{rememberedEmail}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPin('');
                      setMode('password');
                    }}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Not you? Use password
                  </button>
                </div>

                <PinPad value={pin} onChange={setPin} onSubmit={submitPin} disabled={pending} maxLength={4} />
              </div>
            ) : (
              // First time on this device: no remembered account → guide to password.
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <KeyRound className="size-6" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Sign in with your password once on this device to enable quick PIN sign-in.
                </p>
                <Button variant="outline" onClick={() => setMode('password')}>
                  Use password
                </Button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
