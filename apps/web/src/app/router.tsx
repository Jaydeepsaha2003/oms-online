import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { RequirePermission } from '@/components/auth/require-permission';
import { AppShell } from '@/components/layout/app-shell';
import { FullScreenLoader } from '@/components/common/full-screen-loader';
import { useAuthStore } from '@/stores/auth-store';
import { queryClient } from '@/lib/query';

// Every screen loads on demand instead of all being bundled into one giant
// upfront chunk — first paint only pulls in the page you're actually on
// (e.g. jspdf/xlsx/recharts only load with the pages that use them), so the
// PWA opens fast even on a slow phone connection.
const LoginPage = lazy(() => import('@/features/auth/login-page').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })));
const CustomersPage = lazy(() => import('@/features/customers/customers-page').then((m) => ({ default: m.CustomersPage })));
const CustomerFormPage = lazy(() => import('@/features/customers/customer-form-page').then((m) => ({ default: m.CustomerFormPage })));
const RateListPage = lazy(() => import('@/features/customers/rate-list-page').then((m) => ({ default: m.RateListPage })));
const TransportersPage = lazy(() => import('@/features/transporters/transporters-page').then((m) => ({ default: m.TransportersPage })));
const AgentsPage = lazy(() => import('@/features/agents/agents-page').then((m) => ({ default: m.AgentsPage })));
const GstRatesPage = lazy(() => import('@/features/gst-rates/gst-rates-page').then((m) => ({ default: m.GstRatesPage })));
const TransRatesPage = lazy(() => import('@/features/trans-rates/trans-rates-page').then((m) => ({ default: m.TransRatesPage })));
const ProductsPage = lazy(() => import('@/features/products/products-page').then((m) => ({ default: m.ProductsPage })));
const DesignsPage = lazy(() => import('@/features/designs/designs-page').then((m) => ({ default: m.DesignsPage })));
const DesignNamesPage = lazy(() => import('@/features/design-names/design-names-page').then((m) => ({ default: m.DesignNamesPage })));
const OrdersPage = lazy(() => import('@/features/orders/orders-page').then((m) => ({ default: m.OrdersPage })));
const OrderFormPage = lazy(() => import('@/features/orders/order-form-page').then((m) => ({ default: m.OrderFormPage })));
const OrderModifyPage = lazy(() => import('@/features/orders/order-modify-page').then((m) => ({ default: m.OrderModifyPage })));
const OrderBillPage = lazy(() => import('@/features/orders/order-bill-page').then((m) => ({ default: m.OrderBillPage })));
const BookingsPage = lazy(() => import('@/features/bookings/bookings-page').then((m) => ({ default: m.BookingsPage })));
const BookingFormPage = lazy(() => import('@/features/bookings/booking-form-page').then((m) => ({ default: m.BookingFormPage })));
const BookingConvertPage = lazy(() => import('@/features/bookings/booking-convert-page').then((m) => ({ default: m.BookingConvertPage })));
const PriceHistoryPage = lazy(() => import('@/features/bookings/price-history-page').then((m) => ({ default: m.PriceHistoryPage })));
const QuotationsPage = lazy(() => import('@/features/quotations/quotations-page').then((m) => ({ default: m.QuotationsPage })));
const DispatchOrderPage = lazy(() => import('@/features/dispatch/dispatch-order-page').then((m) => ({ default: m.DispatchOrderPage })));
const ModifyDispatchPage = lazy(() => import('@/features/dispatch/modify-dispatch-page').then((m) => ({ default: m.ModifyDispatchPage })));
const SpecialRatesPage = lazy(() => import('@/features/special-rates/special-rates-page').then((m) => ({ default: m.SpecialRatesPage })));
const PendingChallanPage = lazy(() => import('@/features/challans/pending-challan-page').then((m) => ({ default: m.PendingChallanPage })));
const ChallanFormPage = lazy(() => import('@/features/challans/challan-form-page').then((m) => ({ default: m.ChallanFormPage })));
const ChallansListPage = lazy(() => import('@/features/challans/challans-list-page').then((m) => ({ default: m.ChallansListPage })));
const ChallanItemsPage = lazy(() => import('@/features/challans/challan-items-page').then((m) => ({ default: m.ChallanItemsPage })));
const ChallanBillPage = lazy(() => import('@/features/challans/challan-bill-page').then((m) => ({ default: m.ChallanBillPage })));
const FollowupsPage = lazy(() => import('@/features/crm/followups-page').then((m) => ({ default: m.FollowupsPage })));
const PaymentsFollowupsPage = lazy(() => import('@/features/crm/followups-page').then((m) => ({ default: m.PaymentsFollowupsPage })));
const ManageChequesPage = lazy(() => import('@/features/account/manage-cheques-page').then((m) => ({ default: m.ManageChequesPage })));
const BankAccountsPage = lazy(() => import('@/features/account/bank-accounts-page').then((m) => ({ default: m.BankAccountsPage })));
const OpeningBalancePage = lazy(() => import('@/features/account/opening-balance-page').then((m) => ({ default: m.OpeningBalancePage })));
const PaymentPage = lazy(() => import('@/features/account/payment-page').then((m) => ({ default: m.PaymentPage })));
const AdvancesPage = lazy(() => import('@/features/account/advances-page').then((m) => ({ default: m.AdvancesPage })));
const SalesDiscountPage = lazy(() => import('@/features/account/sales-discount-page').then((m) => ({ default: m.SalesDiscountPage })));
const NotesPage = lazy(() => import('@/features/account/notes-page').then((m) => ({ default: m.NotesPage })));
const PartyLedgerPage = lazy(() => import('@/features/account/party-ledger-page').then((m) => ({ default: m.PartyLedgerPage })));
const SettingsPage = lazy(() => import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('@/features/admin/users-page').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/features/admin/roles-page').then((m) => ({ default: m.RolesPage })));
const AuditLogPage = lazy(() => import('@/features/audit-log/audit-log-page').then((m) => ({ default: m.AuditLogPage })));
const ForbiddenPage = lazy(() => import('@/features/errors/forbidden-page').then((m) => ({ default: m.ForbiddenPage })));
const NotFoundPage = lazy(() => import('@/features/errors/not-found-page').then((m) => ({ default: m.NotFoundPage })));

// Warm every page chunk in the background shortly after the app opens. The
// glob resolves to the SAME modules (and therefore the same content-hashed
// chunks) as the lazy() imports above, and the service worker caches /assets/
// forever - so once this finishes, the FIRST click on any screen serves its
// code from cache instead of downloading it, which used to take seconds per
// screen on slow links (phone over the router's OpenVPN). Chunks load one at
// a time with a gap so the prefetch never hogs bandwidth the user's current
// screen is using.
const pageChunks = import.meta.glob('../features/**/*-page.tsx');
let prefetchStarted = false;
function prefetchAllPages() {
  if (prefetchStarted) return;
  prefetchStarted = true;
  const loaders = Object.values(pageChunks);
  const loadNext = (i: number) => {
    if (i >= loaders.length) return;
    // Yield to live traffic: while any query is fetching (the user just opened
    // a screen and is waiting on its data), hold the prefetch instead of
    // competing for a slow link's bandwidth. Re-check every second.
    if (queryClient.isFetching() > 0) {
      setTimeout(() => loadNext(i), 1000);
      return;
    }
    void loaders[i]()
      .catch(() => { /* offline or flaky link - that page just lazy-loads on demand */ })
      .then(() => setTimeout(() => loadNext(i + 1), 300));
  };
  loadNext(0);
}

/** Explicit route table. We add a route per screen as it's built. */
export function AppRoutes() {
  // Warm the page chunks only after the session bootstrap has finished, so the
  // prefetch never competes with the login-critical /auth call (or the first
  // screen's data) for a slow link's bandwidth.
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  useEffect(() => {
    if (isBootstrapping) return;
    const t = setTimeout(prefetchAllPages, 6000);
    return () => clearTimeout(t);
  }, [isBootstrapping]);

  return (
    <Suspense fallback={<FullScreenLoader />}>
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
            path="/customers/rate-list"
            element={
              <RequirePermission permission={perm(RESOURCES.CUSTOMER, ACTIONS.VIEW)}>
                <RateListPage />
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
            path="/special-rates"
            element={
              <RequirePermission permission={perm(RESOURCES.SPECIAL_RATE, ACTIONS.VIEW)}>
                <SpecialRatesPage />
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
            path="/orders/modify"
            element={
              <RequirePermission permission={perm(RESOURCES.ORDER, ACTIONS.UPDATE)}>
                <OrderModifyPage />
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
            path="/orders/:id/bill"
            element={
              <RequirePermission permission={perm(RESOURCES.ORDER, ACTIONS.PRINT)}>
                <OrderBillPage />
              </RequirePermission>
            }
          />
          <Route
            path="/bookings"
            element={
              <RequirePermission permission={perm(RESOURCES.BOOKING, ACTIONS.VIEW)}>
                <BookingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/bookings/new"
            element={
              <RequirePermission permission={perm(RESOURCES.BOOKING, ACTIONS.CREATE)}>
                <BookingFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/bookings/:id/convert"
            element={
              <RequirePermission permission={perm(RESOURCES.BOOKING, ACTIONS.CONVERT)}>
                <BookingConvertPage />
              </RequirePermission>
            }
          />
          <Route
            path="/price-history"
            element={
              <RequirePermission permission={perm(RESOURCES.BOOKING, ACTIONS.VIEW)}>
                <PriceHistoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="/quotations"
            element={
              <RequirePermission permission={perm(RESOURCES.QUOTATION, ACTIONS.VIEW)}>
                <QuotationsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/quotations/:id/edit"
            element={
              <RequirePermission permission={perm(RESOURCES.QUOTATION, ACTIONS.UPDATE)}>
                <OrderFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/quotations/:id/bill"
            element={
              <RequirePermission permission={perm(RESOURCES.QUOTATION, ACTIONS.VIEW)}>
                <OrderBillPage />
              </RequirePermission>
            }
          />
          <Route
            path="/dispatch/new"
            element={
              <RequirePermission permission={perm(RESOURCES.DISPATCH, ACTIONS.CREATE)}>
                <DispatchOrderPage />
              </RequirePermission>
            }
          />
          <Route
            path="/dispatch"
            element={
              <RequirePermission permission={perm(RESOURCES.DISPATCH, ACTIONS.VIEW)}>
                <ModifyDispatchPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans/pending"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.VIEW)}>
                <PendingChallanPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans/items"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.VIEW)}>
                <ChallanItemsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans/:id/bill"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.PRINT)}>
                <ChallanBillPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans/:id/edit"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.UPDATE)}>
                <ChallanFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.VIEW)}>
                <ChallansListPage />
              </RequirePermission>
            }
          />
          <Route
            path="/challans/new"
            element={
              <RequirePermission permission={perm(RESOURCES.CHALLAN, ACTIONS.CREATE)}>
                <ChallanFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/payment"
            element={
              <RequirePermission permission={perm(RESOURCES.PAYMENT, ACTIONS.VIEW)}>
                <PaymentPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/advances"
            element={
              <RequirePermission permission={perm(RESOURCES.PAYMENT, ACTIONS.VIEW)}>
                <AdvancesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/discount"
            element={
              <RequirePermission permission={perm(RESOURCES.DISCOUNT, ACTIONS.VIEW)}>
                <SalesDiscountPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/notes"
            element={
              <RequirePermission permission={perm(RESOURCES.NOTE, ACTIONS.VIEW)}>
                <NotesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/party-ledger"
            element={
              <RequirePermission permission={perm(RESOURCES.PARTY_LEDGER, ACTIONS.VIEW)}>
                <PartyLedgerPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/cheques"
            element={
              <RequirePermission permission={perm(RESOURCES.CHEQUE, ACTIONS.VIEW)}>
                <ManageChequesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/bank-accounts"
            element={
              <RequirePermission permission={perm(RESOURCES.BANK_ACCOUNT, ACTIONS.VIEW)}>
                <BankAccountsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/account/opening-balance"
            element={
              <RequirePermission permission={perm(RESOURCES.OPENING_BALANCE, ACTIONS.VIEW)}>
                <OpeningBalancePage />
              </RequirePermission>
            }
          />
          <Route
            path="/crm"
            element={
              <RequirePermission permission={perm(RESOURCES.CRM, ACTIONS.VIEW)}>
                <FollowupsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/crm/payments"
            element={
              <RequirePermission permission={perm(RESOURCES.CRM, ACTIONS.VIEW)}>
                <PaymentsFollowupsPage />
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
          <Route
            path="/admin/users"
            element={
              <RequirePermission permission={perm(RESOURCES.USER, ACTIONS.VIEW)}>
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/roles"
            element={
              <RequirePermission permission={perm(RESOURCES.ROLE, ACTIONS.VIEW)}>
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <RequirePermission permission={perm(RESOURCES.AUDIT_LOG, ACTIONS.VIEW)}>
                <AuditLogPage />
              </RequirePermission>
            }
          />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  );
}
