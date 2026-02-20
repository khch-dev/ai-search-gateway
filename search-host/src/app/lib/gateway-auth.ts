/**
 * gateway-auth.ts
 * OAuth 2.0 Client Credentials 토큰 취득 및 캐싱 모듈
 *
 * - 모듈 레벨 캐시: CF Pages isolate best-effort (콜드스타트 시 재취득 ~100ms)
 * - in-flight 중복 요청 방지 (concurrent /token 호출 dedup)
 * - 만료 5분 전 선제 갱신
 */

// 모듈 레벨 상태 — isolate 재시작 시 초기화됨
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Unix timestamp (seconds)
let inflightPromise: Promise<string> | null = null;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * /token 엔드포인트에서 새 액세스 토큰을 취득합니다.
 * RFC 6749 §4.4 Client Credentials Grant
 */
async function acquireToken(): Promise<string> {
  const authServerUrl = process.env['AUTH_SERVER_URL'];
  const clientId = process.env['OAUTH_CLIENT_ID'];
  const clientSecret = process.env['OAUTH_CLIENT_SECRET'];

  if (!authServerUrl || !clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000); // 5초 timeout

  let response: Response;
  try {
    response = await fetch(`${authServerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Token acquisition failed: ${response.status}`);
  }

  const data = await response.json() as TokenResponse;

  if (!data.access_token) {
    throw new Error('Invalid token response: missing access_token');
  }

  // 캐시 업데이트
  cachedToken = data.access_token;
  tokenExpiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);

  return data.access_token;
}

/**
 * 유효한 액세스 토큰을 반환합니다.
 * - 캐시 히트: 만료 5분 이상 남은 경우 즉시 반환
 * - 캐시 미스: /token 호출 (in-flight dedup으로 concurrent 요청 방지)
 */
export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const REFRESH_BUFFER_SECONDS = 300; // 5분 선제 갱신

  // 캐시 히트: 5분 이상 남음
  if (cachedToken && now < tokenExpiresAt - REFRESH_BUFFER_SECONDS) {
    return cachedToken;
  }

  // in-flight 중복 방지: 이미 진행 중인 요청 있으면 재사용
  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = acquireToken().finally(() => {
    inflightPromise = null;
  });

  return inflightPromise;
}

/**
 * 캐시된 토큰을 무효화합니다.
 * 게이트웨이에서 401 수신 시 호출하여 재취득을 강제합니다.
 */
export function invalidateToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
