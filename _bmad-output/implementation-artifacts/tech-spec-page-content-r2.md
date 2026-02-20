---
title: 'Page Content Retrieval via R2'
slug: 'page-content-r2'
created: '2026-02-13'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript (strict, ES2022, Bundler moduleResolution)'
  - 'Hono (search-gateway, Cloudflare Workers)'
  - 'Next.js App Router (search-host, Cloudflare Pages, edge runtime)'
  - 'Cloudflare R2 Binding (Workers native, no credentials needed)'
  - 'React useState/useEffect/useRef (search-host client components)'
files_to_modify:
  - 'search-gateway/wrangler.toml'
  - 'search-gateway/src/index.ts'
  - 'search-host/src/app/components/SearchForm.tsx'
  - 'search-host/src/app/page.tsx'
files_to_create:
  - 'search-gateway/src/core/r2-page.ts'
  - 'search-gateway/src/protocols/page-fetch.ts'
  - 'search-host/src/app/api/page/route.ts'
  - 'search-host/src/app/api/pages/route.ts'
code_patterns:
  - 'Hono Context<{Bindings:Env}> handler pattern (llm-ingest.ts 참고)'
  - 'R2Bucket.get(key)/list() binding API'
  - 'SearchForm isNLWeb conditional rendering -> isCrawler 동일 패턴'
  - 'page.tsx handleSearch protocol 분기 (if/else if/else 체인)'
test_patterns: []
---

# Tech-Spec: Page Content Retrieval via R2

**Created:** 2026-02-13

## Overview

### Problem Statement

Cloudflare AI Search는 웹사이트를 자동 크롤하여 색인을 생성하고 `/search` 엔드포인트를 통해 청크(chunk) 단위의 검색 결과를 반환한다. 그러나 CoMP(Content Management Protocol)를 위해서는 특정 URL의 페이지 전체 콘텐츠를 HTML, Markdown, JSON-LD 형식으로 반환하는 기능이 필요하다. Cloudflare AI Search REST API는 URL 기반 직접 페이지 조회 기능을 제공하지 않는다.

### Solution

`search-gateway` (Cloudflare Worker)에 두 개의 엔드포인트를 추가한다:
- `GET /pages` — R2 오브젝트 키 목록 반환 (무작위 10개 샘플)
- `GET /page?url=<encoded-url>&format=html|markdown|json-ld` — 특정 페이지 콘텐츠 반환

R2 Binding으로 AI Search가 크롤하여 저장한 콘텐츠를 조회한다. **`html` 포맷은 raw R2 콘텐츠를 직접 반환**, `markdown`과 `json-ld`는 기존 포매터 재사용. `search-host` 홈페이지의 **기존 SearchForm에 "Crawler" 프로토콜을 추가**하여 UI를 통합한다: Crawler 선택 시 검색 텍스트 입력창 대신 R2 파일 목록 콤보박스를 표시하고, Crawler 최초 선택 시 목록을 lazy load한다.

### Scope

**In Scope:**
- `search-gateway/wrangler.toml`: R2 bucket binding 추가
- `search-gateway/src/index.ts`: Env 타입에 `R2_AI_SEARCH: R2Bucket` 추가, `GET /page` + `GET /pages` 라우트 등록
- `search-gateway/src/core/r2-page.ts`: R2 오브젝트 조회 + 목록 로직 (신규)
- `search-gateway/src/protocols/page-fetch.ts`: `/page` + `/pages` 핸들러 (신규)
- `search-host/src/app/api/page/route.ts`: `/page` gateway proxy API route (신규)
- `search-host/src/app/api/pages/route.ts`: `/pages` 목록 proxy API route (신규)
- `search-host/src/app/components/SearchForm.tsx`: "Crawler" 프로토콜 추가, 조건부 콤보박스 UI, Crawler 최초 선택 시 lazy load
- `search-host/src/app/page.tsx`: handleSearch에 Crawler 분기 early return 추가

**Out of Scope:**
- HTML -> Markdown 완전 변환 라이브러리 (기존 포매터 패턴 재사용)
- R2 콘텐츠 캐싱
- `/page`, `/pages` 엔드포인트 인증/접근제어
- R2 파일 목록 무한 스크롤/검색 필터링
- R2 Class A 연산 비용 최적화 (rate limiting 고도화)

## Context for Development

### Codebase Patterns

**search-gateway 패턴 (코드 조사 확인):**
- **Hono 핸들러**: `export const handler = async (c: Context<{ Bindings: Env }>): Promise<Response>` — `import type { Env } from '../index'` 패턴은 `llm-ingest.ts:4`에서 확인됨, 순환 참조 아님 (TypeScript 타입 전용 import, 번들러 정상 처리)
- **포매터**: `getFormatter(format as FormatType).format(results)` — `AISearchResult = { url: string, title: string, content: string, score?: number }`. **단, `html` 포맷은 `HtmlFormatter`가 `escapeHtml(content)`를 호출(`html.ts:15`)하므로 raw HTML에 사용 불가. html 포맷은 raw 콘텐츠 직접 반환.**
- **R2 Binding**: `c.env.R2_AI_SEARCH.get(key)` -> `R2ObjectBody | null`. `.text()` 로 내용 읽기. `.list({ limit })` -> `{ objects: R2Object[], truncated: boolean }`
- **에러 응답**: `c.json({ error: '...' }, 400|404|502|503)` 패턴 일관
- **try/catch 패턴**: 외부 API 호출(R2 포함) 모두 try/catch로 감싸고 502/503 반환

**search-host 패턴 (코드 조사 확인):**
- **Protocol 타입** (`SearchForm.tsx:5`): `type Protocol = 'mcp' | 'nlweb' | 'llm-ingest'` — `| 'crawler'` 추가. `search/route.ts:7`의 Protocol 타입은 Crawler와 무관 (Crawler는 POST /api/search 미경유)
- **SearchParams** (`SearchForm.tsx:8`): `{ protocol, format, query }` — Crawler는 `query`에 선택된 R2 키(URL) 담아 전달. 인터페이스 변경 없음.
- **isNLWeb 조건부 렌더링 패턴** (`SearchForm.tsx:36`): `const isNLWeb = protocol === 'nlweb'` -> `const isCrawler = protocol === 'crawler'` 동일 패턴
- **검색창 위치** (`SearchForm.tsx:80-92`): `<div className="search-input-group">` — Crawler 시 조건부 대체
- **R2 목록 lazy load**: Crawler 최초 선택 시 1회만 fetch. `useEffect([protocol])` + `useRef(false)` 패턴. `r2KeysLoading` 초기값 `true` (빈배열 flash 방지)
- **handleSearch 구조** (`page.tsx:27-101`): Crawler를 `/api/search` fetch 호출 **이전**에 early return으로 처리. 나머지 프로토콜은 기존 코드 유지.
- **API route 패턴** (`search/route.ts:5`): `export const runtime = 'edge'` + `process.env['GATEWAY_URL']`
- **응답 처리**: Crawler html/markdown은 `.text()` -> `setResultData(text)`, json-ld는 `JSON.parse(text)` -> `setResultData(parsed)` 후 기존 `SearchResults` 표시

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `search-gateway/src/index.ts` | Env 타입, 라우트 등록 위치 |
| `search-gateway/src/formatters/index.ts` | `getFormatter`, `FormatType`, `IFormatter` |
| `search-gateway/src/formatters/html.ts` | HtmlFormatter — `escapeHtml(content)` 확인됨, **html 포맷 미사용** |
| `search-gateway/src/formatters/markdown.ts` | MarkdownFormatter — `format(results)` -> Markdown string |
| `search-gateway/src/formatters/jsonld.ts` | JsonLdFormatter — `format(results)` -> JSON-LD string |
| `search-gateway/src/core/ai-search.ts` | `AISearchResult` 인터페이스 정의 위치 |
| `search-gateway/src/protocols/llm-ingest.ts` | 핸들러 구조 참고 (`import type { Env } from '../index'` 패턴 확인) |
| `search-gateway/wrangler.toml` | R2 binding 추가 위치 |
| `search-host/src/app/api/search/route.ts` | proxy API 패턴 참고, try/catch, GATEWAY_URL 사용법 |
| `search-host/src/app/components/SearchForm.tsx` | **수정 대상** |
| `search-host/src/app/page.tsx` | **수정 대상** — handleSearch 전체 구조 확인 후 Crawler early return 추가 |

### Technical Decisions

- **R2 Binding**: `wrangler.toml`에 `[[r2_buckets]] binding = "R2_AI_SEARCH" bucket_name = "ai-search-crimson-shadow-a101-14fadc"`. `Env` 타입에 `R2_AI_SEARCH: R2Bucket` 추가.
- **R2 오브젝트 키 = URL 그대로**: AI Search 크롤 시 URL을 키로 사용. 코드에서는 `r2.get(url)` 직접 호출.
- **R2 키 폴백 전략**: `r2.get(url)` -> null이면 `r2.get(url.replace('https://', 'http://'))` 폴백. 여전히 null이면 404.
- **html 포맷 raw 반환**: `HtmlFormatter`는 `escapeHtml(content)`로 raw HTML을 이스케이프하므로 Crawler html 포맷에 사용 불가. `html` 포맷 시 `content`를 `text/html; charset=utf-8`로 직접 반환.
- **markdown/json-ld 포맷**: 기존 `MarkdownFormatter`, `JsonLdFormatter` 재사용. R2 콘텐츠를 `AISearchResult { url, title, content }`로 래핑 후 `getFormatter(format).format([result])` 호출.
- **타이틀 추출**: `content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url`
- **Crawler에서 query = R2 키(URL)**: `SearchParams.query` 필드 재사용. 인터페이스 변경 없음.
- **R2 목록 lazy load**: `useRef(false)` + `useEffect([protocol])`로 Crawler 최초 선택 시 1회만 fetch. 페이지 마운트 시 불필요한 R2 list 연산 방지.
- **r2KeysLoading 초기값 true**: Crawler 선택 직후 `r2Keys=[]` 상태에서 "목록 로드 실패" flash 방지.
- **R2 목록 limit**: `r2.list({ limit: 1000 })` 전체 조회 후 무작위 10개. 1000개 초과 시 나머지 무시 (크롤 사이트 규모 상한 가정).
- **콤보박스 표시 텍스트**: R2 키(URL)를 전체 URL 그대로 표시.
- **Crawler format 선택**: html | markdown | json-ld 모두 유지. 포맷 UI는 Crawler 선택 시에도 활성화.
- **Crawler early return**: `handleSearch`에서 `protocol === 'crawler'` 시 `/api/search` fetch 이전에 early return. 나머지 코드 미실행.
- **format 파라미터 인코딩**: `/api/page/route.ts` 프록시에서 `url`, `format` 모두 `encodeURIComponent` 처리.

## Implementation Plan

### Tasks

- [x] TASK-1: `search-gateway/wrangler.toml` R2 바인딩 추가
  - File: `search-gateway/wrangler.toml`
  - Action: 파일 하단 `[[kv_namespaces]]` 블록 이후에 추가:
    ```toml
    [[r2_buckets]]
    binding = "R2_AI_SEARCH"
    bucket_name = "ai-search-crimson-shadow-a101-14fadc"
    ```
  - Notes: `preview_bucket_name` 불필요. R2 Binding은 `wrangler dev`에서 원격 R2에 자동 연결.

- [x] TASK-2: `search-gateway/src/index.ts` Env 타입 + 라우트 추가
  - File: `search-gateway/src/index.ts`
  - Action:
    1. `Env` 인터페이스에 `R2_AI_SEARCH: R2Bucket` 필드 추가
    2. import 추가: `import { pageHandler, pagesHandler } from './protocols/page-fetch';`
    3. 라우트 등록: `app.get('/page', pageHandler)` + `app.get('/pages', pagesHandler)`
  - Notes: 기존 `app.post('/search', ...)` 패턴 동일. `import type { Env } from '../index'` 순환 참조 아님 — llm-ingest.ts:4에서 동일 패턴 사용 중, 정상 컴파일.

- [x] TASK-3: `search-gateway/src/core/r2-page.ts` 신규 생성
  - File: `search-gateway/src/core/r2-page.ts` (신규)
  - Action: 아래 전체 내용으로 생성:
    ```typescript
    import type { R2Bucket } from '@cloudflare/workers-types';
    import type { AISearchResult } from './ai-search';

    export interface PageContent {
      raw: string;    // R2 원본 콘텐츠
      title: string;  // <title> 추출값 또는 url
      url: string;
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

        const raw = await obj.text();
        const title =
          raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
        return { raw, title, url };
      } catch (err) {
        console.error('[r2-page] fetchPage 오류:', err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    /** PageContent -> AISearchResult 변환 (markdown/json-ld 포매터용) */
    export function toSearchResult(page: PageContent): AISearchResult {
      return { url: page.url, title: page.title, content: page.raw };
    }

    /**
     * R2 전체 목록 최대 1000개 조회 후 무작위 10개 반환.
     * 빈 버킷이면 [] 반환. R2 오류 시 throw.
     */
    export async function listPageKeys(r2: R2Bucket): Promise<string[]> {
      try {
        const listed = await r2.list({ limit: 1000 });
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
    ```
  - Notes: `AISearchResult` 타입은 `search-gateway/src/core/ai-search.ts`에서 import. tuple destructuring 시 non-null assertion(`!`) 필요 (strict TypeScript).

- [x] TASK-4: `search-gateway/src/protocols/page-fetch.ts` 신규 생성
  - File: `search-gateway/src/protocols/page-fetch.ts` (신규)
  - Action: 아래 전체 내용으로 생성:
    ```typescript
    import type { Context } from 'hono';
    import type { Env } from '../index';
    import { fetchPage, listPageKeys, toSearchResult } from '../core/r2-page';
    import { getFormatter } from '../formatters';
    import type { FormatType } from '../formatters';

    const VALID_FORMATS: FormatType[] = ['html', 'markdown', 'json-ld'];

    export const pageHandler = async (
      c: Context<{ Bindings: Env }>,
    ): Promise<Response> => {
      const url = c.req.query('url');
      const format = (c.req.query('format') ?? 'html') as FormatType;

      if (!url) {
        return c.json({ error: 'url parameter is required' }, 400);
      }
      if (!VALID_FORMATS.includes(format)) {
        return c.json(
          { error: `Invalid format: ${format}. Must be one of: ${VALID_FORMATS.join(', ')}` },
          400,
        );
      }

      try {
        const page = await fetchPage(c.env.R2_AI_SEARCH, url);
        if (!page) {
          return c.json({ error: `Page not found: ${url}` }, 404);
        }

        // html 포맷: HtmlFormatter는 escapeHtml(content) 호출 -> raw HTML 불가.
        // raw 콘텐츠를 text/html로 직접 반환.
        if (format === 'html') {
          return new Response(page.raw, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        // markdown / json-ld: 기존 포매터 재사용
        const formatted = getFormatter(format).format([toSearchResult(page)]);
        return new Response(formatted, {
          headers: {
            'Content-Type':
              format === 'json-ld'
                ? 'application/json; charset=utf-8'
                : 'text/plain; charset=utf-8',
          },
        });
      } catch {
        return c.json({ error: 'R2 service error' }, 502);
      }
    };

    export const pagesHandler = async (
      c: Context<{ Bindings: Env }>,
    ): Promise<Response> => {
      try {
        const keys = await listPageKeys(c.env.R2_AI_SEARCH);
        return c.json({ keys });
      } catch {
        return c.json({ error: 'R2 service error' }, 502);
      }
    };
    ```
  - Notes: `import type { Env } from '../index'` — llm-ingest.ts:4 동일 패턴, 정상 컴파일. `catch { }` 문법은 TypeScript 4.0+ 지원.

- [x] TASK-5: `search-host/src/app/api/page/route.ts` 신규 생성
  - File: `search-host/src/app/api/page/route.ts` (신규, `page/` 디렉터리도 신규)
  - Action: 아래 전체 내용으로 생성:
    ```typescript
    export const runtime = 'edge';

    export async function GET(request: Request): Promise<Response> {
      const gatewayUrl = process.env['GATEWAY_URL'];
      if (!gatewayUrl) {
        return Response.json({ error: 'Gateway not configured' }, { status: 503 });
      }

      const { searchParams } = new URL(request.url);
      const url = searchParams.get('url');
      const format = searchParams.get('format') ?? 'html';

      if (!url) {
        return Response.json({ error: 'url parameter is required' }, { status: 400 });
      }

      // url: searchParams.get()이 디코딩 -> encodeURIComponent로 재인코딩 (1회)
      // format: json-ld 등 안전 문자이나 방어적 인코딩
      const target = `${gatewayUrl}/page?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}`;

      try {
        const upstream = await fetch(target);
        const text = await upstream.text();
        return new Response(text, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: `Gateway request failed: ${msg}` }, { status: 502 });
      }
    }
    ```

- [x] TASK-6: `search-host/src/app/api/pages/route.ts` 신규 생성
  - File: `search-host/src/app/api/pages/route.ts` (신규, `pages/` 디렉터리도 신규)
  - Action: 아래 전체 내용으로 생성:
    ```typescript
    export const runtime = 'edge';

    export async function GET(): Promise<Response> {
      const gatewayUrl = process.env['GATEWAY_URL'];
      if (!gatewayUrl) {
        return Response.json({ error: 'Gateway not configured' }, { status: 503 });
      }

      try {
        const upstream = await fetch(`${gatewayUrl}/pages`);
        const json = await upstream.json() as { keys: string[] };
        return Response.json(json, { status: upstream.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: `Gateway request failed: ${msg}` }, { status: 502 });
      }
    }
    ```

- [x] TASK-7: `search-host/src/app/components/SearchForm.tsx` 수정
  - File: `search-host/src/app/components/SearchForm.tsx`
  - Action:

    **변경 1** — Line 3, `useRef` import 추가:
    ```typescript
    // 변경 전
    import { useEffect, useState } from 'react';
    // 변경 후
    import { useEffect, useRef, useState } from 'react';
    ```

    **변경 2** — Line 5, `Protocol` 타입에 `'crawler'` 추가:
    ```typescript
    // 변경 전
    export type Protocol = 'mcp' | 'nlweb' | 'llm-ingest';
    // 변경 후
    export type Protocol = 'mcp' | 'nlweb' | 'llm-ingest' | 'crawler';
    ```

    **변경 3** — SearchForm 함수 내부, 기존 `const [query, setQuery] = useState('')` 선언 이후에 추가:
    ```typescript
    const [r2Keys, setR2Keys] = useState<string[]>([]);
    // true로 초기화: Crawler 선택 직후 r2Keys=[] 상태에서 "목록 로드 실패" flash 방지
    const [r2KeysLoading, setR2KeysLoading] = useState(true);
    const r2FetchedRef = useRef(false);

    // Crawler 최초 선택 시에만 R2 키 목록 fetch (lazy load)
    useEffect(() => {
      if (protocol !== 'crawler' || r2FetchedRef.current) return;
      r2FetchedRef.current = true;
      setR2KeysLoading(true);
      fetch('/api/pages')
        .then((res) => res.json() as Promise<{ keys: string[] }>)
        .then((data) => { setR2Keys(data.keys ?? []); })
        .catch(() => { setR2Keys([]); })
        .finally(() => { setR2KeysLoading(false); });
    }, [protocol]);
    ```

    **변경 4** — Line 36, `isNLWeb` 선언 아래에 추가:
    ```typescript
    const isCrawler = protocol === 'crawler';
    ```

    **변경 5** — Line 49, `<option>` 목록에 Crawler 추가:
    ```tsx
    <option value="crawler">Crawler (R2 Page Content)</option>
    ```

    **변경 6** — Lines 80-92, `<div className="search-input-group">` 블록 전체를 교체:
    ```tsx
    {isCrawler ? (
      <div className="search-input-group">
        <select
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
          disabled={r2KeysLoading}
        >
          <option value="">
            {r2KeysLoading
              ? '목록 로딩 중...'
              : r2Keys.length === 0
              ? '목록 로드 실패'
              : '페이지를 선택하세요...'}
          </option>
          {r2Keys.map((key) => (
            <option key={key} value={key} title={key}>
              {key}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading || !query} className="search-button">
          {loading ? '로딩 중...' : '조회'}
        </button>
      </div>
    ) : (
      <div className="search-input-group">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색어를 입력하세요..."
          required
          className="search-input"
        />
        <button type="submit" disabled={loading} className="search-button">
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>
    )}
    ```
  - Notes: Crawler 포맷 선택은 html/markdown/json-ld 모두 활성화 유지 (NLWeb처럼 비활성화 없음). `<select>`에 `required` 미사용 — `disabled={loading || !query}` 버튼 가드로 충분.

- [x] TASK-8: `search-host/src/app/page.tsx` 수정
  - File: `search-host/src/app/page.tsx`
  - Action: `handleSearch` 함수 (`line 27`) 에서 `try { ... }` 블록 **맨 앞**에 Crawler early return 삽입.

    현재 try 블록 시작:
    ```typescript
    try {
      const response = await fetch('/api/search', {
    ```

    변경 후 try 블록 시작:
    ```typescript
    try {
      // Crawler: /api/search POST 미경유, 별도 GET 요청 후 early return
      if (params.protocol === 'crawler') {
        const crawlerResponse = await fetch(
          `/api/page?url=${encodeURIComponent(params.query)}&format=${encodeURIComponent(params.format)}`,
        );
        const text = await crawlerResponse.text();

        if (!crawlerResponse.ok) {
          try {
            const errJson = JSON.parse(text) as Record<string, unknown>;
            setError(extractErrorMessage(errJson['error'] ?? errJson, `HTTP ${crawlerResponse.status}`));
          } catch {
            setError(text || `HTTP ${crawlerResponse.status}`);
          }
          return;
        }

        if (params.format === 'json-ld') {
          try {
            setResultData(JSON.parse(text) as object);
          } catch {
            setResultData(text);
          }
        } else {
          setResultData(text);
        }
        return; // early return — 아래 /api/search 로직 미실행
      }

      // 나머지 프로토콜: 기존 /api/search POST 로직 유지 (변경 없음)
      const response = await fetch('/api/search', {
    ```
  - Notes: `extractErrorMessage` 헬퍼 함수는 `line 8`에 이미 정의됨 — 재사용. Crawler early return 이후 기존 `response`/`json` 변수 선언 코드는 그대로 유지 (Crawler 경로에서는 미실행). `params.format`은 `SearchParams.format` 타입으로 `'html' | 'markdown' | 'json-ld'` 중 하나.

- [x] TASK-9: TypeScript 타입 검증
  - File: `search-gateway/`, `search-host/`
  - Action:
    ```bash
    cd search-gateway && npx tsc --noEmit
    cd ../search-host && npx tsc --noEmit
    ```
  - Notes: 타입 에러 발생 시 해당 파일 수정. `R2Bucket` 미인식 시 `@cloudflare/workers-types` 버전 확인.

- [x] TASK-10: Git commit & push
  - Action:
    ```bash
    git add search-gateway/wrangler.toml search-gateway/src/index.ts \
      search-gateway/src/core/r2-page.ts search-gateway/src/protocols/page-fetch.ts \
      search-host/src/app/api/page/route.ts search-host/src/app/api/pages/route.ts \
      search-host/src/app/components/SearchForm.tsx search-host/src/app/page.tsx
    git commit -m "feat: add Crawler protocol for R2 page content retrieval"
    git push
    ```

### Acceptance Criteria

- [ ] AC-1: Given search-gateway 실행 중이고 R2에 `https://example.com/page` 키 존재 시, When `GET /page?url=https%3A%2F%2Fexample.com%2Fpage&format=html` 요청하면, Then 200 + `Content-Type: text/html` + raw HTML 콘텐츠 반환.

- [ ] AC-2: Given R2에 특정 키 존재 시, When `GET /page?url=<url>&format=markdown` 요청하면, Then 200 + `## [title](url)\n\ncontent` 패턴 Markdown 반환.

- [ ] AC-3: Given R2에 특정 키 존재 시, When `GET /page?url=<url>&format=json-ld` 요청하면, Then 200 + `Content-Type: application/json` + Schema.org 호환 JSON-LD 반환.

- [ ] AC-4: Given R2에 오브젝트 존재 시, When `GET /pages` 요청하면, Then `{ "keys": [...] }` + 200 반환 (최대 10개, 요청마다 무작위 순서).

- [ ] AC-5: Given R2에 `https://` 키 없고 `http://` 동일 경로 키 존재 시, When `GET /page?url=https%3A%2F%2Fexample.com%2Fpage&format=html` 요청하면, Then 폴백으로 `http://` 키 조회 후 200 반환.

- [ ] AC-6: Given R2에 해당 URL 키 없을 때, When `GET /page?url=<non-existent>&format=html` 요청하면, Then `{ "error": "Page not found: ..." }` + 404 반환.

- [ ] AC-7: Given `url` 파라미터 없을 때, When `GET /page?format=html` 요청하면, Then `{ "error": "url parameter is required" }` + 400 반환.

- [ ] AC-8: Given R2 버킷이 비어 있을 때, When `GET /pages` 요청하면, Then `{ "keys": [] }` + 200 반환.

- [ ] AC-9: Given search-host 홈페이지 로딩 시, When 프로토콜 드롭다운 확인하면, Then "Crawler (R2 Page Content)" 옵션 표시.

- [ ] AC-10: Given 프로토콜 드롭다운에서 "Crawler" 선택 시, When 폼 확인하면, Then 텍스트 입력창 사라지고 `<select>` 콤보박스 표시 + 즉시 "목록 로딩 중..." 표시.

- [ ] AC-11: Given Crawler 선택 후 `/api/pages` 응답 완료 시, When 콤보박스 확인하면, Then 반환된 URL 목록이 옵션으로 채워짐.

- [ ] AC-12: Given Crawler 프로토콜, 콤보박스 URL 선택, 포맷 선택 후 "조회" 클릭 시, When 요청 완료하면, Then `/api/page` API 통해 콘텐츠 조회 + 기존 SearchResults에 결과 표시.

## Additional Context

### Dependencies

- `R2Bucket` 타입: `@cloudflare/workers-types`에 이미 포함됨 (search-gateway에 설치됨)
- R2 버킷명: `ai-search-crimson-shadow-a101-14fadc`
- 기존 포매터: `search-gateway/src/formatters/` (markdown.ts, jsonld.ts) — html 포맷에는 미사용
- `GATEWAY_URL` 환경변수: search-host `.env.local` 및 Cloudflare Pages 환경변수에 기존 설정됨

### Testing Strategy

1. TypeScript 컴파일: `npx tsc --noEmit` (search-gateway, search-host 양쪽)
2. gateway 로컬 실행: `cd search-gateway && wrangler dev`
3. 엔드포인트 검증:
   - `curl "http://localhost:8787/pages"` -> keys 배열 + 최대 10개 URL 확인
   - 반환 URL 중 하나로: `curl "http://localhost:8787/page?url=<encodeURIComponent(url)>&format=html"` -> raw HTML 확인
   - `curl "http://localhost:8787/page?url=<url>&format=markdown"` -> Markdown 확인
   - `curl "http://localhost:8787/page?format=html"` -> 400 확인
   - `curl "http://localhost:8787/page?url=https%3A%2F%2Fnon-existent.com&format=html"` -> 404 확인
   - `curl "http://localhost:8787/pages"` 빈 버킷 시 -> `{"keys":[]}` 확인
4. search-host 로컬 실행: `npm run dev` -> Crawler 프로토콜 선택 -> 콤보박스 "로딩 중..." 즉시 표시 확인 -> 로딩 후 URL 목록 확인 -> 조회 실행

### Notes

- R2 Binding은 `wrangler dev`에서 `--remote` 없이도 원격 R2에 접근 가능
- `r2Object.text()` 반환값이 실제 HTML인지, AI 추출 텍스트인지는 런타임 확인 필요. 만약 추출 텍스트라면 html 포맷은 raw 텍스트를 반환하게 됨 (기능 동작, 외관만 다름)
- R2 오브젝트 키가 URL과 다를 경우: `GET /pages`로 실제 키 형식 확인 후 `fetchPage` 폴백 로직 조정
- `r2.list({ limit: 1000 })` + 무작위 10개 샘플: 버킷 오브젝트 1000개 초과 시 나머지 무시 (의도된 제약)
- `/pages`는 캐싱 없이 매 요청마다 R2 Class A 연산 수행. lazy load로 불필요한 호출 최소화했으나, 추후 고트래픽 시 KV 캐싱 고려 가능 (현재 Out of Scope)

## Review Notes

- Adversarial review completed (code review phase)
- Findings: 20 total, 6 fixed, 14 skipped
- Resolution approach: auto-fix
- Fixed: F3 (truncated warning), F5 (Content-Type sanitization), F7/F15 (5MB size guard), F8 (URL validation), F10/F11 (empty bucket vs fetch failure distinction), F12 (response shape validation)
- Skipped: F1/F2/F6 (auth/CORS — out of scope), F4 (double-encoding — by design), F9 (format injection — VALID_FORMATS already guards), F13 (title XSS — consumer responsibility), F14 (R2 key collision — acceptable trade-off), F16-F20 (UX/performance — out of scope)
