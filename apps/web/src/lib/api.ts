import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { AuthResult, DuplicateDispatch, DuplicateMatch, UploadedFileDto } from '@oms/shared';
import { useAuthStore } from '@/stores/auth-store';

// Resolve the API base URL. By default we call the same origin the page was
// opened on (`/api`) and let the Vite dev/preview server proxy it to the Nest
// API — this works on localhost, over HTTPS, and from phones on the LAN
// without mixed-content issues. Set VITE_API_URL to an absolute URL to
// bypass the proxy and hit the API directly.
const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Backoff for a request that never reached the API. The API is ready ~3s after
 * it relaunches, so these five attempts (~14s total) cover a routine restart
 * without the user seeing anything; past that the call fails for real.
 */
const NET_RETRY_DELAYS = [400, 900, 1800, 3500, 7000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Safe to send twice: no server state changes if the first one did land. */
const isRead = (cfg: AxiosRequestConfig) => (cfg.method ?? 'get').toLowerCase() === 'get';

/** A dropped connection or timeout — not a cancelled request, which is ours. */
const isTransient = (e: AxiosError) => e.code !== 'ERR_CANCELED' && e.code !== 'ECONNABORTED' && !e.response;

/**
 * Set by the API-status provider so a failed call can raise the "updating"
 * banner. A plain module-level hook keeps `api.ts` free of React imports and
 * avoids a circular dependency with the provider.
 */
let onUnreachable: (() => void) | null = null;
export const setApiUnreachableHandler = (fn: (() => void) | null) => {
  onUnreachable = fn;
};
const reportApiUnreachable = () => onUnreachable?.();

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

// Single-flight refresh: concurrent 401s share one refresh call. Exported so
// the session bootstrap reuses it instead of racing a second refresh (refresh
// tokens may be single-use, so two parallel calls could kill a valid session).
let refreshing: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
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
      .catch((err) => {
        // Log out only when the server actually rejected the refresh token.
        // A network error/timeout (slow VPN, brief outage) keeps the session;
        // the request that triggered this simply fails and can be retried.
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 401 || status === 403) useAuthStore.getState().clear();
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
    const contentType = response.headers['content-type'] as string | undefined;
    const isJson = contentType?.includes('application/json');
    const body = response.data;
    if (isJson && body && typeof body === 'object' && body.success === true && 'data' in body) {
      response.data = body.data;
    }
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean; _netTries?: number }) | undefined;
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

    // No `response` at all means the request never reached the API — nearly
    // always the few seconds where it is being restarted for a new build (the
    // dev proxy answers ECONNREFUSED). Ride that out instead of surfacing it.
    //
    // READS ONLY. A write may well have been applied before the connection
    // dropped, and replaying it would post a second challan or receipt — so
    // writes fail normally and the user re-submits deliberately.
    if (!error.response && original && isTransient(error) && isRead(original)) {
      const tries = original._netTries ?? 0;
      if (tries < NET_RETRY_DELAYS.length) {
        original._netTries = tries + 1;
        reportApiUnreachable();
        await sleep(NET_RETRY_DELAYS[tries]);
        return api(original);
      }
    }
    if (!error.response && isTransient(error)) reportApiUnreachable();
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

/** Upload a single file (multipart) and get back its stored path + served URL.
 *  `folder` routes it into a destination bucket (e.g. "design-names"); omit for
 *  the default order-line-photos bucket. */
export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
  folder?: string,
): Promise<UploadedFileDto> {
  const body = new FormData();
  body.append('file', file);
  const res = await api.post<{ success?: boolean; data?: UploadedFileDto } | UploadedFileDto>(
    `/files/upload${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`,
    body,
    {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  );
  // The response interceptor already unwraps { success, data }; guard both shapes.
  const data = res.data as { data?: UploadedFileDto } | UploadedFileDto;
  return (data as { data?: UploadedFileDto }).data ?? (data as UploadedFileDto);
}

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

/** The already-saved record a 409 duplicate conflict pointed at, or null when
 *  this error is anything else. Lets a caller offer "open the existing one"
 *  instead of just reporting a failure. */
export function getDuplicateMatch(error: unknown): DuplicateMatch | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response?.data as { error?: string; duplicate?: DuplicateMatch } | undefined;
  return data?.error === 'DUPLICATE_CHALLAN' && data.duplicate ? data.duplicate : null;
}

/** The dispatch a duplicate attempt collided with, or null for any other error. */
export function getDuplicateDispatch(error: unknown): DuplicateDispatch | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response?.data as { error?: string; duplicateDispatch?: DuplicateDispatch } | undefined;
  return data?.error === 'DUPLICATE_DISPATCH' && data.duplicateDispatch ? data.duplicateDispatch : null;
}

/** Extract a human-readable message from an API error. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    // No response at all = the request never completed a round trip: the tunnel
    // is down, the VPN isn't carrying traffic, or the host is unreachable. Axios
    // only offers its own wording here ("timeout of 20000ms exceeded",
    // "Network Error"), which tells a shop user nothing about what to do. Say
    // what actually went wrong and what to check — this is the message people
    // see when sign-in fails away from the shop, so it has to be actionable.
    if (!error.response && error.code !== 'ERR_CANCELED') {
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      return timedOut
        ? 'The server did not respond. Check that your VPN is connected, then try again.'
        : 'Can’t reach the OMS server. Check your Wi-Fi or VPN connection, then try again.';
    }
    const data = error.response?.data as { message?: string; details?: Record<string, string[]> } | undefined;
    // A validation failure puts the useful part in `details` — its top-level
    // message is only ever "Validation failed", which tells the user nothing
    // about WHICH field the server rejected.
    const fieldErrors = data?.details ? Object.values(data.details).flat() : [];
    if (fieldErrors.length) return fieldErrors.join('; ');
    return data?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
