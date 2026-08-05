import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLandingRoute } from '@/hooks/use-landing-route';

export function ForbiddenPage() {
  // "Back to dashboard" pointed at "/", which for a user without dashboard
  // access redirected straight back here — the denial was a dead end for
  // exactly the users who land on it. Send them to a page they can open.
  const landing = useLandingRoute();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          {landing
            ? 'You don’t have permission to view this page.'
            : 'Your account has no pages assigned yet. Ask an administrator to grant access.'}
        </p>
      </div>
      {landing && (
        <Button asChild variant="outline">
          <Link to={landing}>Go to my home page</Link>
        </Button>
      )}
    </div>
  );
}
