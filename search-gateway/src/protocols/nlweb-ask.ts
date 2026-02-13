import type { Context } from 'hono';
import { searchAutoRAG } from '../core/ai-search';
import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';

// NLWeb 스펙 기반 custom extension 구현
// 공식 NLWeb 스펙: https://github.com/microsoft/NLWeb/blob/main/docs/nlweb-rest-api.md
// 주의: 공식 스펙과 schema_object 구조 등이 다를 수 있음 (custom extension)

interface NLWebRequest {
  query: string;
  mode?: string;
  prev?: unknown[];
  site?: string;
  streaming?: boolean;
  query_id?: string;
}

export const nlwebAskHandler = async (c: Context): Promise<Response> => {
  const creds = extractCredentials(c);
  if (!creds) {
    return c.json(MISSING_CREDENTIALS_ERROR, 401);
  }

  // F14: as 단언 대신 런타임 검증으로 실제 타입 확인
  const rawBody = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // query는 문자열이어야 함
  const rawQuery = rawBody['query'];
  if (typeof rawQuery !== 'string') {
    return c.json({ error: 'query must be a string' }, 400);
  }

  const query = rawQuery.trim();
  if (!query) {
    return c.json({ error: 'query is required and must not be empty' }, 400);
  }

  // 선택적 필드 추출 (타입 안전)
  const body: NLWebRequest = {
    query,
    mode: typeof rawBody['mode'] === 'string' ? rawBody['mode'] : undefined,
    site: typeof rawBody['site'] === 'string' ? rawBody['site'] : undefined,
    streaming: typeof rawBody['streaming'] === 'boolean' ? rawBody['streaming'] : undefined,
    query_id: typeof rawBody['query_id'] === 'string' ? rawBody['query_id'] : undefined,
  };

  const { accountId, apiToken, autoragName } = creds;

  let results;
  try {
    results = await searchAutoRAG(accountId, apiToken, autoragName, query);
  } catch (err) {
    return c.json({ error: `AutoRAG error: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  // streaming 요청이 와도 Workers에서는 SSE 미지원 → 항상 application/json 반환
  const queryId = body.query_id ?? crypto.randomUUID();

  return c.json({
    query_id: queryId,
    results: results.map((r) => ({
      url: r.url,
      name: r.title,
      score: r.score ?? 1.0,
      description: r.content,
      schema_object: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: r.title,
        url: r.url,
        description: r.content,
      },
    })),
  });
};
