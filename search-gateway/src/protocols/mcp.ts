import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { searchAutoRAG } from '../core/ai-search';
import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import { getFormatter, type FormatType } from '../formatters/index';

// MCP SDK 기반 MCP Server 구현
// - McpServer: MCP 프로토콜 라이프사이클(initialize → initialized → tools/call) 자동 처리
// - WebStandardStreamableHTTPServerTransport: Cloudflare Workers Web Standard API 호환
// - sessionIdGenerator: undefined → 무상태(stateless) 모드 (Workers 요청 간 상태 유지 불가)
// - 요청마다 McpServer + transport 생성 (Workers stateless 특성상 불가피)

export const mcpHandler = async (c: Context): Promise<Response> => {
  const creds = extractCredentials(c);
  if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 401);

  const { accountId, apiToken, autoragName } = creds;

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
      const results = await searchAutoRAG(accountId, apiToken, autoragName, query);
      const text = getFormatter(format as FormatType).format(results);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
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
