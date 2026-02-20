export const runtime = 'edge';

import { getAccessToken, invalidateToken } from '../../lib/gateway-auth';

export async function GET(_request: Request): Promise<Response> {
  const gatewayUrl = process.env['GATEWAY_URL'];
  if (!gatewayUrl) {
    return Response.json({ error: 'Gateway not configured' }, { status: 503 });
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return Response.json({ error: 'Authentication service unavailable' }, { status: 503 });
  }

  const target = `${gatewayUrl}/pages`;

  try {
    let upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 401: 토큰 무효화 후 1회 재시도
    if (upstream.status === 401) {
      invalidateToken();
      let retryToken: string;
      try {
        retryToken = await getAccessToken();
      } catch {
        return Response.json({ error: 'Authentication service unavailable' }, { status: 503 });
      }
      upstream = await fetch(target, { headers: { Authorization: `Bearer ${retryToken}` } });
    }
    const json = await upstream.json() as unknown;
    // F12: 응답 구조 검증 — { keys: string[] } 형식인지 확인
    const keys =
      json !== null &&
      typeof json === 'object' &&
      'keys' in (json as object) &&
      Array.isArray((json as { keys: unknown }).keys)
        ? (json as { keys: string[] }).keys
        : [];
    return Response.json({ keys }, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Gateway request failed: ${msg}` }, { status: 502 });
  }
}
