import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChallanTermsDto, ChallanTermsInput, CompanyProfileDto, CompanyProfileInput, OrderFooterDto, OrderFooterInput, OrderOptionDto, OrderOptionInput, OrderTermsDto, OrderTermsInput } from '@oms/shared';
import { http } from '@/lib/api';

const KEY = ['settings'] as const;
const COMPANY_KEY = ['company'] as const;
const ORDER_TERMS_KEY = ['order-terms'] as const;
const ORDER_FOOTER_KEY = ['order-footer'] as const;
const CHALLAN_TERMS_KEY = ['challan-terms'] as const;

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
