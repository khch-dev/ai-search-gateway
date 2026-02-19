// Cloudflare KV REST API 클라이언트
// API 문서: https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/values/

const KV_BASE = 'https://api.cloudflare.com/client/v4';

interface KVListResponse {
  result: Array<{ name: string }>;
  result_info?: { cursor?: string; count?: number };
  success: boolean;
  errors: Array<{ message: string }>;
}

interface KVErrorResponse {
  success: boolean;
  errors: Array<{ message: string }>;
}

// F6: body 파라미터 제거 - GET/DELETE 전용, 쓰기 요청은 각 함수에서 직접 fetch 사용
async function kvFetch(
  method: string,
  path: string,
  apiToken: string,
): Promise<Response> {
  return fetch(`${KV_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiToken}` },
  });
}

/**
 * KV에서 키 값을 읽어 반환합니다. 키가 없으면 null 반환.
 */
export async function getValue(
  accountId: string,
  apiToken: string,
  namespaceId: string,
  key: string,
): Promise<string | null> {
  const res = await kvFetch(
    'GET',
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    apiToken,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV GET failed (${res.status}): ${text}`);
  }
  return res.text();
}

/**
 * KV에 키/값을 저장합니다.
 */
export async function putValue(
  accountId: string,
  apiToken: string,
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  // KV values PUT은 multipart/form-data 또는 plain body 사용
  // 단순 텍스트 값은 Content-Type 없이 raw body로 전송
  const res = await fetch(
    `${KV_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
      body: value,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV PUT failed (${res.status}): ${text}`);
  }
}

/**
 * KV 네임스페이스의 모든 키 이름 목록을 반환합니다.
 * F10: cursor 기반 페이지네이션으로 1000개 초과 키도 전체 반환
 */
export async function listKeys(
  accountId: string,
  apiToken: string,
  namespaceId: string,
): Promise<string[]> {
  const allKeys: string[] = [];
  let cursor: string | undefined;

  do {
    const path = cursor
      ? `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?cursor=${encodeURIComponent(cursor)}`
      : `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`;
    const res = await kvFetch('GET', path, apiToken);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KV LIST failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as KVListResponse;
    if (!json.success) {
      const msg = json.errors.map((e) => e.message).join(', ');
      throw new Error(`KV LIST API error: ${msg}`);
    }
    allKeys.push(...json.result.map((item) => item.name));
    cursor = json.result_info?.cursor || undefined;
  } while (cursor);

  return allKeys;
}

/**
 * KV에서 키를 삭제합니다.
 */
export async function deleteValue(
  accountId: string,
  apiToken: string,
  namespaceId: string,
  key: string,
): Promise<void> {
  const res = await kvFetch(
    'DELETE',
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    apiToken,
  );
  if (!res.ok) {
    const text = await res.text();
    // F3: JSON.parse try/catch - 비-JSON 응답(HTML 에러 페이지 등) 대비
    let msg = text;
    try {
      const json = JSON.parse(text) as KVErrorResponse;
      msg = json.errors?.map((e) => e.message).join(', ') ?? text;
    } catch {
      // JSON 파싱 실패 시 원문 사용
    }
    throw new Error(`KV DELETE failed (${res.status}): ${msg}`);
  }
}
