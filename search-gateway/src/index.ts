import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { mcpHandler } from './protocols/mcp';
import { nlwebAskHandler } from './protocols/nlweb-ask';
import { llmIngestHandler } from './protocols/llm-ingest';

type Env = {
  SEARCH_HOST_ORIGIN: string;
};

const app = new Hono<{ Bindings: Env }>();

// CORS: search-host 도메인만 허용
app.use('*', async (c, next) => {
  const corsMiddleware = cors({ origin: c.env.SEARCH_HOST_ORIGIN });
  return corsMiddleware(c, next);
});

// Rate limiting: IP당 60 req/min
app.use('*', rateLimitMiddleware);

// 프로토콜 라우팅 (path로 분기)
app.post('/mcp', mcpHandler);
app.post('/nlweb/mcp', mcpHandler); // NLWeb MCP: /mcp와 동일 핸들러 재사용
app.post('/nlweb/ask', nlwebAskHandler);
app.post('/llm-ingest', llmIngestHandler);

// 헬스체크
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
