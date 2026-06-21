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
import { AgentsPage } from '@/features/agents/agents-page';
import { GstRatesPage } from '@/features/gst-rates/gst-rates-page';
import { TransRatesPage } from '@/features/trans-rates/trans-rates-page';
import { ProductsPage } from '@/features/products/products-page';
import { DesignsPage } from '@/features/designs/designs-page';
import { DesignNamesPage } from '@/features/design-names/design-names-page';
import { OrdersPage } from '@/features/orders/orders-page';
import { OrderFormPage } from '@/features/orders/order-form-page';
import { SettingsPage } from '@/features/settings/settings-page';
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
            path="/agents"
            element={
              <RequirePermission permission={perm(RESOURCES.AGENT, ACTIONS.VIEW)}>
                <AgentsPage />
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
          <Route
            path="/products"
            element={
              <RequirePermission permission={perm(RESOURCES.PRODUCT, ACTIONS.VIEW)}>
                <ProductsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/designs"
            element={
              <RequirePermission permission={perm(RESOURCES.DESIGN, ACTIONS.VIEW)}>
                <DesignsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/design-names"
            element={
              <RequirePermission permission={perm(RESOURCES.DESIGN_NAME, ACTIONS.VIEW)}>
                <DesignNamesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/orders"
            element={
              <RequirePermission permission={perm(RESOURCES.ORDER, ACTIONS.VIEW)}>
                <OrdersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/orders/new"
            element={
              <RequirePermission permission={perm(RESOURCES.ORDER, ACTIONS.CREATE)}>
                <OrderFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/orders/:id/edit"
            element={
              <RequirePermission permission={perm(RESOURCES.ORDER, ACTIONS.UPDATE)}>
                <OrderFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings"
            element={
              <RequirePermission permission={perm(RESOURCES.SETTING, ACTIONS.VIEW)}>
                <SettingsPage />
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
