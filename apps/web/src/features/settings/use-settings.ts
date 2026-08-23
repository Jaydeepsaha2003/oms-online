import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChallanFieldSettingsDto, ChallanFieldSettingsInput, ChallanTermsDto, ChallanTermsInput, CompanyProfileDto, CompanyProfileInput, DispatchAlertSettingsDto, DispatchAlertSettingsInput, DispatchBagThresholdDto, DispatchBagThresholdInput, OrderFooterDto, OrderFooterInput, OrderOptionDto, OrderOptionInput, OrderQtyLayout, OrderTermsDto, OrderTermsInput, QuotationTermsDto, QuotationTermsInput, TcsSettingDto, TcsSettingInput, NotificationDndDto, NotificationDndInput } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['settings'] as const;
const COMPANY_KEY = ['company'] as const;
const ORDER_TERMS_KEY = ['order-terms'] as const;
const ORDER_FOOTER_KEY = ['order-footer'] as const;
const CHALLAN_TERMS_KEY = ['challan-terms'] as const;
const QUOTATION_TERMS_KEY = ['quotation-terms'] as const;
const ORDER_QTY_LAYOUT_KEY = ['order-qty-layout'] as const;
const TCS_PERCENT_KEY = ['tcs-percent'] as const;
const DISPATCH_BAG_THRESHOLD_KEY = ['dispatch-bag-threshold'] as const;
const DISPATCH_ALERTS_KEY = ['dispatch-alerts'] as const;
const CHALLAN_FIELDS_KEY = ['challan-fields'] as const;
const NOTIFY_DND_KEY = ['notification-dnd'] as const;

export function useCompany() {
  return useQuery({
    queryKey: COMPANY_KEY,
    queryFn: () => http.get<CompanyProfileDto>('/settings/company'),
    staleTime: 60_000,
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyProfileInput) => http.put<CompanyProfileDto>('/settings/company', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMPANY_KEY }),
  });
}

/** Sales Order / Quotation bill's "Terms & Conditions" list. */
export function useOrderTerms() {
  return useQuery({
    queryKey: ORDER_TERMS_KEY,
    queryFn: () => http.get<OrderTermsDto>('/settings/order-terms'),
    staleTime: 60_000,
  });
}

export function useUpdateOrderTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderTermsInput) => http.put<OrderTermsDto>('/settings/order-terms', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORDER_TERMS_KEY }),
  });
}

/** Sales Order / Quotation bill's footer text lines. */
export function useOrderFooter() {
  return useQuery({
    queryKey: ORDER_FOOTER_KEY,
    queryFn: () => http.get<OrderFooterDto>('/settings/order-footer'),
    staleTime: 60_000,
  });
}

export function useUpdateOrderFooter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderFooterInput) => http.put<OrderFooterDto>('/settings/order-footer', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORDER_FOOTER_KEY }),
  });
}

/** Quotation bill's "Terms & Conditions" list. Falls back to the Sales Order
 *  terms server-side until a quotation-specific list is saved. */
export function useQuotationTerms() {
  return useQuery({
    queryKey: QUOTATION_TERMS_KEY,
    queryFn: () => http.get<QuotationTermsDto>('/settings/quotation-terms'),
    staleTime: 60_000,
  });
}

export function useUpdateQuotationTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationTermsInput) => http.put<QuotationTermsDto>('/settings/quotation-terms', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUOTATION_TERMS_KEY }),
  });
}

/** Challan / Tax Invoice bill's "Terms & Conditions" list. Empty by default. */
export function useChallanTerms() {
  return useQuery({
    queryKey: CHALLAN_TERMS_KEY,
    queryFn: () => http.get<ChallanTermsDto>('/settings/challan-terms'),
    staleTime: 60_000,
  });
}

export function useUpdateChallanTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChallanTermsInput) => http.put<ChallanTermsDto>('/settings/challan-terms', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHALLAN_TERMS_KEY }),
  });
}

export function useOrderQtyLayout() {
  return useQuery({
    queryKey: ORDER_QTY_LAYOUT_KEY,
    queryFn: () => http.get<OrderQtyLayout>('/settings/order-qty-layout'),
    staleTime: 60_000,
  });
}

export function useUpdateOrderQtyLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderQtyLayout) => http.put<OrderQtyLayout>('/settings/order-qty-layout', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORDER_QTY_LAYOUT_KEY }),
  });
}

/** Global TCS % applied to SCRAP-category challans. */
export function useTcsPercent() {
  return useQuery({
    queryKey: TCS_PERCENT_KEY,
    queryFn: () => http.get<TcsSettingDto>('/settings/tcs-percent'),
    staleTime: 60_000,
  });
}

export function useUpdateTcsPercent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TcsSettingInput) => http.put<TcsSettingDto>('/settings/tcs-percent', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: TCS_PERCENT_KEY }),
  });
}

/** This user's reminder quiet hours. Per user, not per installation. */
export function useNotificationDnd() {
  return useQuery({
    queryKey: NOTIFY_DND_KEY,
    queryFn: () => http.get<NotificationDndDto>('/notifications/dnd'),
    staleTime: 60_000,
  });
}

export function useUpdateNotificationDnd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationDndInput) => http.post<NotificationDndDto>('/notifications/dnd', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFY_DND_KEY }),
  });
}

/** Which optional fields the Challan form shows. */
export function useChallanFields() {
  return useQuery({
    queryKey: CHALLAN_FIELDS_KEY,
    queryFn: () => http.get<ChallanFieldSettingsDto>('/settings/challan-fields'),
    staleTime: 60_000,
  });
}

export function useUpdateChallanFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChallanFieldSettingsInput) => http.put<ChallanFieldSettingsDto>('/settings/challan-fields', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHALLAN_FIELDS_KEY }),
  });
}

/** Global fallback for the dispatch bag threshold — used when a party has no
 *  threshold of its own set in Special Rates. */
export function useDispatchBagThreshold() {
  return useQuery({
    queryKey: DISPATCH_BAG_THRESHOLD_KEY,
    queryFn: () => http.get<DispatchBagThresholdDto>('/settings/dispatch-bag-threshold'),
    staleTime: 60_000,
  });
}

export function useUpdateDispatchBagThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchBagThresholdInput) => http.put<DispatchBagThresholdDto>('/settings/dispatch-bag-threshold', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: DISPATCH_BAG_THRESHOLD_KEY }),
  });
}

/** Which dispatch events alert the people holding `dispatchalert:notify`. */
export function useDispatchAlerts() {
  return useQuery({
    queryKey: DISPATCH_ALERTS_KEY,
    queryFn: () => http.get<DispatchAlertSettingsDto>('/settings/dispatch-alerts'),
    staleTime: 60_000,
  });
}

export function useUpdateDispatchAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchAlertSettingsInput) =>
      http.put<DispatchAlertSettingsDto>('/settings/dispatch-alerts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: DISPATCH_ALERTS_KEY }),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => http.get<OrderOptionDto[]>('/settings'),
    staleTime: 60_000,
  });
}

/** Convenience: the values for one setting group, in display order. */
export function settingValues(all: OrderOptionDto[] | undefined, group: string): string[] {
  return (all ?? [])
    .filter((o) => o.group === group)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => o.value);
}

export function useCreateOrderOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderOptionInput) => http.post<OrderOptionDto>('/settings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteOrderOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.delete(`/settings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
