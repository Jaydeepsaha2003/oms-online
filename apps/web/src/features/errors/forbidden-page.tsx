import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          You don’t have permission to view this page.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
