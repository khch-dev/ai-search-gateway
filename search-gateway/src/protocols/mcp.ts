import type { Context } from 'hono';
import { searchAutoRAG } from '../core/ai-search';
import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import { getFormatter, type FormatType } from '../formatters/index';

// MCP SDK의 WebStandardStreamableHTTPServerTransport는 Accept 헤더에 따라 SSE/JSON을 선택함.
// application/json만 요청해도 내부 구현에 따라 text/event-stream을 반환하는 경우가 있어
// JSON-RPC 2.0 직접 구현으로 교체 → 항상 application/json 반환, SSE 미사용

export const mcpHandler = async (c: Context): Promise<Response> => {
  const creds = extractCredentials(c);
  if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 401);

  const body = await c.req.json<{
    jsonrpc: string;
    id: unknown;
    method: string;
    params?: { name?: string; arguments?: { query?: string; format?: string } };
  }>().catch(() => null);

  if (!body) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  if (body.method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        tools: [{
          name: 'search',
          description: 'Cloudflare AutoRAG를 사용한 AI 검색',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '검색어' },
              format: { type: 'string', enum: ['html', 'markdown', 'json-ld'], description: '응답 포맷' },
            },
            required: ['query'],
          },
        }],
      },
    });
  }

  if (body.method === 'tools/call' && body.params?.name === 'search') {
    const { query = '', format = 'json-ld' } = body.params.arguments ?? {};
    if (!query.trim()) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'query is required' } });
    }
    try {
      const results = await searchAutoRAG(creds.accountId, creds.apiToken, creds.autoragName, query);
      const text = getFormatter(format as FormatType).format(results);
      return c.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return c.json({
    jsonrpc: '2.0',
    id: body.id ?? null,
    error: { code: -32601, message: 'Method not found' },
  });
};
