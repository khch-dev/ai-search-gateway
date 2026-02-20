import type { Context } from 'hono';
import type { Env } from '../index';

/**
 * LLM Ingest 스펙 4개 엔드포인트:
 * 1. Info Endpoint — 서비스·가격 정보 (현재 지원, 단가 0)
 * 2. Query Endpoint — 검색/조회 (현재 지원, POST /llm-ingest)
 * 3. Bidding Endpoint — 추후 지원
 * 4. Logging Endpoint — 추후 지원
 */

export interface LLMIngestInfoResponse {
  version: string;
  endpoints: {
    info: string;
    query: string;
    bidding: string | null;
    logging: string | null;
  };
  pricing: {
    unit_price: number;
    currency: string;
  };
}

export const llmIngestInfoHandler = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const basePath = '/llm-ingest';
  const response: LLMIngestInfoResponse = {
    version: '1.0',
    endpoints: {
      info: `${basePath}/info`,
      query: basePath,
      bidding: null,
      logging: null,
    },
    pricing: {
      unit_price: 0,
      currency: 'USD',
    },
  };

  return c.json(response);
};
