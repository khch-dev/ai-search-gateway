import type { Context } from 'hono';
import { searchAutoRAG, type SearchFilter } from '../core/ai-search';
import { loadCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import type { Env } from '../index';
import type { AISearchResult } from '../core/ai-search';

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

// F9: 이중 직렬화 없이 schema_markup을 직접 객체로 구성하는 헬퍼
function buildSchemaMarkup(results: AISearchResult[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: results.length,
    itemListElement: results.map((r, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'WebPage',
        url: r.url,
        name: r.title,
        description: r.content,
      },
    })),
  };
}

// IAB CMP LLM Ingest API 응답 포맷 (스펙 Working Group 단계)
// 스펙 변경 시 이 인터페이스와 핸들러만 수정하면 됨
export interface LLMIngestResponse {
  content: string;
  metadata: {
    title: string;
    content_id: string;
    token_count: number;
  };
  schema_markup: object;
  billing: {
    query_id: string;
    token_count: number;
    estimated_cost: number;
  };
}

export const llmIngestHandler = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const creds = await loadCredentials(c);
  if (!creds) {
    return c.json(MISSING_CREDENTIALS_ERROR, 503);
  }

  // query는 body 또는 쿼리 파라미터 모두 지원, filters는 body에서만 (search.sh 형식)
  let query: string | undefined;
  let filters: SearchFilter[] | undefined;

  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ query?: string; filters?: unknown }>().catch((): { query?: string; filters?: unknown } => ({}));
    query = body.query?.trim();
    filters = parseFilters(body.filters);
  }

  // body에 없으면 쿼리 파라미터에서 시도
  if (!query) {
    query = c.req.query('query')?.trim();
  }

  if (!query) {
    return c.json({ error: 'query is required (body JSON or query param)' }, 400);
  }

  const { accountId, searchApiToken, autoragName } = creds;

  let results;
  try {
    results = await searchAutoRAG(accountId, searchApiToken, autoragName, query, filters);
  } catch (err) {
    return c.json({ error: `AutoRAG error: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  const content = results.map((r) => r.content).join('\n\n');
  const tokenCount = Math.ceil(content.length / 4);

  // F9: JsonLdFormatter 직접 사용 제거 → buildSchemaMarkup으로 직접 객체 구성
  const schemaMarkup = buildSchemaMarkup(results);

  const response: LLMIngestResponse = {
    content,
    metadata: {
      title: results[0]?.title ?? query,
      content_id: crypto.randomUUID(),
      token_count: tokenCount,
    },
    schema_markup: schemaMarkup,
    billing: {
      query_id: crypto.randomUUID(),
      token_count: tokenCount,
      estimated_cost: 0,
    },
  };

  return c.json(response);
};
