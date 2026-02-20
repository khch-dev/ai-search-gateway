export const runtime = 'edge';

import { getAccessToken, invalidateToken } from '../../lib/gateway-auth';

export async function GET(request: Request): Promise<Response> {
  const gatewayUrl = process.env['GATEWAY_URL'];
  if (!gatewayUrl) {
    return Response.json({ error: 'Gateway not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const format = searchParams.get('format') ?? 'html';

  if (!url) {
    return Response.json({ error: 'url parameter is required' }, { status: 400 });
  }

  // url: searchParams.get()이 디코딩 -> encodeURIComponent로 재인코딩 (1회)
  // format: json-ld 등 안전 문자이나 방어적 인코딩
  const target = `${gatewayUrl}/page?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}`;

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return Response.json({ error: 'Authentication service unavailable' }, { status: 503 });
  }

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
    const text = await upstream.text();
    // F5: text/html을 브라우저에 직접 노출하지 않도록 Content-Type 안전화
    // json-ld는 application/json 유지, 그 외는 text/plain으로 강제
    const upstreamType = upstream.headers.get('Content-Type') ?? '';
    const safeContentType = upstreamType.includes('application/json')
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': safeContentType },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Failed to fetch/i.test(String(msg))
      ? ' 게이트웨이 URL(GATEWAY_URL)과 게이트웨이 서버 실행 여부를 확인하세요.'
      : '';
    return Response.json(
      { error: `게이트웨이에 연결할 수 없습니다.${hint} (원인: ${msg})` },
      { status: 502 },
    );
  }
}
