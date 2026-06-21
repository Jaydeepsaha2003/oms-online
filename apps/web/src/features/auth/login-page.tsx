import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Eye, EyeOff, KeyRound, Loader2, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/lib/api';
import { useLogin, usePinLogin } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PinPad } from '@/components/auth/pin-pad';

type Mode = 'password' | 'pin';
const LAST_EMAIL_KEY = 'oms:last-email';
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'OMS';
const emailValid = (v: string) => /.+@.+\..+/.test(v.trim());

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  const login = useLogin();
  const pinLogin = usePinLogin();
  const pending = login.isPending || pinLogin.isPending;

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
    if (pin.length < 4) return toast.error('Enter your 4–6 digit PIN');
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
      if (e.key >= '0' && e.key <= '9') setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submitPin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, rememberedEmail, submitPin]);

  if (user) return <Navigate to={from} replace />;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 via-white to-amber-50 px-4 py-10">
      {/* Animated brand background (blue · amber · orange) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="bg-dotted absolute inset-0 opacity-60" />
        <div
          className="oms-blob absolute -left-24 -top-24 size-72 rounded-full bg-blue-400/35 blur-3xl"
          style={{ animation: 'oms-float 22s ease-in-out infinite' }}
        />
        <div
          className="oms-blob absolute -right-24 top-1/4 size-80 rounded-full bg-amber-400/35 blur-3xl"
          style={{ animation: 'oms-float 26s ease-in-out infinite', animationDelay: '-6s' }}
        />
        <div
          className="oms-blob absolute -bottom-32 left-1/3 size-96 rounded-full bg-orange-300/35 blur-3xl"
          style={{ animation: 'oms-float 30s ease-in-out infinite', animationDelay: '-12s' }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/70 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl duration-500 animate-in fade-in-0 slide-in-from-bottom-4 sm:p-8">
          {/* Glass highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/70 to-transparent"
          />

          <div className="relative flex flex-col items-center text-center">
            <div className="bg-gradient-brand mb-3 flex size-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-blue-600/30 ring-1 ring-white/30">
              <Boxes className="size-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome to <span className="text-gradient-brand">{APP_NAME}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your {APP_NAME} workspace</p>
          </div>

          {/* Mode toggle */}
          <div className="relative mt-6 flex rounded-full border bg-muted/60 p-1">
            <span
              className={cn(
                'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-sm transition-transform duration-300',
                mode === 'pin' ? 'translate-x-full' : 'translate-x-0',
              )}
            />
            {(['password', 'pin'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'relative z-10 flex-1 rounded-full py-2 text-sm font-medium transition-colors',
                  mode === m ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'password' ? 'Password' : 'PIN'}
              </button>
            ))}
          </div>

          {/* Panels */}
          <div key={mode} className="mt-6 duration-300 animate-in fade-in-0">
            {mode === 'password' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      placeholder="you@company.com"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="px-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button className="w-full" onClick={submitPassword} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {pending ? 'Signing in…' : 'Sign in'}
                </Button>
              </div>
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

                <PinPad value={pin} onChange={setPin} onSubmit={submitPin} disabled={pending} />
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

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Dev login: <span className="font-medium">admin@oms.local</span> · password{' '}
          <span className="font-medium">Admin@12345</span> · PIN <span className="font-medium">246813</span>
        </p>
      </div>
    </div>
  );
}
