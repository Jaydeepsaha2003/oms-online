import { Loader2 } from 'lucide-react';

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
