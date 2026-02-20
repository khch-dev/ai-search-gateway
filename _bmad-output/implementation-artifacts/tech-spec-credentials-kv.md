---
title: 'Credentials Management via Cloudflare KV'
slug: 'credentials-kv'
created: '2026-02-13'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'TypeScript (strict, ES2022, Bundler moduleResolution)'
  - 'Hono (search-gateway, Cloudflare Workers)'
  - 'Next.js App Router (search-host, Cloudflare Pages, edge runtime)'
  - 'Cloudflare Workers KV (binding name: KV_CREDENTIALS)'
  - 'Wrangler (wrangler.toml + .dev.vars)'
files_to_modify:
  - 'packages/cf-kv-client/ (신규)'
  - 'search-gateway/wrangler.toml'
  - 'search-gateway/.dev.vars (신규)'
  - 'search-gateway/.gitignore (신규 또는 수정)'
  - 'search-gateway/src/index.ts'
  - 'search-gateway/src/core/credentials.ts'
  - 'search-gateway/src/core/ai-search.ts'
  - 'search-gateway/src/protocols/mcp.ts'
  - 'search-gateway/src/protocols/nlweb-ask.ts'
  - 'search-gateway/src/protocols/llm-ingest.ts'
  - 'search-host/src/app/components/SearchForm.tsx'
  - 'search-host/src/app/api/search/route.ts'
  - 'search-host/src/app/page.tsx'
code_patterns:
  - 'Hono Context c.env로 Worker 환경변수/KV 바인딩 접근'
  - 'KV 바인딩: env.KV_CREDENTIALS.get(key) (live) / env.CF_ACCOUNT_ID (dev vars)'
  - 'loadCredentials → async 함수, Context<{Bindings:Env}> 파라미터'
  - 'apiToken → searchApiToken 전체 rename'
test_patterns:
  - 'tsc --noEmit 양쪽 프로젝트'
  - 'wrangler dev 실행 후 .dev.vars 자격증명으로 검색 동작 확인'
---

# Tech-Spec: Credentials Management via Cloudflare KV

**Created:** 2026-02-13

## Overview

### Problem Statement

자격증명(accountId, searchApiToken, autoragName)을 웹페이지에서 사용자가 직접 입력하고 있어 보안상 부적절하다. 민감한 Cloudflare AI Search API 토큰이 브라우저 localStorage에 저장되거나 HTTP 헤더로 전달되는 구조다.

### Solution

자격증명을 search-gateway가 자체적으로 관리한다:
- **Dev 모드** (`wrangler dev`): `search-gateway/.dev.vars`에서 환경변수로 읽기
- **Live 모드** (Cloudflare Worker): KV 바인딩(`KV_CREDENTIALS`)으로 읽기
- search-host UI에서 자격증명 입력 필드를 완전히 제거
- `packages/cf-kv-client` 로컬 패키지: KV REST API를 이용한 CLI 도구 (KV 값 set/get)

### Scope

**In Scope:**
- `packages/cf-kv-client/` 신규 생성: KV REST API 클라이언트 + CLI 도구 (로컬 패키지)
- `search-gateway/wrangler.toml`: KV 네임스페이스 바인딩 추가
- `search-gateway/.dev.vars`: Dev용 자격증명 파일 (신규, .gitignore 추가)
- `search-gateway/src/core/credentials.ts`: 헤더 추출 → env/KV 바인딩에서 async 로드
- `search-gateway/src/index.ts`: Env 타입에 KV 바인딩 + CF_* vars 추가
- `search-gateway/src/core/ai-search.ts` + protocols 3개: `apiToken` → `searchApiToken` rename
- `search-host/src/app/components/SearchForm.tsx`: 자격증명 입력 필드/상태/localStorage 제거
- `search-host/src/app/api/search/route.ts`: 자격증명 필드 제거, X-CF-* 헤더 전송 제거
- `search-host/src/app/page.tsx`: SearchParams 타입 업데이트

**Out of Scope:**
- 웹페이지 인증/인가 (로그인 등)
- KV 네임스페이스 신규 생성 (이미 있음: `3eee142dfb8c4580b8cc15e76bc3f84d`)
- KV 값 암호화

## Context for Development

### Codebase Patterns

**credentials.ts 현재 구조 (전체 교체 대상):**
```typescript
export function extractCredentials(c: Context): Credentials | null {
  const accountId = c.req.header('X-CF-Account-ID')?.trim();
  const apiToken = c.req.header('X-CF-API-Token')?.trim();
  const autoragName = c.req.header('X-CF-Autorag-Name')?.trim();
  if (!accountId || !apiToken || !autoragName) return null;
  return { accountId, apiToken, autoragName };
}
```

**변경 후 credentials.ts 전체 코드:**
```typescript
import type { Context } from 'hono';
import type { Env } from '../index';

export interface Credentials {
  accountId: string;
  searchApiToken: string;
  autoragName: string;
}

export async function loadCredentials(c: Context<{ Bindings: Env }>): Promise<Credentials | null> {
  // Dev 모드: .dev.vars에서 환경변수로 직접 읽기
  const accountId = c.env.CF_ACCOUNT_ID?.trim()
    ?? await c.env.KV_CREDENTIALS?.get('CF_ACCOUNT_ID') ?? undefined;
  const searchApiToken = c.env.CF_SEARCH_API_TOKEN?.trim()
    ?? await c.env.KV_CREDENTIALS?.get('CF_SEARCH_API_TOKEN') ?? undefined;
  const autoragName = c.env.CF_AUTORAG_NAME?.trim()
    ?? await c.env.KV_CREDENTIALS?.get('CF_AUTORAG_NAME') ?? undefined;

  if (!accountId || !searchApiToken || !autoragName) return null;
  return { accountId, searchApiToken, autoragName };
}

export const MISSING_CREDENTIALS_ERROR = {
  error: 'Credentials not configured. Set CF_ACCOUNT_ID, CF_SEARCH_API_TOKEN, CF_AUTORAG_NAME in .dev.vars (dev) or KV_CREDENTIALS KV (live).',
} as const;
```

**ai-search.ts 변경 시그니처:**
```typescript
export async function searchAutoRAG(
  accountId: string,
  searchApiToken: string,   // apiToken → searchApiToken
  autoragName: string,
  query: string,
  filters?: SearchFilter[],
): Promise<AISearchResult[]> {
  // ...
  headers: {
    Authorization: `Bearer ${searchApiToken}`,  // apiToken → searchApiToken
  }
}
```

**프로토콜 핸들러 변경 패턴 (mcp, nlweb-ask, llm-ingest 공통):**
```typescript
// 변경 전:
const creds = extractCredentials(c);
if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 401);
const { accountId, apiToken, autoragName } = creds;

// 변경 후:
const creds = await loadCredentials(c);
if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 503);
const { accountId, searchApiToken, autoragName } = creds;
```
(HTTP 상태코드: 자격증명 없음 = 설정 오류이므로 401 → 503으로 변경)

**index.ts Env 타입 변경:**
```typescript
type Env = {
  SEARCH_HOST_ORIGIN: string;
  KV_CREDENTIALS: KVNamespace;
  // Dev mode: .dev.vars 에서 자동으로 읽힘
  CF_ACCOUNT_ID?: string;
  CF_SEARCH_API_TOKEN?: string;
  CF_AUTORAG_NAME?: string;
};
```

**index.ts 미들웨어 로그 변경 (X-CF-* 헤더 로그 제거):**
```typescript
// 변경 전:
const accountId = c.req.header('X-CF-Account-ID');
const apiToken = c.req.header('X-CF-API-Token');
const autoragName = c.req.header('X-CF-Autorag-Name');
console.log('[search-gateway] HTTP 수신:', { method, path, headers: { ... } });

// 변경 후:
console.log('[search-gateway] HTTP 수신:', { method, path });
```

**wrangler.toml 추가 내용:**
```toml
[[kv_namespaces]]
binding = "KV_CREDENTIALS"
id = "3eee142dfb8c4580b8cc15e76bc3f84d"
```

**search-gateway/.dev.vars (신규, .gitignore에 추가):**
```
CF_ACCOUNT_ID=<your_account_id>
CF_SEARCH_API_TOKEN=<your_ai_search_api_token>
CF_AUTORAG_NAME=<your_autorag_name>
```

**packages/cf-kv-client 구조:**
```
packages/cf-kv-client/
  package.json        ← name: "@nhnace/cf-kv-client", bin: { "cf-kv": "./dist/cli.js" }
  tsconfig.json       ← module: CommonJS, outDir: dist, target: ES2022
  src/
    client.ts         ← KV REST API 클라이언트 함수
    cli.ts            ← CLI 진입점 (commander)
```

**client.ts 핵심 함수:**
```typescript
const KV_BASE = 'https://api.cloudflare.com/client/v4';

async function kvRequest(method: string, path: string, body?: string, apiToken: string): Promise<unknown> {
  const res = await fetch(`${KV_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body,
  });
  return res.json();
}

export async function getValue(accountId: string, apiToken: string, namespaceId: string, key: string): Promise<string | null>
export async function putValue(accountId: string, apiToken: string, namespaceId: string, key: string, value: string): Promise<void>
export async function listKeys(accountId: string, apiToken: string, namespaceId: string): Promise<string[]>
```

**cli.ts 명령:**
```bash
cf-kv get <key>         # KV에서 값 읽기
cf-kv put <key> <value> # KV에 값 저장
cf-kv list              # 모든 키 목록
```
환경변수: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (KV 관리용 토큰), `CLOUDFLARE_KV_NAMESPACE_ID`

**SearchForm.tsx 변경:**
- 제거: `accountId`, `apiToken`(`→searchApiToken`), `autoragName` 상태 변수 및 입력 필드
- 제거: `STORAGE_KEY`, `StoredCredentials` 인터페이스, localStorage 로직
- 제거: `credentials-fieldset` fieldset 전체
- `SearchParams` 인터페이스에서 `accountId`, `searchApiToken`, `autoragName` 필드 제거
- `handleSubmit`에서 credential 관련 코드 제거

**route.ts 변경:**
- `SearchRequestBody`에서 `accountId`, `searchApiToken`, `autoragName` 제거
- MCP 브랜치: `StreamableHTTPClientTransport` requestInit headers에서 X-CF-* 헤더 제거
- NLWeb/LLM-Ingest 브랜치: `requestHeaders`에서 X-CF-* 헤더 제거
- 유효성 검사에서 credential 필드 제거

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `search-gateway/src/core/credentials.ts` | 전체 교체 |
| `search-gateway/src/index.ts` | Env 타입 + 미들웨어 로그 수정 |
| `search-gateway/wrangler.toml` | KV 바인딩 추가 |
| `search-gateway/src/core/ai-search.ts` | searchApiToken rename |
| `search-gateway/src/protocols/mcp.ts` | await loadCredentials |
| `search-gateway/src/protocols/nlweb-ask.ts` | await loadCredentials |
| `search-gateway/src/protocols/llm-ingest.ts` | await loadCredentials |
| `search-host/src/app/components/SearchForm.tsx` | 자격증명 fieldset 제거 |
| `search-host/src/app/api/search/route.ts` | credential 필드 + 헤더 제거 |
| `search-host/src/app/page.tsx` | SearchParams 타입 업데이트 |

### Technical Decisions

- **KV 네임스페이스 ID**: `3eee142dfb8c4580b8cc15e76bc3f84d`
- **KV 바인딩 이름**: `KV_CREDENTIALS`
- **KV 키**: `CF_ACCOUNT_ID`, `CF_SEARCH_API_TOKEN`, `CF_AUTORAG_NAME`
- **Dev 우선순위**: `env.CF_*` vars 먼저, 없으면 KV 바인딩 폴백
- **HTTP 상태코드**: 자격증명 없음 → 503 (설정 오류, 인증 실패가 아님)
- **cf-kv-client**: Node.js용 CommonJS 빌드, `commander` 사용
- **searchApiToken**: AI Search API 토큰임을 명확히 표현

## Implementation Plan

### Tasks

- [x] TASK-1: `packages/cf-kv-client` 신규 로컬 패키지 생성
  - File: `packages/cf-kv-client/package.json`
    - Action: `name: "@nhnace/cf-kv-client"`, `bin: { "cf-kv": "./dist/cli.js" }`, `scripts: { build, dev }`, `dependencies: { commander: "^12" }`, `devDependencies: { typescript }`
  - File: `packages/cf-kv-client/tsconfig.json`
    - Action: `module: "CommonJS"`, `target: "ES2022"`, `outDir: "dist"`, `rootDir: "src"`, `strict: true`
  - File: `packages/cf-kv-client/src/client.ts`
    - Action: `getValue`, `putValue`, `listKeys` 함수 구현 (Cloudflare KV REST API 사용, 위 코드 참고)
  - File: `packages/cf-kv-client/src/cli.ts`
    - Action: commander로 `get <key>`, `put <key> <value>`, `list` 명령 구현. 환경변수 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID` 읽기. 누락 시 오류 출력 후 종료.

- [x] TASK-2: `search-gateway` 설정 파일 업데이트
  - File: `search-gateway/wrangler.toml`
    - Action: 기존 내용 유지 후 맨 아래에 추가:
      ```toml
      [[kv_namespaces]]
      binding = "KV_CREDENTIALS"
      id = "3eee142dfb8c4580b8cc15e76bc3f84d"
      ```
  - File: `search-gateway/.dev.vars` (신규)
    - Action: 3개 키/값 템플릿 생성 (실제 값은 사용자가 채워야 함, placeholder 사용)
  - File: `search-gateway/.gitignore` (신규 또는 수정)
    - Action: `.dev.vars` 추가

- [x] TASK-3: `search-gateway/src/index.ts` Env 타입 + 미들웨어 업데이트
  - File: `search-gateway/src/index.ts`
    - Action: `Env` 타입에 `KV_CREDENTIALS: KVNamespace; CF_ACCOUNT_ID?: string; CF_SEARCH_API_TOKEN?: string; CF_AUTORAG_NAME?: string;` 추가
    - Action: 미들웨어 로그에서 X-CF-* 헤더 읽기/로그 제거 (method, path만 로그)
    - Action: import에서 `Env` export 추가 (`export type Env = { ... }`)

- [x] TASK-4: `search-gateway/src/core/credentials.ts` 전체 교체
  - File: `search-gateway/src/core/credentials.ts`
    - Action: 위 "변경 후 credentials.ts 전체 코드" 그대로 작성
    - Note: `extractCredentials` 완전 제거, `loadCredentials` async 함수로 교체, `Env` import 필요

- [x] TASK-5: `search-gateway/src/core/ai-search.ts` + 3개 프로토콜 핸들러 rename
  - File: `search-gateway/src/core/ai-search.ts`
    - Action: 함수 파라미터 `apiToken` → `searchApiToken`, 내부 `Authorization: \`Bearer ${searchApiToken}\`` 으로 변경
  - File: `search-gateway/src/protocols/mcp.ts`
    - Action: `extractCredentials` → `loadCredentials`, `await` 추가, `apiToken` → `searchApiToken` 구조분해
  - File: `search-gateway/src/protocols/nlweb-ask.ts`
    - Action: 동일 패턴 적용 + `searchAutoRAG` 호출 인수 `apiToken` → `searchApiToken`
  - File: `search-gateway/src/protocols/llm-ingest.ts`
    - Action: 동일 패턴 적용 + `searchAutoRAG` 호출 인수 `apiToken` → `searchApiToken`

- [x] TASK-6: `search-host` 자격증명 제거
  - File: `search-host/src/app/components/SearchForm.tsx`
    - Action: `SearchParams`에서 `accountId`, `searchApiToken`, `autoragName` 필드 제거
    - Action: 컴포넌트에서 3개 state (`accountId`, `apiToken`→`searchApiToken`, `autoragName`) 제거
    - Action: `STORAGE_KEY`, `StoredCredentials`, `rememberCredentials` 상태/로직 전체 제거
    - Action: `credentials-fieldset` fieldset JSX 전체 제거
    - Action: `handleSubmit`에서 localStorage 저장/제거 코드 삭제, `onSearch({ protocol, format, query })` 로 단순화
  - File: `search-host/src/app/api/search/route.ts`
    - Action: `SearchRequestBody`에서 `accountId`, `searchApiToken`, `autoragName` 필드 제거
    - Action: 유효성 검사에서 credential 필드 검사 제거
    - Action: MCP 브랜치: `StreamableHTTPClientTransport` `requestInit.headers`에서 X-CF-* 헤더 3개 제거 (requestInit 자체가 비면 제거)
    - Action: NLWeb/LLM-Ingest 브랜치: `requestHeaders`에서 X-CF-* 헤더 3개 제거
  - File: `search-host/src/app/page.tsx`
    - Action: `handleSearch`에서 `params`에 credential 필드 없으므로 `SearchParams` 타입 변경에 맞게 업데이트

- [x] TASK-7: TypeScript 타입 검증
  - Action: `cd search-gateway && npx tsc --noEmit`
  - Action: `cd search-host && npx tsc --noEmit`
  - Action: 오류 발생 시 수정 후 재검증

- [x] TASK-8: Git commit & push
  - Action: 변경된 파일 전체 stage 후 커밋

### Acceptance Criteria

- [x] AC-1: Given `packages/cf-kv-client`가 설치되어 있고 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID` 환경변수가 설정되어 있을 때, when `cf-kv put CF_SEARCH_API_TOKEN mytoken` 실행 후 `cf-kv get CF_SEARCH_API_TOKEN` 실행하면, then `mytoken`이 출력된다.

- [x] AC-2: Given `search-gateway/wrangler.toml`을 확인하면, when `[[kv_namespaces]]` 섹션을 보면, then `binding = "KV_CREDENTIALS"`, `id = "3eee142dfb8c4580b8cc15e76bc3f84d"`가 존재한다.

- [x] AC-3: Given `search-gateway/.dev.vars`가 존재하고 `CF_ACCOUNT_ID`, `CF_SEARCH_API_TOKEN`, `CF_AUTORAG_NAME`이 올바른 값으로 채워져 있을 때, when `wrangler dev` 실행 후 search-host에서 검색하면, then 검색 결과가 정상 표시된다 (자격증명 입력 없이).

- [x] AC-4: Given `search-gateway/src/core/credentials.ts`를 확인하면, when 파일 내용을 보면, then `extractCredentials` 함수가 없고, `loadCredentials`가 async 함수로 존재하며, X-CF-* 헤더를 읽는 코드가 없다.

- [x] AC-5: Given 코드베이스 전체를 검색하면, when `apiToken`(변수명/파라미터명)을 grep하면, then 결과가 0건이다 (모두 `searchApiToken`으로 교체됨).

- [x] AC-6: Given `search-host/src/app/components/SearchForm.tsx`를 확인하면, when 파일 내용을 보면, then `credentials-fieldset`, `accountId`, `apiToken`, `autoragName`, `localStorage`, `STORAGE_KEY` 관련 코드가 없다.

- [x] AC-7: Given `search-host/src/app/api/search/route.ts`를 확인하면, when 파일 내용을 보면, then `X-CF-Account-ID`, `X-CF-API-Token`, `X-CF-Autorag-Name`, `X-CF-Search-API-Token` 헤더를 설정하는 코드가 없다.

- [x] AC-8: Given 양쪽 프로젝트 루트에서, when `npx tsc --noEmit`을 실행하면, then 오류 없이 통과한다.

## Additional Context

### Dependencies

- `commander@^12`: `packages/cf-kv-client` CLI 인수 파싱
- `@cloudflare/workers-types`: KVNamespace 타입 (search-gateway에 이미 설치됨)
- Cloudflare KV REST API: `https://api.cloudflare.com/client/v4/accounts/{accountId}/storage/kv/namespaces/{namespaceId}/values/{key}`

### Testing Strategy

- **TypeScript 타입 검사**: `tsc --noEmit` (양쪽 프로젝트)
- **cf-kv CLI**: 직접 `cf-kv put` / `cf-kv get` / `cf-kv list` 실행
- **통합 검증**: `wrangler dev` 후 UI에서 쿼리 실행 (자격증명 입력 없이 결과 확인)

### Notes

- `loadCredentials`가 async이므로 3개 프로토콜 핸들러 모두에서 `await` 추가 필요 (빠뜨리면 tsc 에러)

## Review Notes

- Adversarial review completed (2026-02-13)
- Findings: 13 total (NOISE 5 제거 후), 11 fixed, 1 skipped (F12 - F6와 중복), 1 undecided/skipped (F13)
- Resolution approach: auto-fix
- Commit: `85753cc` — fix: resolve adversarial review findings (F1-F11)
- `Env` 타입은 `index.ts`에서 `export type Env`로 내보내야 `credentials.ts`에서 import 가능
- `cf-kv-client`의 KV 관리용 `CLOUDFLARE_API_TOKEN`은 AI Search 토큰(`CF_SEARCH_API_TOKEN`)과 다른 토큰 (KV 쓰기 권한 필요)
- `.dev.vars`는 절대 git 커밋 금지 (`.gitignore`에 추가)
- `wrangler dev`에서 KV는 로컬 SQLite 미러 사용 (실제 KV와 별개) → 테스트 시 `.dev.vars` 방식 권장
