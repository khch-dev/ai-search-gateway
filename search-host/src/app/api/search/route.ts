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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as SearchRequestBody | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { protocol, format, query, accountId, apiToken, autoragName } = body;

  // 필수 필드 검증
  if (!accountId?.trim() || !apiToken?.trim() || !autoragName?.trim() || !query?.trim()) {
    return NextResponse.json(
      { error: 'Missing required fields: accountId, apiToken, autoragName, query' },
      { status: 400 },
    );
  }

  const gatewayUrl = process.env['GATEWAY_URL'];
  if (!gatewayUrl) {
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
    // F4: MCP StreamableHTTPServerTransport가 SSE 대신 JSON 응답을 보내도록 명시
    'Accept': 'application/json',
  };

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

    return NextResponse.json(responseData, { status: gatewayResponse.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Gateway request failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
