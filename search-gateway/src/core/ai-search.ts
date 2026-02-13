// AutoRAG REST API 클라이언트
// TASK-0에서 실제 응답 필드명 확인 후 AISearchResult 인터페이스 조정

const AUTORAG_BASE = 'https://api.cloudflare.com/client/v4';

export interface AISearchResult {
  url: string;
  title: string;   // AutoRAG 실제 응답 필드명 TASK-0 확인 필요 (name / title)
  content: string; // AutoRAG 실제 응답 필드명 TASK-0 확인 필요 (content / description / snippet)
  score?: number;
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
  apiToken: string,
  autoragName: string,
  query: string,
): Promise<AISearchResult[]> {
  const url = `${AUTORAG_BASE}/accounts/${accountId}/autorag/rags/${autoragName}/search`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`AutoRAG API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as AutoRAGResponse;

  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join(', ') ?? 'Unknown error';
    throw new Error(`AutoRAG API failed: ${msg}`);
  }

  // F5: result 또는 data가 없는 경우 빈 배열 반환 (안전 접근)
  const data = json.result?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  // TASK-0에서 실제 응답 구조 확인 후 필드 매핑 조정
  return data.map((item): AISearchResult => ({
    url: String(item['url'] ?? item['source'] ?? ''),
    title: String(item['title'] ?? item['name'] ?? ''),
    content: String(item['content'] ?? item['description'] ?? item['snippet'] ?? ''),
    score: typeof item['score'] === 'number' ? item['score'] : undefined,
  }));
}
