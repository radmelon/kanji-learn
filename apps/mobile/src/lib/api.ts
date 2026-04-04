import { useAuthStore } from '../stores/auth.store'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

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
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      })
    } catch (networkErr) {
      // Transient network failure — retry once for GET requests
      if (attempt === 1 && (!options.method || options.method === 'GET')) {
        await new Promise((r) => setTimeout(r, 800))
        return this.request<T>(path, options, 2)
      }
      throw new ApiError('Network request failed', 'NETWORK_ERROR', 0)
    }

    if (res.status === 204) return undefined as T

    // Read as text first so a non-JSON body gives a useful error message
    // instead of an opaque "JSON Parse error: unexpected character"
    let text: string
    try {
      text = await res.text()
    } catch {
      throw new ApiError(`Failed to read response (${res.status})`, 'READ_ERROR', res.status)
    }

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
