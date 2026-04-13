import { parseOAuthCallbackUrl } from '../../src/lib/oauth'

describe('parseOAuthCallbackUrl', () => {
  it('extracts access_token and refresh_token from hash fragment', () => {
    const url =
      'kanjilearn://auth/callback#access_token=abc123&refresh_token=def456&token_type=bearer&expires_in=3600'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toEqual({ access_token: 'abc123', refresh_token: 'def456' })
  })

  it('returns null when access_token is missing', () => {
    const url = 'kanjilearn://auth/callback#refresh_token=def456&token_type=bearer'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null when refresh_token is missing', () => {
    const url = 'kanjilearn://auth/callback#access_token=abc123&token_type=bearer'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null for URLs without a hash fragment', () => {
    const url = 'kanjilearn://auth/callback?error=access_denied'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null for error callbacks', () => {
    const url =
      'kanjilearn://auth/callback#error=server_error&error_description=Something+went+wrong'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  // PKCE flow tests (Apple Sign In)
  it('extracts authorization code from query params (PKCE flow)', () => {
    const url = 'kanjilearn://auth/callback?code=pkce_auth_code_123'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toEqual({ code: 'pkce_auth_code_123' })
  })

  it('prefers hash fragment tokens over query param code', () => {
    const url =
      'kanjilearn://auth/callback?code=ignored#access_token=abc123&refresh_token=def456'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toEqual({ access_token: 'abc123', refresh_token: 'def456' })
  })

  it('returns null for query params without a code', () => {
    const url = 'kanjilearn://auth/callback?state=xyz&other=param'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })
})
