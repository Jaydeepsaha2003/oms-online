import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { AuthResult } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

/** Shared axios instance. `withCredentials` sends the httpOnly refresh cookie. */
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Attach the bearer token to every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: concurrent 401s share one refresh call.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post<{ success?: boolean; data?: AuthResult } | AuthResult>(
        `${API_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((res) => {
        const body = res.data as { success?: boolean; data?: AuthResult } | AuthResult;
        const auth = (body as { data?: AuthResult }).data ?? (body as AuthResult);
        if (auth?.accessToken) {
          useAuthStore.getState().setSession(auth);
          return auth.accessToken;
        }
        return null;
      })
      .catch(() => {
        useAuthStore.getState().clear();
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

// Unwrap the `{ success, data }` envelope on success; transparently refresh on 401.
api.interceptors.response.use(
  (response: AxiosResponse) => {
    const body = response.data;
    if (body && typeof body === 'object' && body.success === true && 'data' in body) {
      response.data = body.data;
    }
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` };
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

/** Thin typed helpers — responses are already unwrapped to the payload. */
export const http = {
  get: <T>(url: string, config?: AxiosRequestConfig) => api.get<T>(url, config).then((r) => r.data),
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    api.post<T>(url, body, config).then((r) => r.data),
  patch: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    api.patch<T>(url, body, config).then((r) => r.data),
  put: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    api.put<T>(url, body, config).then((r) => r.data),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    api.delete<T>(url, config).then((r) => r.data),
};

/** Download a binary response (Excel/PDF) from an API endpoint as a file. */
export async function downloadFile(
  url: string,
  fallbackName?: string,
  config?: AxiosRequestConfig,
): Promise<void> {
  const res = await api.get(url, { ...config, responseType: 'blob' });
  const disposition = res.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackName ?? 'download';

  const blobUrl = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

/** Extract a human-readable message from an API error. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
