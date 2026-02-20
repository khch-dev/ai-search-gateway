import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { searchAutoRAG } from '../core/ai-search';
import { loadCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import { enrichResultsFromR2 } from '../core/r2-page';
import { getFormatter, type FormatType } from '../formatters/index';
import type { Env } from '../index';

// MCP Server 동작: JSON-RPC 2.0 (initialize / tools/call). tools/call 결과는
// result: { content: [{ type: 'text', text: string }] } 형태로 반환 (스펙 준수).
// MCP SDK 기반 MCP Server 구현
// - McpServer: MCP 프로토콜 라이프사이클(initialize → initialized → tools/call) 자동 처리
// - WebStandardStreamableHTTPServerTransport: Cloudflare Workers Web Standard API 호환
// - sessionIdGenerator: undefined → 무상태(stateless) 모드 (Workers 요청 간 상태 유지 불가)
// - 요청마다 McpServer + transport 생성 (Workers stateless 특성상 불가피)

export const mcpHandler = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const creds = await loadCredentials(c);
  if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 503);

  const { accountId, searchApiToken, autoragName } = creds;
  const r2 = c.env.R2_AI_SEARCH;

  const server = new McpServer({
    name: 'search-gateway',
    version: '0.1.0',
  });

  server.tool(
    'search',
    'Cloudflare AutoRAG를 사용한 AI 검색',
    {
      query: z.string().min(1).describe('검색어'),
      format: z
        .enum(['html', 'markdown', 'json-ld'])
        .default('json-ld')
        .describe('응답 포맷'),
    },
    async ({ query, format }) => {
      const results = await searchAutoRAG(accountId, searchApiToken, autoragName, query);
      const enriched = await enrichResultsFromR2(r2, results);
      const text = getFormatter(format as FormatType).format(enriched);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true, // MCP 응답을 JSON-RPC 2.0 단일/배치 JSON으로 직접 반환 (다른 도구에서 MCP Server로 사용 가능)
  });

  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);

  if (!response.body) {
    // body 없음 → 즉시 정리
    await transport.close().catch(() => undefined);
    return response;
  }

  // SSE 응답: body를 다 소비한 후에 transport 정리
  // (finally에서 즉시 close하면 SSE stream이 끊겨 클라이언트 타임아웃 발생)
  const { readable, writable } = new TransformStream<Uint8Array>();
  response.body.pipeTo(writable).finally(() => {
    transport.close().catch(() => undefined);
  });

  return new Response(readable, {
    status: response.status,
    headers: response.headers,
  });
};
