import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, KeyRound, Loader2, Mail, Save, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { UserStatus } from '@oms/shared';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateUser, useRoles, useSetUserPassword, useUpdateUser, useUser } from './use-admin';

const STATUSES: UserStatus[] = ['active', 'disabled', 'invited'];
const STATUS_SEGMENT_TONE: Record<UserStatus, string> = {
  active: 'data-[on=true]:bg-emerald-50 data-[on=true]:text-emerald-700 data-[on=true]:ring-emerald-200 dark:data-[on=true]:bg-emerald-500/15 dark:data-[on=true]:text-emerald-300',
  disabled: 'data-[on=true]:bg-rose-50 data-[on=true]:text-rose-700 data-[on=true]:ring-rose-200 dark:data-[on=true]:bg-rose-500/15 dark:data-[on=true]:text-rose-300',
  invited: 'data-[on=true]:bg-amber-50 data-[on=true]:text-amber-700 data-[on=true]:ring-amber-200 dark:data-[on=true]:bg-amber-500/15 dark:data-[on=true]:text-amber-300',
};
const AVATAR_TONES = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-fuchsia-500 to-purple-600',
  'from-sky-500 to-cyan-600',
  'from-rose-500 to-pink-600',
];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const toneFor = (id: string) => AVATAR_TONES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

export function UserFormPage() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const isEdit = !!id;

  const { data: user, isLoading: loadingUser } = useUser(id);
  const { data: roles } = useRoles();
  const create = useCreateUser();
  const update = useUpdateUser(id ?? '');
  const saving = create.isPending || update.isPending;

  const [roleSearch, setRoleSearch] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<UserStatus>('active');
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  // Kept apart from `password` (which only creates): resetting is its own
  // deliberate action with its own button, not something a name edit carries.
  const [newPassword, setNewPassword] = useState('');
  const setPasswordMutation = useSetUserPassword(id ?? '');

  useEffect(() => {
    if (!user) return;
    setEmail(user.email);
    setName(user.name);
    setStatus(user.status);
    setRoleIds(new Set(user.roles.map((r) => r.id)));
  }, [user]);

  const toggleRole = (rid: string) =>
    setRoleIds((prev) => {
      const next = new Set(prev);
      next.has(rid) ? next.delete(rid) : next.add(rid);
      return next;
    });

  const visibleRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    const all = roles ?? [];
    return q ? all.filter((r) => r.label.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : all;
  }, [roles, roleSearch]);
  const allVisibleSelected = visibleRoles.length > 0 && visibleRoles.every((r) => roleIds.has(r.id));
  const toggleAllVisible = () =>
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleRoles.forEach((r) => next.delete(r.id));
      else visibleRoles.forEach((r) => next.add(r.id));
      return next;
    });

  const goBack = () => navigate('/admin/users');

  const submit = () => {
    if (!name.trim()) return toast.error('Name is required');
    if (roleIds.size === 0) return toast.error('Assign at least one role');
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? 'User updated' : 'User created');
        goBack();
      },
      onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Save failed')),
    };
    if (isEdit) {
      update.mutate({ name: name.trim(), status, roleIds: [...roleIds] }, opts);
    } else {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return toast.error('Enter a valid email');
      if (password.length < 8) return toast.error('Password must be at least 8 characters');
      create.mutate({ email: email.trim(), name: name.trim(), password, status, roleIds: [...roleIds] }, opts);
    }
  };

  useSaveShortcut(submit);

  if (isEdit && loadingUser) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const previewId = user?.id ?? (name || email || 'new');

  return (
    <div className="mx-auto max-w-3xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={goBack} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <span className={cn('bg-gradient-to-br flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm', toneFor(previewId))}>
          {initials(name || 'New User')}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] leading-tight font-bold tracking-tight">{isEdit ? 'Edit user' : 'New user'}</h2>
          <p className="text-muted-foreground truncate text-[11.5px] font-medium">
            {isEdit ? (user?.email ?? `#${id}`) : 'Create an account and grant it access'}
          </p>
        </div>
      </div>

      {/* ── Account: identity fields, minimal on purpose ─────────────────── */}
      <div className="bg-card grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
            <Mail className="size-3.5" /> Email {!isEdit && '*'}
          </Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isEdit}
            placeholder="name@company.com"
            title={isEdit ? 'Email is permanent once the account is created' : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Full name" />
        </div>
        {!isEdit && (
          <div className="space-y-1.5">
            <Label className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
              <KeyRound className="size-3.5" /> Password *
            </Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" />
          </div>
        )}
      </div>

      {/* Reset, not reveal: the existing password is stored only as a one-way
          hash, so it cannot be shown to anyone — it can only be replaced. */}
      {isEdit && (
        <div className="space-y-1.5 rounded-lg border p-3">
          <Label className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
            <KeyRound className="size-3.5" /> Set a new password
          </Label>
          <p className="text-muted-foreground text-[11.5px]">
            The current password can't be displayed — it's stored as a one-way hash, so nobody can read it. Use this when
            someone has forgotten theirs. Saving signs them out of every device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="max-w-xs"
              autoComplete="new-password"
            />
            <Button
              type="button"
              variant="outline"
              disabled={newPassword.length < 8 || setPasswordMutation.isPending}
              onClick={() =>
                setPasswordMutation.mutate(newPassword, {
                  onSuccess: () => {
                    setNewPassword('');
                    toast.success(`Password updated — ${name || 'this user'} has been signed out everywhere.`);
                  },
                  onError: (e) => toast.error(getApiErrorMessage(e, 'Could not set the password')),
                })
              }
            >
              {setPasswordMutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Set password
            </Button>
          </div>
        </div>
      )}

      {/* ── Access: everything that decides what this account can do ────── */}
      <div className="space-y-3 rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <ShieldCheck className="size-4" /> Access
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Account status</Label>
          <div className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1 sm:max-w-sm">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                data-on={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  'ring-1 ring-inset ring-transparent rounded-md py-1.5 text-xs font-bold capitalize transition-all active:scale-[0.98]',
                  status === s ? cn('bg-card shadow-sm', STATUS_SEGMENT_TONE[s]) : 'text-muted-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Roles * <span className="text-primary/70 normal-case">({roleIds.size} assigned)</span>
            </Label>
            {(roles?.length ?? 0) > 5 && (
              <button type="button" onClick={toggleAllVisible} className="text-primary text-[11px] font-semibold hover:underline">
                {allVisibleSelected ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {(roles?.length ?? 0) > 5 && (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} placeholder="Search roles…" className="h-8 pl-8 text-sm" />
            </div>
          )}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {visibleRoles.map((r) => {
              const on = roleIds.has(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => toggleRole(r.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    on ? 'bg-primary/[0.06] ring-1 ring-primary/20' : 'hover:bg-muted/60 bg-card ring-1 ring-border',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-400',
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{r.label}</span>
                    {r.description && <span className="text-muted-foreground block text-xs">{r.description}</span>}
                  </span>
                </button>
              );
            })}
            {!visibleRoles.length && <p className="text-muted-foreground col-span-2 p-2 text-sm">{roleSearch ? 'No roles match your search.' : 'No roles defined yet.'}</p>}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-2">
        <Button type="button" variant="outline" onClick={goBack}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : isEdit ? <Save /> : <UserPlus />} {isEdit ? 'Save' : 'Create user'}
        </Button>
      </div>
    </div>
  );
}

export default UserFormPage;
