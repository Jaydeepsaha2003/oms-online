import { useCallback, useEffect, useState } from 'react';
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

  if (user) return <Navigate to={from} replace />;
  if (showIntro) return <IntroVideo onFinish={() => setShowIntro(false)} />;

  return (
    <div className="bg-animated-blue-orange-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Absolute, not in the flex flow: untrusted cert banner */}
      <div className="absolute inset-x-0 top-0 z-20">
        <UntrustedCertBanner />
      </div>

      {/* ── Ultra-premium hyper-animated Blue & Orange background ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Radial dark vignette for depth */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-950/30 via-slate-950/75 to-black/90" />
        
        {/* Dotted grid overlay */}
        <div className="bg-dotted absolute inset-0 opacity-30 mix-blend-overlay" />

        {/* Dynamic rotating geometric glowing rings */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[45rem] rounded-full border border-blue-500/20"
          style={{ animation: 'oms-orbit-spin 45s linear infinite' }}
        >
          <div className="absolute top-0 left-1/2 size-4 -translate-x-1/2 rounded-full bg-blue-400/50 blur-sm" />
          <div className="absolute bottom-0 left-1/2 size-5 -translate-x-1/2 rounded-full bg-orange-500/60 blur-sm" />
        </div>
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[65rem] rounded-full border border-orange-500/15"
          style={{ animation: 'oms-orbit-spin 65s linear infinite reverse' }}
        >
          <div className="absolute top-1/2 right-0 size-6 -translate-y-1/2 rounded-full bg-amber-400/50 blur-md" />
          <div className="absolute top-1/2 left-0 size-5 -translate-y-1/2 rounded-full bg-cyan-400/50 blur-md" />
        </div>

        {/* Ambient floating liquid gradient blobs - vibrant blue/orange contrast motion */}
        <div
          className="oms-blob absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 size-72 sm:-left-16 sm:-top-16 sm:translate-x-0 sm:translate-y-0 sm:size-[28rem] rounded-full bg-gradient-to-tr from-blue-600/60 via-indigo-500/50 to-orange-500/45 blur-3xl"
          style={{ animation: 'oms-float 22s ease-in-out infinite' }}
        />
        <div
          className="oms-blob absolute right-0 top-1/3 size-80 sm:-right-24 sm:top-1/4 sm:size-[32rem] rounded-full bg-gradient-to-bl from-orange-600/60 via-amber-500/50 to-blue-600/45 blur-3xl"
          style={{ animation: 'oms-float-reverse 26s ease-in-out infinite', animationDelay: '-5s' }}
        />
        <div
          className="oms-blob absolute left-0 bottom-1/4 size-80 sm:-bottom-32 sm:left-1/4 sm:size-[36rem] rounded-full bg-gradient-to-t from-indigo-700/55 via-blue-500/50 to-orange-500/45 blur-3xl"
          style={{ animation: 'oms-float 30s ease-in-out infinite', animationDelay: '-11s' }}
        />
        <div
          className="oms-blob absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[24rem] sm:size-[32rem] rounded-full bg-gradient-to-r from-blue-500/35 via-orange-400/40 to-amber-400/35 blur-3xl"
          style={{ animation: 'oms-pulse-glow 10s ease-in-out infinite' }}
        />
        <div
          className="oms-blob absolute right-4 bottom-10 size-72 sm:right-10 sm:-bottom-10 sm:size-96 rounded-full bg-gradient-to-l from-blue-600/50 to-orange-600/50 blur-3xl"
          style={{ animation: 'oms-float-reverse 24s ease-in-out infinite', animationDelay: '-8s' }}
        />

        {/* Rising animated blue & orange ember sparkles */}
        {[
          { left: '10%', size: '6px', delay: '0s', duration: '14s', color: 'bg-cyan-300 shadow-[0_0_12px_#3b82f6]' },
          { left: '25%', size: '8px', delay: '3s', duration: '17s', color: 'bg-amber-200 shadow-[0_0_12px_#f97316]' },
          { left: '42%', size: '5px', delay: '6s', duration: '13s', color: 'bg-blue-300 shadow-[0_0_12px_#2563eb]' },
          { left: '60%', size: '7px', delay: '1s', duration: '16s', color: 'bg-orange-300 shadow-[0_0_12px_#ea580c]' },
          { left: '78%', size: '6px', delay: '5s', duration: '15s', color: 'bg-sky-300 shadow-[0_0_12px_#06b6d4]' },
          { left: '90%', size: '9px', delay: '2s', duration: '18s', color: 'bg-amber-300 shadow-[0_0_12px_#f59e0b]' },
        ].map((e, idx) => (
          <div
            key={idx}
            className={cn('absolute rounded-full', e.color)}
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

      {/* ── Login Card ── */}
      <div className="relative z-10 w-full max-w-[340px] sm:max-w-md">
        <div className="apple-liquid-glass relative overflow-hidden rounded-2xl sm:rounded-3xl p-5 sm:p-8 duration-500 animate-in fade-in-0 slide-in-from-bottom-4 shadow-[0_25px_80px_-15px_rgba(37,99,235,0.4)]">
          {/* Top Glass Highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20 sm:h-28 bg-gradient-to-b from-white/90 via-blue-50/20 to-transparent opacity-70"
          />

          <div className="relative flex flex-col items-center text-center">
            {/* Logo container with breathing glow ring */}
            <div className="mb-2 flex size-20 sm:size-28 items-center justify-center overflow-hidden rounded-full bg-white/95 p-1 shadow-xl ring-4 ring-blue-500/30 drop-shadow-md backdrop-blur-md">
              <img src={company?.logo || kavishLogo} alt={company?.name || APP_NAME} className="size-full object-contain p-1.5 sm:p-2" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Welcome to <span className="text-gradient-blue-orange-shimmer font-extrabold">{APP_NAME}</span>
            </h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600 font-medium">Sign in to your {APP_NAME} workspace</p>
          </div>

          {/* Mode toggle */}
          <div className="relative mt-4 sm:mt-6 flex rounded-full border border-white/60 bg-slate-900/10 backdrop-blur-md p-1">
            <span
              className={cn(
                'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white/90 shadow-md transition-transform duration-300',
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
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
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
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
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
                  className="h-11 w-full border-none bg-gradient-to-r from-blue-600 via-indigo-600 to-orange-500 font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:brightness-110 active:scale-[0.99]"
                  disabled={pending}
                >
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
  );
}
