import type { Context } from 'hono';
import { searchAutoRAG } from '../core/ai-search';
import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
import type { AISearchResult } from '../core/ai-search';

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

export const llmIngestHandler = async (c: Context): Promise<Response> => {
  const creds = extractCredentials(c);
  if (!creds) {
    return c.json(MISSING_CREDENTIALS_ERROR, 401);
  }

  // query는 body 또는 쿼리 파라미터 모두 지원
  let query: string | undefined;

  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ query?: string }>().catch(() => ({}));
    query = body.query?.trim();
  }

  // body에 없으면 쿼리 파라미터에서 시도
  if (!query) {
    query = c.req.query('query')?.trim();
  }

  if (!query) {
    return c.json({ error: 'query is required (body JSON or query param)' }, 400);
  }

  const { accountId, apiToken, autoragName } = creds;

  let results;
  try {
    results = await searchAutoRAG(accountId, apiToken, autoragName, query);
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
