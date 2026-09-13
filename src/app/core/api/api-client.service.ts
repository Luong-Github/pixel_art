import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

/** A failed API call, carrying the stable `code` the backend returns in ProblemDetails. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Not signed in (or the session expired past refresh). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const CSRF_COOKIE = 'ps_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

/**
 * The single door to the backend. The browser holds no tokens: the session lives
 * in HttpOnly cookies the server sets, so every request just needs
 * `credentials: 'include'` plus the CSRF header on mutations.
 *
 * The client knows exactly one address — `environment.apiUrl`. No third-party
 * keys, no project refs, nothing else (BD-4).
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly base = environment.apiUrl.replace(/\/+$/, '');
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** False during SSR and when `apiUrl` hasn't been filled in yet. */
  get isConfigured(): boolean {
    return this.isBrowser && !!this.base;
  }

  /**
   * Absolute URL for a top-level navigation (OAuth redirect). Unlike fetch calls,
   * the browser goes to this address itself, so it can't be a bare path when the
   * API lives on another origin.
   */
  urlFor(path: string): string {
    return `${this.base}${path}`;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.isConfigured) {
      throw new ApiError(0, 'api_not_configured', 'API URL is not configured.');
    }

    const mutating = method !== 'GET';
    if (mutating) await this.ensureCsrfToken();

    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (mutating) {
      const token = readCookie(CSRF_COOKIE);
      if (token) headers[CSRF_HEADER] = token;
    }

    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      // The whole point: cookies travel, tokens never touch JS.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) throw await toApiError(response);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /**
   * The CSRF cookie is issued on any safe request. A mutation fired before the
   * app has made one would be refused, so warm it up first.
   *
   * Note there is deliberately no retry-on-401 here: the server refreshes an
   * expired access token inside the same request, so a 401 that reaches us means
   * the session is genuinely gone — retrying would only hide that.
   */
  private async ensureCsrfToken(): Promise<void> {
    if (readCookie(CSRF_COOKIE)) return;
    await fetch(`${this.base}/livez`, { credentials: 'include' }).catch(() => undefined);
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = await response.json();
    return new ApiError(
      response.status,
      problem?.code ?? 'unknown',
      problem?.detail ?? problem?.title ?? response.statusText,
    );
  } catch {
    return new ApiError(response.status, 'unknown', response.statusText);
  }
}
