import type { Context } from 'hono';

export interface Credentials {
  accountId: string;
  apiToken: string;
  autoragName: string;
}

/**
 * HTTP 헤더에서 Cloudflare AutoRAG 자격증명을 추출합니다.
 * 헤더가 누락되거나 공백만 포함된 경우 null을 반환합니다.
 */
export function extractCredentials(c: Context): Credentials | null {
  const accountId = c.req.header('X-CF-Account-ID')?.trim();
  const apiToken = c.req.header('X-CF-API-Token')?.trim();
  const autoragName = c.req.header('X-CF-Autorag-Name')?.trim();

  if (!accountId || !apiToken || !autoragName) {
    return null;
  }

  return { accountId, apiToken, autoragName };
}

export const MISSING_CREDENTIALS_ERROR = {
  error: 'Missing or empty required headers: X-CF-Account-ID, X-CF-API-Token, X-CF-Autorag-Name',
} as const;
