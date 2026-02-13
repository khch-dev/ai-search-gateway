import type { Context } from 'hono';
import { searchAutoRAG, type SearchFilter } from '../core/ai-search';
import { loadCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import type { Env } from '../index';

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
  filters?: SearchFilter[];
}

function parseFilters(raw: unknown): SearchFilter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SearchFilter[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && 'type' in item && 'key' in item && 'value' in item) {
      const t = (item as Record<string, unknown>).type;
      const k = (item as Record<string, unknown>).key;
      const v = (item as Record<string, unknown>).value;
      if (typeof t === 'string' && typeof k === 'string' && typeof v === 'string') {
        out.push({ type: t, key: k, value: v });
      }
    }
  }
  return out.length ? out : undefined;
}

export const nlwebAskHandler = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const creds = await loadCredentials(c);
  if (!creds) {
    return c.json(MISSING_CREDENTIALS_ERROR, 503);
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

  // 선택적 필드 추출 (타입 안전), filters는 search.sh 형식으로 전달
  const body: NLWebRequest = {
    query,
    mode: typeof rawBody['mode'] === 'string' ? rawBody['mode'] : undefined,
    site: typeof rawBody['site'] === 'string' ? rawBody['site'] : undefined,
    streaming: typeof rawBody['streaming'] === 'boolean' ? rawBody['streaming'] : undefined,
    query_id: typeof rawBody['query_id'] === 'string' ? rawBody['query_id'] : undefined,
    filters: parseFilters(rawBody['filters']),
  };

  const { accountId, searchApiToken, autoragName } = creds;

  let results;
  try {
    results = await searchAutoRAG(accountId, searchApiToken, autoragName, query, body.filters);
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
