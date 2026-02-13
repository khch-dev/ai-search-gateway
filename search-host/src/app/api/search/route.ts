import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

type Protocol = 'mcp' | 'nlweb' | 'llm-ingest';

interface SearchRequestBody {
  protocol: Protocol;
  format: 'html' | 'markdown' | 'json-ld';
  query: string;
  accountId: string;
  apiToken: string;
  autoragName: string;
}

function getGatewayPath(protocol: Protocol): string {
  switch (protocol) {
    case 'mcp':
      return '/mcp';
    case 'nlweb':
      return '/nlweb/ask';
    case 'llm-ingest':
      return '/llm-ingest';
  }
}

function maskToken(s: string): string {
  if (!s || s.length < 8) return '***';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as SearchRequestBody | null;

  // [search-host] HTTP 수신 정보
  console.log('[search-host] HTTP 수신:', {
    method: request.method,
    url: request.url,
    bodyKeys: body && typeof body === 'object' ? Object.keys(body) : null,
    queryLength: body?.query?.length ?? 0,
  });

  if (!body) {
    console.log('[search-host] HTTP 응답:', { status: 400, bodySummary: 'Invalid JSON body' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { protocol, format, query, accountId, apiToken, autoragName } = body;

  // 필수 필드 검증
  if (!accountId?.trim() || !apiToken?.trim() || !autoragName?.trim() || !query?.trim()) {
    console.log('[search-host] HTTP 응답:', { status: 400, bodySummary: 'Missing required fields' });
    return NextResponse.json(
      { error: 'Missing required fields: accountId, apiToken, autoragName, query' },
      { status: 400 },
    );
  }

  const gatewayUrl = process.env['GATEWAY_URL'];
  if (!gatewayUrl) {
    console.log('[search-host] HTTP 응답:', { status: 503, bodySummary: 'Gateway not configured' });
    return NextResponse.json({ error: 'Gateway not configured' }, { status: 503 });
  }

  const targetUrl = `${gatewayUrl}${getGatewayPath(protocol)}`;

  // MCP 프로토콜: JSON-RPC 2.0 형식으로 변환
  // StreamableHTTPServerTransport는 application/json Accept 헤더로 일반 JSON 응답 반환
  let gatewayBody: string;
  if (protocol === 'mcp') {
    gatewayBody = JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query, format },
      },
    });
  } else {
    gatewayBody = JSON.stringify({ query, format });
  }

  const requestHeaders: Record<string, string> = {
    'X-CF-Account-ID': accountId.trim(),
    'X-CF-API-Token': apiToken.trim(),
    'X-CF-Autorag-Name': autoragName.trim(),
    'Content-Type': 'application/json',
    // MCP: text/event-stream 없이 application/json만 지정 → transport가 SSE 대신 JSON 응답 반환
    'Accept': 'application/json',
  };

  // [search-host] 타 서버(Gateway) HTTP 요청 정보
  console.log('[search-host] 타 서버 HTTP 요청:', {
    method: 'POST',
    url: targetUrl,
    headers: {
      'X-CF-Account-ID': accountId.trim(),
      'X-CF-API-Token': maskToken(apiToken),
      'X-CF-Autorag-Name': autoragName.trim(),
    },
    bodyLength: gatewayBody.length,
  });

  try {
    const gatewayResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: gatewayBody,
    });

    // F10: 응답이 JSON이 아닐 수 있으므로 text()로 먼저 읽고 파싱 시도
    const responseText = await gatewayResponse.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    // [search-host] 타 서버(Gateway) 응답 정보
    const bodySummary =
      typeof responseData === 'object' && responseData !== null
        ? Array.isArray((responseData as Record<string, unknown>).results)
          ? `results.length=${(responseData as { results?: unknown[] }).results?.length ?? 0}`
          : 'result' in (responseData as object)
            ? 'result'
            : 'content' in (responseData as object)
              ? 'content'
              : Object.keys(responseData as object).join(',')
        : String(responseData).slice(0, 80);
    console.log('[search-host] 타 서버 응답:', {
      status: gatewayResponse.status,
      bodySummary,
    });

    // Gateway 응답 원문을 그대로 화면에 노출하기 위해 payload에 포함
    const payload =
      typeof responseData === 'object' && responseData !== null && !Array.isArray(responseData)
        ? { ...(responseData as object), _rawGatewayPayload: responseText }
        : { _rawGatewayPayload: responseText, _parsed: responseData };
    const res = NextResponse.json(payload, { status: gatewayResponse.status });
    console.log('[search-host] HTTP 응답:', { status: gatewayResponse.status, bodySummary });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[search-host] HTTP 응답:', { status: 502, bodySummary: `error: ${msg}` });
    return NextResponse.json(
      { error: `Gateway request failed: ${msg}` },
      { status: 502 },
    );
  }
}
