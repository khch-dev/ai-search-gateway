---
title: 'Cloudflare AI Search Search Gateway & Host Website'
slug: 'cf-ai-search-gateway-host'
created: '2026-02-13'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
github_repo: 'https://github.com/khch-dev/ai-search-gateway'
tech_stack:
  - 'Node.js / TypeScript'
  - 'Cloudflare Workers (Search Gateway)'
  - 'Next.js App Router (Search Host)'
  - 'Cloudflare Pages (Host 배포)'
  - 'Hono (Worker HTTP 라우터)'
  - '@modelcontextprotocol/sdk'
files_to_modify: []
code_patterns:
  - 'Clean slate - monorepo, two packages'
  - 'Hono router for path-based protocol dispatch on Worker'
  - 'MCP StreamableHTTPServerTransport (Day 1 검증 필요)'
  - 'NLWeb /ask: custom implementation (NLWeb 스펙 기반 custom extension)'
  - 'IAB CMP LLMIngestResponse interface isolation'
  - 'Next.js API Route as credential proxy'
  - 'localStorage for credential persistence (plaintext)'
  - 'In-memory rate limiting: 60 req/min per IP'
test_patterns:
  - 'wrangler dev + curl per endpoint'
  - 'MCP Inspector for /mcp endpoint'
  - 'next dev for host manual testing'
  - 'vitest unit tests for formatters'
---

# Tech-Spec: Cloudflare AI Search Search Gateway & Host Website

**Created:** 2026-02-13

## Overview

### Problem Statement

Cloudflare AutoRAG 인스턴스가 준비되어 있으나, 다양한 AI 프로토콜(MCP, NLWeb, IAB CMP LLM Ingest)로 검색 결과를 제공하는 통합 게이트웨이가 없다. 또한 검색 결과를 HTML, Markdown, JSON-LD 등 다양한 포맷으로 활용하기 어렵다.

### Solution

**Search Gateway** (Cloudflare Worker, TypeScript, Hono)와 **Search Host 웹사이트** (Next.js, Cloudflare Pages)를 구현한다.

- Search Gateway는 단일 Worker에서 경로(path)로 프로토콜을 분기:
  - `/mcp` — MCP (Model Context Protocol, StreamableHTTP)
  - `/nlweb/ask` — NLWeb 자연어 쿼리 (custom 구현, JSON-LD 응답)
  - `/nlweb/mcp` — NLWeb MCP 호환 (→ `/mcp`와 동일 처리)
  - `/llm-ingest` — IAB CMP LLM Ingest API
- 모든 엔드포인트의 백엔드는 동일한 Cloudflare AutoRAG REST API
- 응답 포맷(HTML/Markdown/JSON-LD)은 프로토콜과 독립적으로 선택 가능 (NLWeb은 JSON-LD 고정)

### Scope

**In Scope:**
- Search Gateway (Cloudflare Worker + Hono)
  - `/mcp`: MCP `StreamableHTTPServerTransport`, `search` tool 노출
  - `/nlweb/ask`: NLWeb ask 스펙 구현 (query/mode/prev/site 지원), streaming 고정 false, JSON-LD 응답
  - `/nlweb/mcp`: `/mcp`와 동일 핸들러 재사용
  - `/llm-ingest`: IAB CMP 포맷 응답 (content/metadata/schema_markup/billing 필드)
  - HTTP Header 자격증명: `X-CF-Account-ID`, `X-CF-API-Token`, `X-CF-Autorag-Name`
  - CORS: Hono `cors()`, origin → search-host 도메인 제한
  - Rate limiting: IP당 분당 60회 초과 시 HTTP 429 반환
  - 결과 포맷 변환: HTML / Markdown / JSON-LD (템플릿 기반, `IFormatter` 인터페이스)
- Search Host 웹사이트 (Next.js + Cloudflare Pages)
  - 프로토콜 선택 UI (MCP / NLWeb / LLM Ingest)
  - 포맷 탭 — NLWeb 선택 시 JSON-LD 고정
  - 자격증명 입력 (ACCOUNT_ID, API_TOKEN, AUTORAG_NAME) + localStorage "기억하기"
  - Next.js API Route (`/api/search`) — 자격증명 프록시
  - MCP Client SDK로 Gateway `/mcp` 연결
- GitHub public repo (monorepo) 기준 배포
  - search-gateway → Cloudflare Workers (먼저 배포)
  - search-host → Cloudflare Pages (이후 배포, `GATEWAY_URL` 환경변수 설정 필요)

**Out of Scope:**
- Cloudflare AI Search NLWeb 네이티브 활용
- LLM 재가공 (추후)
- 사용자 계정/세션 관리, Workers Secrets
- IAB CMP 실제 과금/결제 처리
- NLWeb streaming (추후)
- AUTORAG_NAME 동적 다중 지원

## Context for Development

### Codebase Patterns

- **Clean Slate**: 신규 프로젝트. 기존 TS/Node 코드 없음.
- **Monorepo 구조**: `search-gateway/` + `search-host/` 두 패키지
- **Cloudflare AutoRAG REST API** (`search.sh` 기준):
  ```
  POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/autorag/rags/{AUTORAG_NAME}/search
  Authorization: Bearer {API_TOKEN}
  Content-Type: application/json
  Body: { "query": "검색어" }
  ```
  - `filters` 배열 지원 (선택, `search.sh` 참조)
- **검색 결과 content 한계 (Known limitation)**  
  Cloudflare AI Search는 인덱싱 시 문서를 **청크(64~512 토큰)** 단위로 저장하고, 검색 결과의 `content`는 이 청크 단위로만 반환된다. 따라서 원본 문서에 긴 JSON/코드 블록이 있으면 **청크 경계에서 잘려** 한 결과에 앞부분만 보일 수 있다. 게이트웨이/호스트는 API가 준 content를 잘라 쓰지 않으며, 완전한 블록을 보려면 대시보드에서 청크 크기·오버랩 설정을 조정하거나 동일 문서의 여러 검색 결과를 합치는 방식이 필요하다.
- **NLWeb 응답 포맷** (NLWeb 스펙 기반 custom extension):
  ```json
  {
    "query_id": "uuid",
    "results": [{
      "url": "...", "name": "...", "score": 0.95,
      "description": "요약",
      "schema_object": { "@context": "https://schema.org", "@type": "WebPage", ... }
    }]
  }
  ```
- **IAB CMP LLM Ingest 응답 포맷**:
  ```json
  {
    "content": "검색 결과 텍스트",
    "metadata": { "title": "...", "content_id": "...", "token_count": 0 },
    "schema_markup": { "@context": "https://schema.org", "@type": "ItemList", ... },
    "billing": { "query_id": "...", "token_count": 0, "estimated_cost": 0 }
  }
  ```

### Project File Structure

```
/ (repo root)
├── search-gateway/
│   ├── src/
│   │   ├── index.ts                   # Worker 진입점 + Hono 라우터 + CORS + Rate limit
│   │   ├── middleware/
│   │   │   └── rate-limit.ts          # IP당 60 req/min 미들웨어
│   │   ├── protocols/
│   │   │   ├── mcp.ts                 # MCP StreamableHTTP 핸들러
│   │   │   ├── nlweb-ask.ts           # NLWeb /ask 핸들러
│   │   │   └── llm-ingest.ts          # IAB CMP 핸들러 + LLMIngestResponse 타입
│   │   ├── core/
│   │   │   └── ai-search.ts           # AutoRAG API 클라이언트
│   │   └── formatters/
│   │       ├── index.ts               # IFormatter 인터페이스 + format 라우터
│   │       ├── html.ts
│   │       ├── markdown.ts
│   │       └── jsonld.ts
│   ├── tests/
│   │   └── formatters.test.ts         # formatter 단위 테스트 (vitest)
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
│
└── search-host/
    ├── src/app/
    │   ├── page.tsx
    │   ├── layout.tsx
    │   ├── api/search/route.ts        # 자격증명 프록시
    │   └── components/
    │       ├── SearchForm.tsx
    │       └── SearchResults.tsx
    ├── next.config.ts
    ├── package.json
    └── tsconfig.json
```

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `search.sh` | AutoRAG REST API 엔드포인트 + 요청 포맷 확인 |
| `setup-cloudflare-ai-search.sh` | ACCOUNT_ID 처리 방식 참조 |
| [NLWeb REST API Spec](https://github.com/microsoft/NLWeb/blob/main/docs/nlweb-rest-api.md) | NLWeb /ask 구현 참조 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | StreamableHTTPServerTransport |
| [IAB CMP Framework](https://iabtechlab.com/wp-content/uploads/2025/06/LLMs-and-AI-Agents-Integration.pdf) | LLM Ingest 응답 포맷 |
| [Hono Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers) | Worker HTTP 라우터 |

### Technical Decisions

| 결정 | 내용 | 이유 |
|------|------|------|
| Worker 라우터 | Hono | Workers-native, 경량, path 분기 간결 |
| MCP Transport | `StreamableHTTPServerTransport` | SSE 미사용, Workers CPU 제한 호환 |
| NLWeb 구현 | Custom (NLWeb 스펙 기반 extension) | Cloudflare native는 추가 색인 필요 |
| IAB CMP 과금 | billing 필드 구조만 반환 | 스펙 Working Group 단계 |
| 포맷 변환 | 템플릿 기반, `IFormatter` 인터페이스 | 추후 LLM 교체 용이 |
| 자격증명 전달 | `X-CF-Account-ID`, `X-CF-API-Token`, `X-CF-Autorag-Name` | HTTPS + API Route 프록시 |
| AUTORAG_NAME | 웹사이트에서 입력 → 헤더로 전달 | 재사용성, 민감정보 아님 |
| NLWeb 포맷 | JSON-LD 고정 | NLWeb 스펙 |
| NLWeb streaming | `streaming: false` 고정 | Workers SSE 복잡도 → 추후 확장 |
| `/nlweb/mcp` | Hono 동일 핸들러 재사용 | 코드 중복 제거 |
| NLWeb formatter | JSON-LD formatter 직접 호출 (`IFormatter` 제외) | NLWeb은 항상 JSON-LD |
| IAB CMP 타입 | `LLMIngestResponse` 인터페이스로 격리 | 스펙 변경 시 `llm-ingest.ts`만 수정 |
| CORS | Hono `cors()`, origin → search-host 도메인 | Gateway 보안 |
| Rate limiting | In-memory Map, IP당 60 req/min, 초과 시 HTTP 429 | AutoRAG API 과호출 방지 |
| MCP SDK 검증 | Day 1 태스크 (fallback: ~1-2일 추가 소요) | 미호환 시 JSON-RPC 2.0 직접 구현 |
| 자격증명 저장 | localStorage plaintext | 사용자 명시 결정, 경고 문구로 고지 |
| 배포 순서 | Gateway 먼저 → Host 이후 | Host의 GATEWAY_URL 환경변수 의존성 |

## Implementation Plan

### Tasks

#### [x] [TASK-0] Day 1: MCP SDK Workers 호환성 + AutoRAG API 응답 검증
- File: `search-gateway/` (임시 검증)
- Action:
  1. `npm create cloudflare@latest`로 Worker 생성 후 `@modelcontextprotocol/sdk` 설치
  2. `wrangler dev`로 `StreamableHTTPServerTransport` Workers 런타임 동작 확인
     - **성공**: TASK-4에서 SDK 방식으로 구현
     - **실패 (예상 추가 소요: 1-2일)**: TASK-4에서 JSON-RPC 2.0 직접 구현으로 대체
  3. `search.sh`와 동일한 AutoRAG API 호출로 실제 응답 JSON 구조 확인:
     - 응답 필드명 (`url`, `title`/`name`, `content`/`description`, `score` 등) 기록
     - TASK-2의 `AISearchResult` 파싱 로직에 반영
- Notes: 이 결과에 따라 TASK-2, TASK-4 구현 방식이 결정됨. 다른 모든 태스크의 선행 조건.

#### [x] [TASK-1] search-gateway 프로젝트 스캐폴딩
- Files: `search-gateway/package.json`, `search-gateway/tsconfig.json`, `search-gateway/wrangler.toml`
- Action:
  - `package.json`:
    - dependencies: `hono@^4.7`, `@modelcontextprotocol/sdk@^1.5`
    - devDependencies: `wrangler@^3.101`, `typescript@^5.7`, `vitest@^2.1`
  - `tsconfig.json`: `target: "ES2022"`, `lib: ["ES2022"]`, `moduleResolution: "Bundler"`, `strict: true`
  - `wrangler.toml`:
    ```toml
    name = "search-gateway"
    main = "src/index.ts"
    compatibility_date = "2024-11-01"
    # compatibility_flags = ["nodejs_compat"]  # TASK-0 결과에 따라 활성화

    [vars]
    SEARCH_HOST_ORIGIN = "https://search-host.pages.dev"
    ```
- Notes: `AUTORAG_NAME`은 `[vars]`에 없음 — 웹사이트에서 `X-CF-Autorag-Name` 헤더로 전달.

#### [x] [TASK-2] AutoRAG 코어 클라이언트
- File: `search-gateway/src/core/ai-search.ts`
- Action:
  - `AISearchResult` 인터페이스 정의 (TASK-0 실제 응답 확인 후 필드명 최종 확정):
    ```typescript
    export interface AISearchResult {
      url: string;
      title: string;    // AutoRAG 응답 필드명 TASK-0 확인 필요
      content: string;  // AutoRAG 응답 필드명 TASK-0 확인 필요
      score?: number;
    }
    ```
  - `searchAutoRAG(accountId, apiToken, autoragName, query): Promise<AISearchResult[]>` 함수:
    - `fetch`로 `POST https://api.cloudflare.com/client/v4/accounts/{accountId}/autorag/rags/{autoragName}/search` 호출
    - Authorization: Bearer, Content-Type: application/json
    - Body: `{ query }`
    - HTTP 오류 시 `throw new Error(`AutoRAG API error: ${status} ${statusText}`)` 
    - 응답 JSON 파싱 후 `AISearchResult[]` 반환
- Notes: 모든 프로토콜 핸들러가 이 함수를 공유.

#### [x] [TASK-3] 포맷 변환 레이어 + 단위 테스트
- Files: `search-gateway/src/formatters/index.ts`, `html.ts`, `markdown.ts`, `jsonld.ts`, `tests/formatters.test.ts`
- Action:
  - `index.ts`: `FormatType = 'html' | 'markdown' | 'json-ld'` 타입, `IFormatter` 인터페이스, `getFormatter(type)` 팩토리
  - `html.ts`: 각 결과 → `<article class="search-result"><h2><a href="{url}">{title}</a></h2><p>{content}</p></article>`, 전체 → `<div class="search-results">` 래핑
  - `markdown.ts`: `## [{title}]({url})\n\n{content}\n\n---\n` 반복
  - `jsonld.ts`: Schema.org `ItemList` + `ListItem` 구조
    ```json
    { "@context": "https://schema.org", "@type": "ItemList",
      "itemListElement": [{ "@type": "ListItem", "position": 1,
        "item": { "@type": "WebPage", "url": "...", "name": "...", "description": "..." } }] }
    ```
  - `tests/formatters.test.ts` (vitest): 각 formatter에 대해 mock `AISearchResult[]` 입력 → 출력 구조 검증
    - HTML: `<div class="search-results">` 존재 여부
    - Markdown: `##` 헤딩 존재 여부
    - JSON-LD: `@type: "ItemList"` 존재 여부

#### [x] [TASK-4] Rate Limiting 미들웨어
- File: `search-gateway/src/middleware/rate-limit.ts`
- Action:
  - In-memory `Map<string, { count: number; resetAt: number }>` 사용 (key: IP 주소)
  - 미들웨어 함수 `rateLimitMiddleware`:
    ```typescript
    const LIMIT = 60;
    const WINDOW_MS = 60_000; // 1분
    const store = new Map<string, { count: number; resetAt: number }>();

    export async function rateLimitMiddleware(c: Context, next: Next) {
      const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
      const now = Date.now();
      const entry = store.get(ip);

      if (!entry || now > entry.resetAt) {
        store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      } else if (entry.count >= LIMIT) {
        return c.json({ error: 'Rate limit exceeded. Max 60 requests/min.' }, 429);
      } else {
        entry.count++;
      }
      return next();
    }
    ```
  - Notes: Worker 인스턴스 재시작 시 카운터 초기화됨. 분산 환경에서는 Cloudflare Durable Objects로 대체 가능 (추후).

#### [x] [TASK-5] 자격증명 추출 헬퍼
- File: `search-gateway/src/core/credentials.ts`
- Action:
  - `extractCredentials(c: Context): { accountId: string; apiToken: string; autoragName: string } | null` 함수:
    ```typescript
    export function extractCredentials(c: Context) {
      const accountId = c.req.header('X-CF-Account-ID')?.trim();
      const apiToken = c.req.header('X-CF-API-Token')?.trim();
      const autoragName = c.req.header('X-CF-Autorag-Name')?.trim();
      if (!accountId || !apiToken || !autoragName) return null;
      return { accountId, apiToken, autoragName };
    }
    ```
  - 모든 프로토콜 핸들러에서 이 함수를 호출. `null` 반환 시 401 응답:
    `return c.json({ error: 'Missing or empty required headers: X-CF-Account-ID, X-CF-API-Token, X-CF-Autorag-Name' }, 401)`

#### [x] [TASK-6] MCP 프로토콜 핸들러
- File: `search-gateway/src/protocols/mcp.ts`
- Action:
  - `extractCredentials(c)` 호출 → null 시 401 반환
  - **TASK-0 결과에 따라 분기:**
    - **SDK 호환 시**: `McpServer` 생성 + `search` tool 등록 (input: `{ query: string, format: FormatType }`). `searchAutoRAG` 호출 → `getFormatter(format).format(results)` → MCP tool result. `StreamableHTTPServerTransport`로 `c.req.raw` 처리.
    - **SDK 미호환 시 fallback**: body를 JSON-RPC 2.0 직접 파싱. `method === "tools/call"` → AI Search 호출 → `{ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: formatted }] } }` 반환.
  - `export const mcpHandler = async (c: Context<{ Bindings: Env }>) => {...}`

#### [x] [TASK-7] NLWeb /ask 핸들러
- File: `search-gateway/src/protocols/nlweb-ask.ts`
- Action:
  - `extractCredentials(c)` → null 시 401
  - POST body 파싱: `{ query, mode?, prev?, site?, streaming?, query_id? }`
  - `query` 누락/빈 문자열 시 400 반환
  - `searchAutoRAG` 호출
  - NLWeb 응답 반환 (NLWeb 스펙 기반 custom extension — 공식 스펙과 차이 있을 수 있음):
    ```typescript
    return c.json({
      query_id: query_id ?? crypto.randomUUID(),
      results: results.map(r => ({
        url: r.url, name: r.title, score: r.score ?? 1.0,
        description: r.content,
        schema_object: {
          "@context": "https://schema.org", "@type": "WebPage",
          name: r.title, url: r.url, description: r.content
        }
      }))
    });
    ```
  - `streaming` 수신 시 무시 (항상 `application/json`)
- Notes: `IFormatter` 미사용. JSON-LD 구조 직접 구성.

#### [x] [TASK-8] IAB CMP LLM Ingest 핸들러
- File: `search-gateway/src/protocols/llm-ingest.ts`
- Action:
  - `LLMIngestResponse` 인터페이스 정의 (파일 상단):
    ```typescript
    export interface LLMIngestResponse {
      content: string;
      metadata: { title: string; content_id: string; token_count: number; };
      schema_markup: object;
      billing: { query_id: string; token_count: number; estimated_cost: number; };
    }
    ```
  - `extractCredentials(c)` → null 시 401
  - body 또는 쿼리 파라미터에서 `query` 추출. 누락/빈 문자열 시 400.
  - `searchAutoRAG` 호출 후 `LLMIngestResponse` 구성:
    - `content`: `results.map(r => r.content).join('\n\n')`
    - `metadata.title`: `results[0]?.title ?? query`
    - `metadata.content_id`: `crypto.randomUUID()`
    - `metadata.token_count`: `Math.ceil(content.length / 4)`
    - `schema_markup`: `getFormatter('json-ld').format(results)` (JSON 파싱 후 객체)
    - `billing`: `{ query_id: crypto.randomUUID(), token_count, estimated_cost: 0 }`

#### [x] [TASK-9] Worker 진입점 + Hono 라우터
- File: `search-gateway/src/index.ts`
- Action:
  ```typescript
  import { Hono } from 'hono';
  import { cors } from 'hono/cors';
  import { rateLimitMiddleware } from './middleware/rate-limit';
  import { mcpHandler } from './protocols/mcp';
  import { nlwebAskHandler } from './protocols/nlweb-ask';
  import { llmIngestHandler } from './protocols/llm-ingest';

  type Env = { SEARCH_HOST_ORIGIN: string; };
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => cors({ origin: c.env.SEARCH_HOST_ORIGIN })(c, next));
  app.use('*', rateLimitMiddleware);

  app.post('/mcp', mcpHandler);
  app.post('/nlweb/mcp', mcpHandler);
  app.post('/nlweb/ask', nlwebAskHandler);
  app.post('/llm-ingest', llmIngestHandler);
  app.get('/health', (c) => c.json({ status: 'ok' }));

  export default app;
  ```

#### [x] [TASK-10] search-host 프로젝트 스캐폴딩
- Files: `search-host/package.json`, `search-host/tsconfig.json`, `search-host/next.config.ts`
- Action:
  - `package.json`:
    - dependencies: `next@^15.1`, `react@^19.0`, `react-dom@^19.0`, `@cloudflare/next-on-pages@^1.13`, `@modelcontextprotocol/sdk@^1.5`, `isomorphic-dompurify@^2.17`
    - devDependencies: `typescript@^5.7`
  - `next.config.ts`: `@cloudflare/next-on-pages` 플러그인 적용
  - `tsconfig.json`: Next.js 표준 + `strict: true`

#### [x] [TASK-11] Next.js API Route (자격증명 프록시)
- File: `search-host/src/app/api/search/route.ts`
- Action:
  - `export const runtime = 'edge'`
  - POST 수신: `{ protocol, format, query, accountId, apiToken, autoragName }`
  - 필수 필드 검증: `accountId`, `apiToken`, `autoragName`, `query` 누락/빈 문자열 시 400
  - `protocol`로 Gateway URL 결정:
    - `'mcp'` → `${GATEWAY_URL}/mcp`
    - `'nlweb'` → `${GATEWAY_URL}/nlweb/ask`
    - `'llm-ingest'` → `${GATEWAY_URL}/llm-ingest`
  - Gateway fetch:
    ```typescript
    fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'X-CF-Account-ID': accountId,
        'X-CF-API-Token': apiToken,
        'X-CF-Autorag-Name': autoragName,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, format }),
    })
    ```
  - Gateway 응답 그대로 반환
  - `GATEWAY_URL`: `process.env.GATEWAY_URL` (서버사이드 전용, `NEXT_PUBLIC_` 없음)

#### [x] [TASK-12] SearchForm 컴포넌트
- File: `search-host/src/app/components/SearchForm.tsx`
- Action:
  - `'use client'`
  - **자격증명 섹션**: ACCOUNT_ID (`type="text"`), API_TOKEN (`type="password"`), AUTORAG_NAME (`type="text"`) 입력 필드
  - "기억하기" 체크박스 + 경고: `"⚠️ 자격증명이 브라우저 localStorage에 저장됩니다. 공유 기기에서는 사용하지 마세요."`
  - `useEffect` (마운트): `localStorage.getItem('sg_credentials')` 로드 → `{ accountId, apiToken, autoragName }` 파싱 후 폼 채움
  - 저장: 체크박스 활성화 상태에서 제출 시 `localStorage.setItem('sg_credentials', JSON.stringify({accountId, apiToken, autoragName}))`
  - **프로토콜 선택** `<select>`: MCP / NLWeb / LLM Ingest
  - **포맷 탭**: HTML / Markdown / JSON-LD. `protocol === 'nlweb'` 시 HTML·Markdown `disabled` + 툴팁, JSON-LD 자동 선택
  - **검색어 `<input>`** + **제출 `<button>`**
  - `onSubmit`: `props.onSearch({ protocol, format, query, accountId, apiToken, autoragName })` 콜백

#### [x] [TASK-13] SearchResults 컴포넌트
- File: `search-host/src/app/components/SearchResults.tsx`
- Action:
  - props: `{ format: FormatType | null, data: string | object | null, loading: boolean, error: string | null }`
  - 로딩: "검색 중..." 표시
  - 에러: 빨간 에러 박스
  - `format === 'html'`: `DOMPurify.sanitize(data)` 후 `dangerouslySetInnerHTML`
  - `format === 'markdown'`: `<pre className="whitespace-pre-wrap">{data}</pre>`
  - `format === 'json-ld'`: `<pre><code>{JSON.stringify(data, null, 2)}</code></pre>`
  - 결과 없음: "검색 결과가 없습니다."

#### [x] [TASK-14] 메인 페이지 + 레이아웃
- Files: `search-host/src/app/page.tsx`, `search-host/src/app/layout.tsx`
- Action:
  - `page.tsx` (`'use client'`): `useState`로 result/loading/error/format 관리. `handleSearch`에서 `/api/search` POST 호출. `<SearchForm>` + `<SearchResults>` 조합.
  - `layout.tsx`: 제목 "AI Search Gateway", viewport 메타태그

#### [x] [TASK-15] 모노레포 루트 설정
- Files: `README.md`, `.gitignore`, `search-host/.env.example`
- Action:
  - `README.md`:
    - 프로젝트 개요, 아키텍처 다이어그램 (텍스트)
    - 로컬 실행: `cd search-gateway && wrangler dev`, `cd search-host && next dev`
    - **배포 순서**: (1) `cd search-gateway && wrangler deploy` → Worker URL 확인, (2) Cloudflare Pages에 search-host 연결, `GATEWAY_URL` 환경변수 설정, (3) `cd search-host && npm run deploy`
    - AUTORAG_NAME 설정: 웹사이트 UI에서 입력 (코드 변경 불필요)
    - NLWeb custom extension 안내
    - 보안 주의사항 (localStorage)
  - `.gitignore`: `node_modules/`, `.wrangler/`, `.next/`, `.dev.vars`, `.env.local`
  - `search-host/.env.example`: `GATEWAY_URL=https://search-gateway.your-subdomain.workers.dev`

### Acceptance Criteria

- [ ] AC-1: Given Worker 배포 후 OPTIONS 요청 시, `Access-Control-Allow-Origin`이 search-host 도메인으로 설정된다.

- [ ] AC-2: Given `X-CF-Account-ID`, `X-CF-API-Token`, `X-CF-Autorag-Name` 중 하나라도 누락되거나 빈 문자열·공백만 포함된 경우, 모든 프로토콜 엔드포인트가 HTTP 401을 반환한다.

- [ ] AC-3: Given 유효한 자격증명으로 `POST /mcp`에 MCP `tools/call` (`tool: "search"`, `params: {query: "NHN", format: "html"}`) 시, MCP 응답 content에 `<div class="search-results">` HTML이 포함된다.

- [ ] AC-4: Given 유효한 자격증명으로 `POST /nlweb/ask`에 `{"query": "NHN"}` 요청 시, 응답에 `query_id`와 `results[]`가 있고 각 항목에 `schema_object["@context"] === "https://schema.org"` 필드가 있다.

- [ ] AC-5: Given `POST /nlweb/ask`에 `{"query": "NHN", "streaming": true}` 요청 시, `Content-Type: application/json`으로 일반 JSON 응답이 반환된다 (SSE 아님).

- [ ] AC-6: Given `POST /nlweb/mcp`에 MCP 요청 시, `POST /mcp`와 동일한 응답 구조가 반환된다.

- [ ] AC-7: Given 유효한 자격증명으로 `POST /llm-ingest`에 `{"query": "NHN"}` 요청 시, 응답에 `content`, `metadata`, `schema_markup`, `billing` 필드가 모두 존재한다.

- [ ] AC-8: Given MCP `search` tool에 `format: "markdown"` 지정 시, 응답 content에 `##` 마크다운 헤딩이 포함된다.

- [ ] AC-9: Given MCP `search` tool에 `format: "json-ld"` 지정 시, 응답 content를 JSON 파싱하면 `@type: "ItemList"` 필드가 존재한다.

- [ ] AC-10: Given AutoRAG API가 4xx/5xx 반환 시, 모든 Gateway 엔드포인트가 HTTP 502와 오류 메시지를 반환한다.

- [ ] AC-11: Given 동일 IP에서 1분 이내 61번째 요청 시, HTTP 429 `{"error": "Rate limit exceeded. Max 60 requests/min."}` 응답이 반환된다.

- [ ] AC-12: Given Host에서 프로토콜 "NLWeb" 선택 시, HTML·Markdown 포맷 탭이 `disabled`이고 JSON-LD가 자동 선택된다.

- [ ] AC-13: Given Host에서 자격증명 입력 + "기억하기" 체크 + 제출 후 새로고침 시, ACCOUNT_ID, API_TOKEN, AUTORAG_NAME이 폼에 자동 채워진다.

- [ ] AC-14: Given Host에서 검색 제출 시, 브라우저 DevTools에서 Gateway URL로 직접 요청이 없고 `/api/search`로만 요청이 발생한다.

- [ ] AC-15: Given Gateway가 HTML 포맷 결과 반환 시, SearchResults가 DOMPurify 새니타이징 후 렌더링하여 `<script>` 태그가 제거된다.

- [ ] AC-16: Given `GET /health` 요청 시, HTTP 200과 `{"status": "ok"}` 응답이 반환된다.

- [ ] AC-17: Given `vitest` 실행 시, formatters 단위 테스트가 모두 통과한다 (HTML/Markdown/JSON-LD 각 1개 이상).

## Additional Context

### Dependencies

**search-gateway:**
- `hono@^4.7` — Workers HTTP 라우터
- `@modelcontextprotocol/sdk@^1.5` — MCP Server (TASK-0 검증 후 확정)
- `wrangler@^3.101` (devDependency)
- `typescript@^5.7` (devDependency)
- `vitest@^2.1` (devDependency) — formatter 단위 테스트

**search-host:**
- `next@^15.1`
- `react@^19.0` / `react-dom@^19.0`
- `@cloudflare/next-on-pages@^1.13`
- `@modelcontextprotocol/sdk@^1.5` — MCP Client
- `isomorphic-dompurify@^2.17` — HTML 새니타이징
- `typescript@^5.7` (devDependency)

### Testing Strategy

- **TASK-0**: `wrangler dev` + curl로 MCP SDK 호환성 + AutoRAG API 실제 응답 필드 확인
- **Formatter 단위 테스트** (`vitest run`): TASK-3에서 작성, CI에서 자동 실행
- **Gateway 수동 테스트** (`wrangler dev`):
  - `GET /health`
  - `/mcp`: MCP Inspector (`npx @modelcontextprotocol/inspector`)
  - `/nlweb/ask`, `/nlweb/mcp`, `/llm-ingest`: curl POST
  - 자격증명 누락/빈 값 → 401
  - 60회 초과 → 429 (스크립트로 61회 반복 요청)
  - AutoRAG 오류 → 502
- **Host 수동 테스트** (`next dev`): 9가지 프로토콜×포맷 조합, NLWeb 포맷 잠금, 자격증명 localStorage 저장/로드

### Risks & Notes

- **MCP SDK + Workers 호환성** (HIGH): TASK-0 Day 1 필수. 미호환 시 JSON-RPC 2.0 직접 구현 (약 1-2일 추가 소요). 나머지 TASK 영향 없음.
- **AutoRAG 응답 필드명** (MEDIUM): TASK-0에서 실제 응답 확인 후 `ai-search.ts` 파싱 조정 필요.
- **NLWeb custom extension** (LOW): 공식 NLWeb 스펙과 `schema_object` 구조가 다를 수 있음. README에 "custom extension" 명시.
- **IAB CMP 스펙 미확정** (MEDIUM): `LLMIngestResponse` 인터페이스로 격리. 스펙 변경 시 `llm-ingest.ts`만 수정.
- **Rate limiting 분산** (LOW): In-memory 방식은 Worker 재시작 시 초기화. 고가용성 필요 시 Cloudflare Durable Objects로 교체.
- **HTML 새니타이징** (MEDIUM): `isomorphic-dompurify` 필수 (TASK-13 포함).
- **localStorage 보안**: 사용자 명시 결정 (plaintext). 경고 문구 표시로 고지 완료.
- **배포 순서**: Gateway → Host 순서 필수 (Host의 `GATEWAY_URL` 의존성).
- **LLM 연동 준비**: `IFormatter` 인터페이스로 추상화. 추후 LLM API 교체 시 formatter 구현체만 교체.
- **NLWeb streaming**: Workers `ReadableStream` SSE 가능하나 복잡. 2차 구현으로 분리.

## Review Notes

- Adversarial review completed (2026-02-13)
- Findings: 15개 total, 13개 fixed, 2개 skipped (F12 noise, F15 noise)
- Resolution approach: auto-fix
- Key fixes: zod 의존성 추가, vitest 설정, top-level await 제거, MCP Accept 헤더, AutoRAG 안전 접근, rate-limit 메모리 누수 방지, DOMPurify 클라이언트 전용 처리, transport cleanup, 이중 직렬화 제거, JSON parse 방어, Pages wrangler.toml, 타입 수정, 런타임 입력 검증
- GitHub: https://github.com/khch-dev/ai-search-gateway (main, 29 files, 1,672 lines)
