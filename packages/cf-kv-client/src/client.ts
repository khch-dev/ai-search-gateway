// Cloudflare KV REST API 클라이언트
// API 문서: https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/values/

const KV_BASE = 'https://api.cloudflare.com/client/v4';

interface KVListResponse {
  result: Array<{ name: string }>;
  success: boolean;
  errors: Array<{ message: string }>;
}

interface KVErrorResponse {
  success: boolean;
  errors: Array<{ message: string }>;
}

async function kvFetch(
  method: string,
  path: string,
  apiToken: string,
  body?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${KV_BASE}${path}`, { method, headers, body });
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
 */
export async function listKeys(
  accountId: string,
  apiToken: string,
  namespaceId: string,
): Promise<string[]> {
  const res = await kvFetch(
    'GET',
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`,
    apiToken,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV LIST failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as KVListResponse;
  if (!json.success) {
    const msg = json.errors.map((e) => e.message).join(', ');
    throw new Error(`KV LIST API error: ${msg}`);
  }
  return json.result.map((item) => item.name);
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
    const json = JSON.parse(text) as KVErrorResponse;
    const msg = json.errors?.map((e) => e.message).join(', ') ?? text;
    throw new Error(`KV DELETE failed (${res.status}): ${msg}`);
  }
}
