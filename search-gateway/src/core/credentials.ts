import type { Context } from 'hono';
import type { Env } from '../index';

export interface Credentials {
  accountId: string;
  searchApiToken: string;
  autoragName: string;
}

// F4: 모듈 레벨 캐시 - 동일 Worker 아이솔레이트 내에서 KV 반복 호출 방지
// Cloudflare Workers는 아이솔레이트 재사용 시 모듈 변수가 유지됨 (TTL: 5분)
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedCredentials: Credentials | null = null;
let cacheExpiresAt = 0;

// F5: KV 반환값이 빈 문자열인 경우 undefined로 처리
function nonEmpty(v: string | null | undefined): string | undefined {
  return v?.trim() || undefined;
}

/**
 * 자격증명을 환경변수 또는 KV 바인딩에서 로드합니다.
 * - Dev 모드 (.dev.vars): env.CF_ACCOUNT_ID 등 환경변수 우선
 * - Live 모드 (Cloudflare Worker): KV 바인딩(KV_CREDENTIALS)에서 병렬 읽기
 * - F4: 모듈 레벨 캐시로 KV 호출 최소화 (TTL 5분)
 * 자격증명이 없으면 null 반환.
 */
export async function loadCredentials(c: Context<{ Bindings: Env }>): Promise<Credentials | null> {
  // 환경변수에서 직접 읽기 (dev 모드, 캐시 불필요)
  const envAccountId = nonEmpty(c.env.CF_ACCOUNT_ID);
  const envSearchApiToken = nonEmpty(c.env.CF_SEARCH_API_TOKEN);
  const envAutoragName = nonEmpty(c.env.CF_AUTORAG_NAME);

  if (envAccountId && envSearchApiToken && envAutoragName) {
    console.log('[search-gateway] 자격증명 출처: env (.dev.vars)');
    return { accountId: envAccountId, searchApiToken: envSearchApiToken, autoragName: envAutoragName };
  }

  // F4: 캐시 유효 시 KV 호출 생략
  const now = Date.now();
  if (cachedCredentials && now < cacheExpiresAt) {
    console.log('[search-gateway] 자격증명 출처: KV 캐시');
    return cachedCredentials;
  }

  // F7: Promise.all로 3개 KV 읽기 병렬 처리
  const kv = c.env.KV_CREDENTIALS;
  if (!kv) {
    return null;
  }

  const [kvAccountId, kvSearchApiToken, kvAutoragName] = await Promise.all([
    kv.get('CF_ACCOUNT_ID').then(nonEmpty),
    kv.get('CF_SEARCH_API_TOKEN').then(nonEmpty),
    kv.get('CF_AUTORAG_NAME').then(nonEmpty),
  ]);

  const accountId = envAccountId ?? kvAccountId;
  const searchApiToken = envSearchApiToken ?? kvSearchApiToken;
  const autoragName = envAutoragName ?? kvAutoragName;

  if (!accountId || !searchApiToken || !autoragName) {
    return null;
  }

  const creds: Credentials = { accountId, searchApiToken, autoragName };

  // F4: KV에서 읽은 자격증명 캐시
  cachedCredentials = creds;
  cacheExpiresAt = now + CACHE_TTL_MS;
  console.log('[search-gateway] 자격증명 출처: KV (캐시 갱신)');

  return creds;
}

// F9: 내부 구현 상세(변수명, .dev.vars, KV 구조)를 클라이언트에 노출하지 않음
export const MISSING_CREDENTIALS_ERROR = {
  error: 'Service not configured. Please contact the administrator.',
} as const;
