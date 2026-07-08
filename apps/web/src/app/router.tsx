import { Route, Routes } from 'react-router-dom';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { RequirePermission } from '@/components/auth/require-permission';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { CustomersPage } from '@/features/customers/customers-page';
import { CustomerFormPage } from '@/features/customers/customer-form-page';
import { RateListPage } from '@/features/customers/rate-list-page';
import { TransportersPage } from '@/features/transporters/transporters-page';
import { AgentsPage } from '@/features/agents/agents-page';
import { GstRatesPage } from '@/features/gst-rates/gst-rates-page';
import { TransRatesPage } from '@/features/trans-rates/trans-rates-page';
import { ProductsPage } from '@/features/products/products-page';
import { DesignsPage } from '@/features/designs/designs-page';
import { DesignNamesPage } from '@/features/design-names/design-names-page';
import { OrdersPage } from '@/features/orders/orders-page';
import { OrderFormPage } from '@/features/orders/order-form-page';
import { OrderModifyPage } from '@/features/orders/order-modify-page';
import { OrderBillPage } from '@/features/orders/order-bill-page';
import { BookingsPage } from '@/features/bookings/bookings-page';
import { BookingFormPage } from '@/features/bookings/booking-form-page';
import { BookingConvertPage } from '@/features/bookings/booking-convert-page';
import { PriceHistoryPage } from '@/features/bookings/price-history-page';
import { QuotationsPage } from '@/features/quotations/quotations-page';
import { DispatchOrderPage } from '@/features/dispatch/dispatch-order-page';
import { ModifyDispatchPage } from '@/features/dispatch/modify-dispatch-page';
import { SpecialRatesPage } from '@/features/special-rates/special-rates-page';
import { PendingChallanPage } from '@/features/challans/pending-challan-page';
import { ChallanFormPage } from '@/features/challans/challan-form-page';
import { ChallansListPage } from '@/features/challans/challans-list-page';
import { ChallanItemsPage } from '@/features/challans/challan-items-page';
import { FollowupsPage, PaymentsFollowupsPage } from '@/features/crm/followups-page';
import { ManageChequesPage } from '@/features/account/manage-cheques-page';
import { BankAccountsPage } from '@/features/account/bank-accounts-page';
import { OpeningBalancePage } from '@/features/account/opening-balance-page';
import { PaymentPage } from '@/features/account/payment-page';
import { SalesDiscountPage } from '@/features/account/sales-discount-page';
import { NotesPage } from '@/features/account/notes-page';
import { PartyLedgerPage } from '@/features/account/party-ledger-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { UsersPage } from '@/features/admin/users-page';
import { RolesPage } from '@/features/admin/roles-page';
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
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
