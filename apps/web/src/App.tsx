import { useBootstrapAuth } from '@/hooks/use-auth';
import { AppRoutes } from '@/app/router';

export default function App() {
  useBootstrapAuth();
  return <AppRoutes />;
}
