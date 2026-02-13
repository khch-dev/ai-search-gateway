import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { searchAutoRAG } from '../core/ai-search';
import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import { getFormatter, type FormatType } from '../formatters/index';

// TASK-0 검증 결과에 따라 이 파일을 수정:
// - MCP SDK 호환 → 현재 코드 유지
// - MCP SDK 미호환 → 하단 Fallback 주석 해제 후 이 핸들러 대체

export const mcpHandler = async (c: Context): Promise<Response> => {
  const creds = extractCredentials(c);
  if (!creds) {
    return c.json(MISSING_CREDENTIALS_ERROR, 401);
  }

  const { accountId, apiToken, autoragName } = creds;

  // F8: 요청마다 McpServer + transport를 생성하는 것은 Cloudflare Workers의
  // stateless 특성상 불가피함. transport.close()로 리소스 정리.
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
      const formatted = getFormatter(format as FormatType).format(results);
      return {
        content: [{ type: 'text' as const, text: formatted }],
      };
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    return response;
  } finally {
    // F8: 요청 처리 후 transport 정리 (리소스 누수 방지)
    await transport.close().catch(() => undefined);
  }
};

// ── Fallback: JSON-RPC 2.0 직접 구현 (MCP SDK Workers 미호환 시) ──────────────
// TASK-0에서 SDK 미호환 확인 시, 위 mcpHandler를 아래 함수로 교체:
//
// export const mcpHandler = async (c: Context): Promise<Response> => {
//   const creds = extractCredentials(c);
//   if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 401);
//
//   const body = await c.req.json<{
//     jsonrpc: string;
//     id: unknown;
//     method: string;
//     params?: { name?: string; arguments?: { query?: string; format?: string } };
//   }>().catch(() => null);
//   if (!body) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
//
//   if (body.method === 'tools/list') {
//     return c.json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search', description: 'AI Search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, format: { type: 'string', enum: ['html','markdown','json-ld'] } }, required: ['query'] } }] } });
//   }
//   if (body.method === 'tools/call' && body.params?.name === 'search') {
//     const { query = '', format = 'json-ld' } = body.params.arguments ?? {};
//     if (!query.trim()) return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'query is required' } });
//     const results = await searchAutoRAG(creds.accountId, creds.apiToken, creds.autoragName, query);
//     const text = getFormatter(format as FormatType).format(results);
//     return c.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } });
//   }
//   return c.json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'Method not found' } });
// };
