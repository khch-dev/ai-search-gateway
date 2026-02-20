import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { jwtAuthMiddleware } from './middleware/jwt-auth';
import { mcpHandler } from './protocols/mcp';
import { nlwebAskHandler } from './protocols/nlweb-ask';
import { llmIngestHandler } from './protocols/llm-ingest';
import { llmIngestInfoHandler } from './protocols/llm-ingest-info';
import { pageHandler, pagesHandler } from './protocols/page-fetch';

export type Env = {
  SEARCH_HOST_ORIGIN: string;
  KV_CREDENTIALS: KVNamespace;
  R2_AI_SEARCH: R2Bucket;
  // Dev 모드: .dev.vars에서 자동으로 읽힘
  CF_ACCOUNT_ID?: string;
  CF_SEARCH_API_TOKEN?: string;
  CF_AUTORAG_NAME?: string;
  // OAuth 2.0 JWT 인증
  JWT_SECRET: string;
  AUTH_SERVER_URL?: string; // wrangler.toml [vars]에 설정; 미설정 시 미들웨어 내 기본값 사용
};

const app = new Hono<{ Bindings: Env }>();

// CORS: search-host 도메인만 허용 + Authorization 헤더 허용
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.SEARCH_HOST_ORIGIN,
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'mcp-protocol-version', 'mcp-session-id'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  });
  return corsMiddleware(c, next);
});

// Rate limiting: IP당 60 req/min
app.use('*', rateLimitMiddleware);

// JWT 인증: Rate Limit 이후, 로깅 이전
app.use('*', jwtAuthMiddleware);

// [search-gateway] HTTP 수신 / 응답 로그
app.use('*', async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  console.log('[search-gateway] HTTP 수신:', { method, path });
  await next();
  console.log('[search-gateway] HTTP 응답:', { status: c.res.status });
});

// 프로토콜 라우팅 (path로 분기)
app.post('/mcp', mcpHandler);
app.post('/nlweb/mcp', mcpHandler); // NLWeb MCP: /mcp와 동일 핸들러 재사용
app.post('/nlweb/ask', nlwebAskHandler);
app.get('/llm-ingest/info', llmIngestInfoHandler);
app.post('/llm-ingest', llmIngestHandler);

// R2 페이지 콘텐츠 조회
app.get('/page', pageHandler);
app.get('/pages', pagesHandler);

// 헬스체크
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
