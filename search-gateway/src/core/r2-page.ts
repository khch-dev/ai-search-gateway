import type { R2Bucket } from '@cloudflare/workers-types';
import type { AISearchResult } from './ai-search';

export interface PageContent {
  raw: string;    // R2 원본 콘텐츠
  title: string;  // <title> 추출값 또는 url
  url: string;
}

/**
 * HTML 원문에서 전체 텍스트 추출 (길이 제한 없음).
 * 검색 결과 보강 시 R2 원문을 포맷터에 넘기기 위해 사용.
 */
export function extractFullTextContent(raw: string): string {
  const noScriptStyle = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const withNewlines = noScriptStyle
    .replace(/<\/?(?:p|div|tr|li|h[1-6]|br)\b[^>]*>/gi, '\n');
  const text = withNewlines.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * R2에서 페이지 콘텐츠 조회. https -> http 폴백 포함.
 * 반환: PageContent | null (null = 키 없음 = 404)
 * R2 서비스 오류 시 throw (호출자에서 502 처리)
 */
export async function fetchPage(
  r2: R2Bucket,
  url: string,
): Promise<PageContent | null> {
  try {
    let obj = await r2.get(url);
    if (!obj) {
      obj = await r2.get(url.replace('https://', 'http://'));
    }
    if (!obj) return null;

    // F7/F15: 대용량 오브젝트 OOM 방지 — 5 MB 상한
    const MAX_SIZE_BYTES = 5 * 1024 * 1024;
    if (obj.size > MAX_SIZE_BYTES) {
      throw new Error(`R2 object too large: ${obj.size} bytes (max ${MAX_SIZE_BYTES})`);
    }

    const raw = await obj.text();
    const title =
      raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
    return { raw, title, url };
  } catch (err) {
    console.error('[r2-page] fetchPage 오류:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * HTML에서 텍스트 콘텐츠 추출.
 * 1) <meta name="description"> 우선
 * 2) script/style 제거 후 태그 strip, 500자 truncate
 */
function extractTextContent(raw: string): string {
  const metaDesc =
    raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];
  if (metaDesc) return metaDesc.trim();

  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 500);
}

/** PageContent -> AISearchResult 변환 (markdown/json-ld 포매터용). Crawler 단일 페이지용. */
export function toSearchResult(page: PageContent): AISearchResult {
  return { url: page.url, title: page.title, content: extractTextContent(page.raw) };
}

/**
 * 검색 결과 각 항목의 URL로 R2를 조회해 원문으로 content/title 보강.
 * R2에 없으면 해당 항목은 기존(청크) content 유지.
 * MCP/NLWeb/LLM-Ingest 등 검색 기반 프로토콜에서 공통 사용.
 */
export async function enrichResultsFromR2(
  r2: R2Bucket,
  results: AISearchResult[],
): Promise<AISearchResult[]> {
  for (const r of results) {
    if (!r.url?.trim()) continue;
    try {
      const page = await fetchPage(r2, r.url);
      if (page) {
        r.content = extractFullTextContent(page.raw);
        r.title = page.title;
      }
    } catch {
      // R2 오류 시 해당 항목은 기존 청크 content 유지
    }
  }
  return results;
}

/**
 * R2 전체 목록 최대 1000개 조회 후 무작위 10개 반환.
 * 빈 버킷이면 [] 반환. R2 오류 시 throw.
 */
export async function listPageKeys(r2: R2Bucket): Promise<string[]> {
  try {
    const listed = await r2.list({ limit: 1000 });
    // F3: truncated=true 시 1000개 초과 오브젝트는 무시됨 — 샘플이 편향될 수 있음
    if (listed.truncated) {
      console.warn('[r2-page] listPageKeys: R2 bucket has >1000 objects, sampling from first 1000 only');
    }
    const keys = listed.objects.map((o) => o.key);

    if (keys.length === 0) return [];

    // Fisher-Yates shuffle
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    return keys.slice(0, 10);
  } catch (err) {
    console.error('[r2-page] listPageKeys 오류:', err instanceof Error ? err.message : String(err));
    throw err;
  }
}
