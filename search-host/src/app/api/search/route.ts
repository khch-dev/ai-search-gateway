import { type NextRequest, NextResponse } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const runtime = 'edge';

type Protocol = 'mcp' | 'nlweb' | 'llm-ingest';

interface SearchRequestBody {
  protocol: Protocol;
  format: 'html' | 'markdown' | 'json-ld';
  query: string;
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

  const { protocol, format, query } = body;

  // F8: protocol, format, query 유효성 검사
  const validProtocols: Protocol[] = ['mcp', 'nlweb', 'llm-ingest'];
  const validFormats = ['html', 'markdown', 'json-ld'] as const;

  if (!protocol || !validProtocols.includes(protocol)) {
    return NextResponse.json({ error: `Invalid protocol. Must be one of: ${validProtocols.join(', ')}` }, { status: 400 });
  }
  if (!format || !(validFormats as readonly string[]).includes(format)) {
    return NextResponse.json({ error: `Invalid format. Must be one of: ${validFormats.join(', ')}` }, { status: 400 });
  }
  if (!query?.trim()) {
    console.log('[search-host] HTTP 응답:', { status: 400, bodySummary: 'Missing required fields' });
    return NextResponse.json(
      { error: 'Missing required field: query' },
      { status: 400 },
    );
  }

  const gatewayUrl = process.env['GATEWAY_URL'];
  if (!gatewayUrl) {
    console.log('[search-host] HTTP 응답:', { status: 503, bodySummary: 'Gateway not configured' });
    return NextResponse.json({ error: 'Gateway not configured' }, { status: 503 });
  }

  const targetUrl = `${gatewayUrl}${getGatewayPath(protocol)}`;

  // MCP 프로토콜: SDK Client를 사용하여 표준 MCP 라이프사이클 수행
  // (initialize → initialized → tools/call 핸드셰이크 자동 처리)
  // 자격증명은 search-gateway가 KV 또는 .dev.vars에서 직접 로드
  if (protocol === 'mcp') {
    console.log('[search-host] 타 서버 HTTP 요청 (MCP SDK):', { url: targetUrl });

    const transport = new StreamableHTTPClientTransport(new URL(targetUrl));

    const client = new Client({ name: 'search-host', version: '0.1.0' });
    try {
      await client.connect(transport); // initialize → initialized 핸드셰이크 자동 처리
      const result = await client.callTool({ name: 'search', arguments: { query, format } });

      // F6 반영: tool handler 내부 에러는 SDK가 isError: true로 반환 (예외 미발생)
      // result.content 타입을 명시적으로 캐스팅 (SDK 반환 타입이 unknown인 경우 대응)
      type ContentItem = { type: string; text?: string };
      const content = (result.content as ContentItem[] | undefined) ?? [];

      if (result.isError) {
        const firstContent = content[0];
        const errMsg = firstContent?.type === 'text' && firstContent.text ? firstContent.text : 'MCP tool 실행 중 오류가 발생했습니다.';
        console.log('[search-host] HTTP 응답 (MCP isError):', { error: errMsg });
        return NextResponse.json({ error: errMsg }, { status: 502 });
      }

      const firstContent = content[0];
      const text = firstContent?.type === 'text' && firstContent.text ? firstContent.text : '';
      console.log('[search-host] HTTP 응답 (MCP):', { textLength: text.length });
      return NextResponse.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[search-host] HTTP 응답 (MCP error):', { status: 502, error: msg });
      return NextResponse.json({ error: msg }, { status: 502 });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  // NLWeb / LLM-Ingest: 기존 fetch proxy 방식 유지
  // 자격증명은 search-gateway가 KV 또는 .dev.vars에서 직접 로드
  const gatewayBody = JSON.stringify({ query, format });
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // [search-host] 타 서버(Gateway) HTTP 요청 정보
  console.log('[search-host] 타 서버 HTTP 요청:', {
    method: 'POST',
    url: targetUrl,
    bodyLength: gatewayBody.length,
  });

  try {
    const gatewayResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: gatewayBody,
    });

    // 응답이 JSON이 아닐 수 있으므로 text()로 먼저 읽고 파싱 시도
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
