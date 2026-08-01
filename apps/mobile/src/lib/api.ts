import { useAuthStore } from '../stores/auth.store'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

// B147: fetch was called with no signal, so a stalled request never settled.
// Any caller awaiting one hung forever — and onboarding.tsx rendered an empty
// view for exactly as long, which is how a working app came to look dead.
//
// 30s is deliberately generous, not a latency budget: POST /v1/placement/complete
// legitimately took 5.18s on live (it recomputes theta and seeds against the
// whole corpus). This bounds a HANG; it must never abort slow-but-alive work.
const REQUEST_TIMEOUT_MS = 30_000

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private getToken(): string | null {
    return useAuthStore.getState().session?.access_token ?? null
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    attempt = 1,
  ): Promise<T> {
    const token = this.getToken()

    const hasBody = options.body !== undefined
    let res: Response
    // AbortController + setTimeout rather than AbortSignal.timeout(): the
    // latter is not present on every Hermes build this app ships to.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      })
    } catch (networkErr) {
      clearTimeout(timer)
      // A timeout arrives here as an AbortError, and is treated as exactly what
      // it is — a network failure. Callers already handle that; what they could
      // not handle was never being told at all.
      //
      // Transient network failure — retry once for GET requests
      if (attempt === 1 && (!options.method || options.method === 'GET')) {
        await new Promise((r) => setTimeout(r, 800))
        return this.request<T>(path, options, 2)
      }
      throw new ApiError('Network request failed', 'NETWORK_ERROR', 0)
    }

    if (res.status === 204) {
      clearTimeout(timer)
      return undefined as T
    }

    // Read as text first so a non-JSON body gives a useful error message
    // instead of an opaque "JSON Parse error: unexpected character"
    // The timer stays armed across this read so a stalled body is bounded too.
    let text: string
    try {
      text = await res.text()
    } catch {
      clearTimeout(timer)
      throw new ApiError(`Failed to read response (${res.status})`, 'READ_ERROR', res.status)
    }
    clearTimeout(timer)

    // Transient proxy errors (503 "upstream connect error...") — retry GET once
    if (res.status === 503 && attempt === 1 && (!options.method || options.method === 'GET')) {
      await new Promise((r) => setTimeout(r, 800))
      return this.request<T>(path, options, 2)
    }

    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      throw new ApiError(
        `Unexpected response (${res.status}): ${text.slice(0, 120)}`,
        'PARSE_ERROR',
        res.status,
      )
    }

    if (!json.ok) {
      throw new ApiError(json.error ?? 'Unknown error', json.code ?? 'UNKNOWN', res.status)
    }

    return json.data as T
  }

  get<T>(path: string) {
    return this.request<T>(path, { method: 'GET' })
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' })
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const api = new ApiClient(BASE_URL)
