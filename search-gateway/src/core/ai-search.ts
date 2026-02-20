// AutoRAG REST API 클라이언트
// 요청 형식: search.sh와 동일 (query + filters)
// TASK-0에서 실제 응답 필드명 확인 후 AISearchResult 인터페이스 조정

const AUTORAG_BASE = 'https://api.cloudflare.com/client/v4';

export interface AISearchResult {
  url: string;
  title: string;   // AutoRAG 실제 응답 필드명 TASK-0 확인 필요 (name / title)
  content: string; // AutoRAG 실제 응답 필드명 TASK-0 확인 필요 (content / description / snippet)
  score?: number;
  /** Content owner가 관리하는 ID (Cloudflare AI Search data[].content[0].id) — LLM Ingest content_id 등에 사용 */
  contentId?: string;
}

/** search.sh와 동일한 필터 형식: { type, key, value } */
export interface SearchFilter {
  type: string;
  key: string;
  value: string;
}

interface AutoRAGResponse {
  success: boolean;
  result: {
    data: Array<Record<string, unknown>>;
  };
  errors?: Array<{ message: string }>;
}

export async function searchAutoRAG(
  accountId: string,
  searchApiToken: string,
  autoragName: string,
  query: string,
  filters?: SearchFilter[],
): Promise<AISearchResult[]> {
  const url = `${AUTORAG_BASE}/accounts/${accountId}/autorag/rags/${autoragName}/search`;

  // API는 빈 filters 배열을 거부함. 필터가 있을 때만 { query, filters } 전송, 없으면 { query }만
  const hasFilters = Array.isArray(filters) && filters.length > 0;
  const body = hasFilters ? { query, filters } : { query };

  console.log('[search-gateway] 타 서버 HTTP 요청:', {
    method: 'POST',
    url,
    bodySummary: `query.length=${query.length}, filters.count=${filters?.length ?? 0}`,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${searchApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBodyText = await response.text();

  // F1: response.ok 체크 먼저, 실패 시 JSON 파싱 없이 상태 정보로 throw
  if (!response.ok) {
    throw new Error(`AutoRAG API error: ${response.status} ${response.statusText} - ${responseBodyText.slice(0, 200)}`);
  }

  // 로컬 개발 시 전체 응답 확인용 로그
  console.log('[search-gateway] AI Search 응답 수신:', {
    status: response.status,
    bodyLength: responseBodyText.length,
  });
  console.log('[search-gateway] AI Search 응답 본문:\n' + responseBodyText);

  let json: AutoRAGResponse;
  try {
    json = JSON.parse(responseBodyText) as AutoRAGResponse;
  } catch {
    throw new Error(`AutoRAG API returned non-JSON response (${response.status}): ${responseBodyText.slice(0, 200)}`);
  }

  const dataLen = json.result?.data?.length ?? 0;
  console.log('[search-gateway] 타 서버 응답:', {
    status: response.status,
    success: json.success,
    resultDataLength: dataLen,
  });

  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join(', ') ?? 'Unknown error';
    throw new Error(`AutoRAG API failed: ${msg}`);
  }

  // F5: result 또는 data가 없는 경우 빈 배열 반환 (안전 접근)
  const data = json.result?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  // API 응답: content[{ type, text }] — 인덱싱 시 청크(64~512 토큰) 단위로 저장되므로
  // 긴 JSON/코드 블록은 청크 경계에서 잘려 한 결과에 일부만 올 수 있음 (API 제한, gateway는 가공 없이 전달).
  const results: AISearchResult[] = data.map((item): AISearchResult => {
    const attrs = item['attributes'] as Record<string, unknown> | undefined;
    const file = attrs?.['file'] as Record<string, unknown> | undefined;
    const titleFromFile = file?.['title'] ?? file?.['description'];
    const rawContent = item['content'];
    let contentStr = '';
    let contentId: string | undefined;
    if (Array.isArray(rawContent)) {
      const first = rawContent[0];
      if (first && typeof first === 'object' && 'id' in first) {
        const idVal = (first as { id?: unknown }).id;
        if (typeof idVal === 'string') contentId = idVal;
      }
      contentStr = rawContent
        .map((c) => (c && typeof c === 'object' && 'text' in c ? (c as { text?: string }).text : ''))
        .filter(Boolean)
        .join('\n\n');
    } else if (typeof rawContent === 'string') {
      contentStr = rawContent;
    }
    if (!contentStr && typeof item['description'] === 'string') contentStr = item['description'];
    if (!contentStr && typeof item['snippet'] === 'string') contentStr = item['snippet'];

    return {
      url: String(item['filename'] ?? item['url'] ?? item['source'] ?? ''),
      title: String(titleFromFile ?? item['title'] ?? item['name'] ?? ''),
      content: contentStr,
      score: typeof item['score'] === 'number' ? item['score'] : undefined,
      contentId,
    };
  });

  // [search-gateway] AI Search가 반환한 검색 결과 로그
  console.log('[search-gateway] AI Search 검색 결과 (%d건):', results.length);
  for (const [i, r] of results.entries()) {
    console.log(`  [${i + 1}] url: ${r.url}`);
    console.log(`      title: ${r.title}`);
    console.log(`      score: ${r.score ?? 'N/A'}`);
    console.log(`      content (${r.content?.length ?? 0}자):\n${r.content}`);
  }

  return results;
}
