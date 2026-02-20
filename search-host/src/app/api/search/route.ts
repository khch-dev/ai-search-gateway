import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import type { GatewayLogEntry } from '../../types/gateway-log';
import { getAccessToken, invalidateToken } from '../../lib/gateway-auth';

/** 로깅: 헤더 크기 제한을 위해 본문 길이 제한 */
const MAX_LOG_BODY_LEN = 800;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function createLogEntry(
  method: string,
  url: string,
  requestBody: string,
  responseStatus: number,
  responseBody: string,
): GatewayLogEntry {
  return {
    id: crypto.randomUUID(),
    method,
    url,
    requestBody: truncate(requestBody, MAX_LOG_BODY_LEN),
    responseStatus,
    responseBody: truncate(responseBody, MAX_LOG_BODY_LEN),
    timestamp: new Date().toISOString(),
  };
}

function addLogEntry(
  log: GatewayLogEntry[],
  method: string,
  url: string,
  requestBody: string,
  responseStatus: number,
  responseBody: string,
): void {
  log.push(createLogEntry(method, url, requestBody, responseStatus, responseBody));
}

function setLogHeader(res: NextResponse, log: GatewayLogEntry[]): void {
  if (log.length > 0) {
    try {
      res.headers.set('X-Search-Log', JSON.stringify(log));
      res.headers.set('Access-Control-Expose-Headers', 'X-Search-Log');
    } catch {
      // 헤더가 너무 크면 무시
    }
  }
}

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

/** MCP 스펙: initialize는 배치에 넣지 않고 단일 요청으로 보냄 (스펙 준수) */
const MCP_PROTOCOL_VERSION = '2025-03-26';

function buildMcpInitializeRequest(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'search-host', version: '0.1.0' },
    },
  };
}

function buildMcpToolsCallRequest(query: string, format: 'html' | 'markdown' | 'json-ld'): unknown {
  return {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'search', arguments: { query, format } },
  };
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
  const wantGatewayLog = request.headers.get('X-Want-Gateway-Log') === 'true';

  // OAuth 2.0 액세스 토큰 취득 (모듈 레벨 캐시, 만료 5분 전 선제 갱신)
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 503 });
  }

  // MCP: 스펙대로 1) initialize 단일 POST → 2) tools/call POST. 로그는 호출별로 스트리밍.
  if (protocol === 'mcp' && wantGatewayLog) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    };

    (async () => {
      try {
        const initBody = JSON.stringify(buildMcpInitializeRequest());
        const initRes = await fetch(targetUrl, { method: 'POST', headers: baseHeaders, body: initBody });
        const initText = await initRes.text();
        const entry1 = createLogEntry('POST', targetUrl, initBody, initRes.status, initText);
        await writer.write(encoder.encode(JSON.stringify({ type: 'log', entry: entry1 }) + '\n'));

        if (!initRes.ok) {
          if (initRes.status === 401) {
            await writer.write(encoder.encode(JSON.stringify({ type: 'error', message: 'Authentication failed' }) + '\n'));
            await writer.close();
            return;
          }
          await writer.write(encoder.encode(JSON.stringify({ type: 'result', body: initText }) + '\n'));
          await writer.close();
          return;
        }
        const initJson = JSON.parse(initText) as { result?: { protocolVersion?: string }; error?: unknown };
        if (initJson.error) {
          await writer.write(encoder.encode(JSON.stringify({ type: 'result', body: initText }) + '\n'));
          await writer.close();
          return;
        }
        const protocolVersion = initJson.result?.protocolVersion ?? MCP_PROTOCOL_VERSION;
        const sessionId = initRes.headers.get('mcp-session-id') ?? undefined;
        const callHeaders = { ...baseHeaders, 'mcp-protocol-version': protocolVersion };
        if (sessionId) callHeaders['mcp-session-id'] = sessionId;

        const callBody = JSON.stringify(buildMcpToolsCallRequest(query, format));
        const callRes = await fetch(targetUrl, { method: 'POST', headers: callHeaders, body: callBody });
        const callText = await callRes.text();
        const entry2 = createLogEntry('POST', targetUrl, callBody, callRes.status, callText);
        await writer.write(encoder.encode(JSON.stringify({ type: 'log', entry: entry2 }) + '\n'));
        if (callRes.status === 401) {
          // 스트리밍 중 401: 재시도 불가, 에러 이벤트 발행
          await writer.write(encoder.encode(JSON.stringify({ type: 'error', message: 'Authentication failed' }) + '\n'));
          return;
        }
        await writer.write(encoder.encode(JSON.stringify({ type: 'result', body: callText }) + '\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writer.write(encoder.encode(JSON.stringify({ type: 'error', message: msg }) + '\n'));
      } finally {
        await writer.close();
      }
    })();

    return new NextResponse(readable, {
      headers: { 'Content-Type': 'application/x-ndjson', 'X-MCP-Stream': 'true' },
    });
  }

  if (protocol === 'mcp') {
    const gatewayLog: GatewayLogEntry[] = [];
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    };
    try {
      const initBody = JSON.stringify(buildMcpInitializeRequest());
      let initRes = await fetch(targetUrl, { method: 'POST', headers: baseHeaders, body: initBody });
      // 401: 토큰 무효화 후 1회 재시도
      if (initRes.status === 401) {
        invalidateToken();
        const retryToken = await getAccessToken();
        baseHeaders['Authorization'] = `Bearer ${retryToken}`;
        initRes = await fetch(targetUrl, { method: 'POST', headers: baseHeaders, body: initBody });
      }
      const initText = await initRes.text();
      addLogEntry(gatewayLog, 'POST', targetUrl, initBody, initRes.status, initText);
      if (!initRes.ok) {
        const res = new NextResponse(initText, {
          status: initRes.status,
          headers: { 'Content-Type': initRes.headers.get('Content-Type') ?? 'application/json' },
        });
        setLogHeader(res, gatewayLog);
        return res;
      }
      const initJson = JSON.parse(initText) as { result?: { protocolVersion?: string }; error?: unknown };
      if (initJson.error) {
        const res = new NextResponse(initText, { status: 400, headers: { 'Content-Type': 'application/json' } });
        setLogHeader(res, gatewayLog);
        return res;
      }
      const protocolVersion = initJson.result?.protocolVersion ?? MCP_PROTOCOL_VERSION;
      const sessionId = initRes.headers.get('mcp-session-id') ?? undefined;
      const callHeaders = { ...baseHeaders, 'mcp-protocol-version': protocolVersion };
      if (sessionId) callHeaders['mcp-session-id'] = sessionId;
      const callBody = JSON.stringify(buildMcpToolsCallRequest(query, format));
      let callRes = await fetch(targetUrl, { method: 'POST', headers: callHeaders, body: callBody });
      // callRes 401: 새 토큰으로 재시도 (initRes retry 이후 세션 토큰이 갱신됐을 수 있으므로)
      if (callRes.status === 401) {
        invalidateToken();
        const retryToken = await getAccessToken();
        callHeaders['Authorization'] = `Bearer ${retryToken}`;
        callRes = await fetch(targetUrl, { method: 'POST', headers: callHeaders, body: callBody });
      }
      const callText = await callRes.text();
      addLogEntry(gatewayLog, 'POST', targetUrl, callBody, callRes.status, callText);
      const res = new NextResponse(callText, {
        status: callRes.status,
        headers: { 'Content-Type': callRes.headers.get('Content-Type') ?? 'application/json' },
      });
      setLogHeader(res, gatewayLog);
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { jsonrpc: '2.0' as const, id: null, error: { code: -32603, message: msg } },
        { status: 502 },
      );
    }
  }

  // NLWeb / LLM-Ingest: 기존 fetch proxy 방식 유지
  const gatewayLog: GatewayLogEntry[] = [];
  const gatewayBody = JSON.stringify({ query, format });
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  console.log('[search-host] 타 서버 HTTP 요청:', { method: 'POST', url: targetUrl, bodyLength: gatewayBody.length });

  try {
    let gatewayResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: gatewayBody,
    });
    // 401: 토큰 무효화 후 1회 재시도
    if (gatewayResponse.status === 401) {
      invalidateToken();
      const retryToken = await getAccessToken();
      requestHeaders['Authorization'] = `Bearer ${retryToken}`;
      gatewayResponse = await fetch(targetUrl, { method: 'POST', headers: requestHeaders, body: gatewayBody });
    }

    const responseText = await gatewayResponse.text();
    addLogEntry(gatewayLog, 'POST', targetUrl, gatewayBody, gatewayResponse.status, responseText);

    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

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
    console.log('[search-host] 타 서버 응답:', { status: gatewayResponse.status, bodySummary });

    const payload =
      typeof responseData === 'object' && responseData !== null && !Array.isArray(responseData)
        ? { ...(responseData as object), _rawGatewayPayload: responseText }
        : { _rawGatewayPayload: responseText, _parsed: responseData };
    const resPayload = wantGatewayLog && gatewayLog.length > 0
      ? { ...payload, _gatewayLog: gatewayLog }
      : payload;
    const res = NextResponse.json(resPayload, { status: gatewayResponse.status });
    if (!wantGatewayLog) setLogHeader(res, gatewayLog);
    console.log('[search-host] HTTP 응답:', { status: gatewayResponse.status, bodySummary });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Failed to fetch/i.test(String(msg))
      ? ' 게이트웨이 URL(GATEWAY_URL)과 게이트웨이 서버 실행 여부를 확인하세요.'
      : '';
    console.error('[search-host] Gateway request failed:', msg);
    return NextResponse.json(
      { error: `게이트웨이에 연결할 수 없습니다.${hint} (원인: ${msg})` },
      { status: 502 },
    );
  }
}
