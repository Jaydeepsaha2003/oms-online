import { Route, Routes } from 'react-router-dom';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { RequirePermission } from '@/components/auth/require-permission';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { CustomersPage } from '@/features/customers/customers-page';
import { CustomerFormPage } from '@/features/customers/customer-form-page';
import { TransportersPage } from '@/features/transporters/transporters-page';
import { GstRatesPage } from '@/features/gst-rates/gst-rates-page';
import { TransRatesPage } from '@/features/trans-rates/trans-rates-page';
import { ForbiddenPage } from '@/features/errors/forbidden-page';
import { NotFoundPage } from '@/features/errors/not-found-page';

/** Explicit route table. We add a route per screen as it's built. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            path="/"
            element={
              <RequirePermission permission={perm(RESOURCES.DASHBOARD, ACTIONS.VIEW)}>
                <DashboardPage />
              </RequirePermission>
            }
          />
          <Route
            path="/customers"
            element={
              <RequirePermission permission={perm(RESOURCES.CUSTOMER, ACTIONS.VIEW)}>
                <CustomersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/customers/new"
            element={
              <RequirePermission permission={perm(RESOURCES.CUSTOMER, ACTIONS.CREATE)}>
                <CustomerFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/customers/:id/edit"
            element={
              <RequirePermission permission={perm(RESOURCES.CUSTOMER, ACTIONS.UPDATE)}>
                <CustomerFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/transporters"
            element={
              <RequirePermission permission={perm(RESOURCES.TRANSPORTER, ACTIONS.VIEW)}>
                <TransportersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/gst-rates"
            element={
              <RequirePermission permission={perm(RESOURCES.GST_RATE, ACTIONS.VIEW)}>
                <GstRatesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/transport-rates"
            element={
              <RequirePermission permission={perm(RESOURCES.TRANS_RATE, ACTIONS.VIEW)}>
                <TransRatesPage />
              </RequirePermission>
            }
          />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
