import type { Context } from 'hono';
import type { Env } from '../index';

export interface Credentials {
  accountId: string;
  searchApiToken: string;
  autoragName: string;
}

/**
 * 자격증명을 환경변수 또는 KV 바인딩에서 로드합니다.
 * - Dev 모드 (.dev.vars): env.CF_ACCOUNT_ID 등 환경변수 우선
 * - Live 모드 (Cloudflare Worker): KV 바인딩(KV_CREDENTIALS)에서 읽기
 * 자격증명이 없으면 null 반환.
 */
export async function loadCredentials(c: Context<{ Bindings: Env }>): Promise<Credentials | null> {
  const accountId =
    c.env.CF_ACCOUNT_ID?.trim() ||
    (await c.env.KV_CREDENTIALS?.get('CF_ACCOUNT_ID')) ||
    undefined;

  const searchApiToken =
    c.env.CF_SEARCH_API_TOKEN?.trim() ||
    (await c.env.KV_CREDENTIALS?.get('CF_SEARCH_API_TOKEN')) ||
    undefined;

  const autoragName =
    c.env.CF_AUTORAG_NAME?.trim() ||
    (await c.env.KV_CREDENTIALS?.get('CF_AUTORAG_NAME')) ||
    undefined;

  if (!accountId || !searchApiToken || !autoragName) {
    return null;
  }

  return { accountId, searchApiToken, autoragName };
}

export const MISSING_CREDENTIALS_ERROR = {
  error:
    'Credentials not configured. Set CF_ACCOUNT_ID, CF_SEARCH_API_TOKEN, CF_AUTORAG_NAME in .dev.vars (dev) or KV_CREDENTIALS KV (live).',
} as const;
