import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <div>
        <h2 className="text-lg font-semibold">Page not found</h2>
        <p className="text-sm text-muted-foreground">The page you’re looking for doesn’t exist.</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
