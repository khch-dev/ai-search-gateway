---
title: 'MCP SDK Full Lifecycle - Client & Server'
slug: 'mcp-sdk-lifecycle'
created: '2026-02-13'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - '@modelcontextprotocol/sdk@^1.5 (v1.26.0 실설치)'
  - 'Hono (Cloudflare Workers, Web Standard APIs)'
  - 'Next.js 15 App Router (edge runtime)'
  - 'TypeScript strict + noUncheckedIndexedAccess'
  - 'zod@^3.24 (search-gateway)'
files_to_modify:
  - 'search-gateway/src/protocols/mcp.ts'
  - 'search-host/src/app/api/search/route.ts'
  - 'search-host/src/app/page.tsx'
code_patterns:
  - 'McpServer + WebStandardStreamableHTTPServerTransport (sessionIdGenerator: undefined)'
  - 'Client + StreamableHTTPClientTransport per-request lifecycle'
  - 'result.content[0] undefined-safe access (noUncheckedIndexedAccess)'
  - 'Credentials via requestInit.headers'
test_patterns:
  - 'vitest (search-gateway/tests/) — 영향 없음'
  - 'curl MCP initialize 수동 테스트'
---

# Tech-Spec: MCP SDK Full Lifecycle - Client & Server

**Created:** 2026-02-13

## Overview

### Problem Statement

현재 MCP 구현은 MCP 프로토콜 라이프사이클을 무시하고 있다:

1. **search-gateway (`mcp.ts`)**: `McpServer` SDK 없이 raw JSON-RPC 2.0을 직접 처리. `initialize` / `initialized` 핸들셰이크 없음. 서버가 capabilities를 선언하지 않아 MCP 클라이언트 호환 불가.
2. **search-host (`route.ts`)**: `Client` SDK 없이 단순 `fetch`로 JSON-RPC 전송. MCP 프로토콜 표준 위반. `initialize` 없이 `tools/call`만 전송.

MCP 스펙이 요구하는 정상 라이프사이클:
```
Client → Server: initialize (프로토콜 버전, 클라이언트 정보)
Server → Client: initialize 응답 (서버 capabilities)
Client → Server: initialized (notification, 핸들셰이크 완료)
Client → Server: tools/call (실제 검색 요청)
Server → Client: tools/call 결과
```

### Solution

MCP TypeScript SDK 표준 클래스를 사용하여 라이프사이클을 정확하게 구현:
- **search-gateway**: `McpServer` + `WebStandardStreamableHTTPServerTransport` (stateless, Workers 호환)
- **search-host API route**: `Client` + `StreamableHTTPClientTransport` (Edge runtime 호환, per-request lifecycle)

### Scope

**In Scope:**
- `search-gateway/src/protocols/mcp.ts` — McpServer + WebStandardStreamableHTTPServerTransport 구현
- `search-host/src/app/api/search/route.ts` — MCP 경로에 Client SDK 적용, 결과 추출 후 구조화된 응답 반환
- `search-host/src/app/page.tsx` — 변경된 route.ts 응답 형식(`{ text, format }`)에 맞춰 MCP 파싱 업데이트

**Out of Scope:**
- NLWeb, LLM-Ingest 프로토콜 변경
- 브라우저 SSE 스트리밍 UI
- MCP 세션 관리 (stateful 모드, KV 저장소 등)
- MCP OAuth 인증

---

## Context for Development

### Codebase Patterns

#### 1. WebStandardStreamableHTTPServerTransport 필수 요건 (소스 코드 확인)

```javascript
// webStandardStreamableHttp.js:371 (실제 소스)
if (!acceptHeader?.includes('application/json') || !acceptHeader.includes('text/event-stream')) {
    return createJsonErrorResponse(406, -32000, 'Not Acceptable: ...');
}
```
→ 클라이언트는 **반드시** `Accept: application/json, text/event-stream` 둘 다 포함 필요.
→ `StreamableHTTPClientTransport`가 이를 자동으로 설정함. 직접 설정 불필요.

#### 2. StreamableHTTPClientTransport Edge Runtime 호환성 (확인됨)

```javascript
// client/streamableHttp.js imports:
import { EventSourceParserStream } from 'eventsource-parser/stream'; // Web Streams 기반
// EventSource Web API 미사용 → Cloudflare Pages edge runtime 호환
```

#### 3. WebStandardStreamableHTTPServerTransport 생성자

```typescript
new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless (Workers 필수)
  // enableJsonResponse: false (기본값) — SSE 응답 사용
})
```

#### 4. StreamableHTTPClientTransport 생성자

```typescript
new StreamableHTTPClientTransport(
  new URL(gatewayUrl),  // URL 객체 필수
  {
    requestInit: {
      headers: {
        // CF credentials 전달
        'X-CF-Account-ID': accountId,
        'X-CF-API-Token': apiToken,
        'X-CF-Autorag-Name': autoragName,
        // Content-Type, Accept는 SDK가 자동 설정
      },
    },
  }
)
```

#### 5. Client 라이프사이클 패턴

```typescript
const client = new Client({ name: 'search-host', version: '0.1.0' });
await client.connect(transport); // initialize → initialized 자동 처리
const result = await client.callTool({ name: 'search', arguments: { query, format } });
// result.content: Array<{ type: 'text'; text: string } | ...>
const firstContent = result.content[0]; // noUncheckedIndexedAccess → undefined 가능
const text = firstContent?.type === 'text' ? firstContent.text : '';
await client.close();
```

#### 6. callTool 반환 타입 (SDK 타입 정의)

```typescript
callTool(params): Promise<{
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; ... }
  >;
  isError?: boolean;
}>
```

#### 7. route.ts 응답 형식 변경 (MCP만 해당)

- **현재**: gateway 응답 전체 proxy + `_rawGatewayPayload` debug 필드
- **변경**: `{ text: string }` 형식으로 단순화 (SDK가 결과를 구조적으로 추출)

#### 8. hono c.req.raw

Hono의 `c.req.raw`는 Web Standard `Request` 객체.
`transport.handleRequest(c.req.raw)` → 정상 동작. 별도 변환 불필요.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `search-gateway/src/protocols/mcp.ts` | 교체 대상 (현재: raw JSON-RPC) |
| `search-host/src/app/api/search/route.ts` | MCP 분기 수정 대상 |
| `search-host/src/app/page.tsx` | MCP 응답 파싱 수정 대상 |
| `search-gateway/src/core/credentials.ts` | 참조 — extractCredentials 패턴 |
| `search-gateway/src/formatters/index.ts` | 참조 — getFormatter 사용 유지 |
| `@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.d.ts` | 서버 transport API |
| `@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts` | 클라이언트 transport API |
| `@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` | Client API (callTool 반환 타입) |

### Technical Decisions

| 결정 | 이유 |
|------|------|
| `sessionIdGenerator: undefined` (stateless) | Cloudflare Workers는 요청 간 상태 유지 불가 |
| per-request Client 인스턴스 | API route는 stateless edge function. connect → callTool → close 패턴. **트레이드오프**: 요청마다 initialize RTT 1회 추가 (총 2 RTT: initialize + tools/call) |
| `_rawGatewayPayload` 제거 (MCP 경로) | SDK Client가 구조적 결과 반환. debug 필드 불필요 |
| NLWeb/LLM-Ingest 변경 없음 | SDK 불필요. 현재 동작 정상 |
| route.ts에서 text 추출 후 반환 | page.tsx 파싱 로직 단순화. MCP 응답 구조 추상화 |

---

## Implementation Plan

### Tasks

- [ ] **TASK-1**: search-gateway mcp.ts — McpServer + WebStandardStreamableHTTPServerTransport 구현
  - **File:** `search-gateway/src/protocols/mcp.ts`
  - **Action:** 파일 전체 교체
  - **코드:**
    ```typescript
    import type { Context } from 'hono';
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
    import { z } from 'zod';
    import { searchAutoRAG } from '../core/ai-search';
    import { extractCredentials, MISSING_CREDENTIALS_ERROR } from '../core/credentials';
    import { getFormatter, type FormatType } from '../formatters/index';

    export const mcpHandler = async (c: Context): Promise<Response> => {
      const creds = extractCredentials(c);
      if (!creds) return c.json(MISSING_CREDENTIALS_ERROR, 401);

      const { accountId, apiToken, autoragName } = creds;

      const server = new McpServer({ name: 'search-gateway', version: '0.1.0' });

      server.tool(
        'search',
        'Cloudflare AutoRAG를 사용한 AI 검색',
        {
          query: z.string().min(1).describe('검색어'),
          format: z.enum(['html', 'markdown', 'json-ld']).default('json-ld').describe('응답 포맷'),
        },
        async ({ query, format }) => {
          const results = await searchAutoRAG(accountId, apiToken, autoragName, query);
          const text = getFormatter(format as FormatType).format(results);
          return { content: [{ type: 'text' as const, text }] };
        },
      );

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        return await transport.handleRequest(c.req.raw);
      } finally {
        await transport.close().catch(() => undefined);
      }
    };
    ```
  - **Notes:** zod, McpServer, WebStandardStreamableHTTPServerTransport 모두 이미 설치됨.

---

- [ ] **TASK-2**: search-host route.ts — MCP 경로에 Client SDK 적용
  - **File:** `search-host/src/app/api/search/route.ts`
  - **Action:** 파일 상단에 import 추가. `POST` 핸들러에서 MCP 분기를 완전히 교체.
  - **추가할 imports:**
    ```typescript
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
    ```
  - **MCP 분기 교체 (현재 fetch proxy 로직 대체):**
    ```typescript
    // protocol === 'mcp' 일 때
    const transport = new StreamableHTTPClientTransport(
      new URL(targetUrl),
      {
        requestInit: {
          headers: {
            'X-CF-Account-ID': accountId.trim(),
            'X-CF-API-Token': apiToken.trim(),
            'X-CF-Autorag-Name': autoragName.trim(),
          },
        },
      },
    );
    const client = new Client({ name: 'search-host', version: '0.1.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'search', arguments: { query, format } });
      const firstContent = result.content[0];
      const text = firstContent?.type === 'text' ? firstContent.text : '';
      return NextResponse.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    } finally {
      await client.close().catch(() => undefined);
    }
    ```
  - **NLWeb/LLM-Ingest 분기**: 현재 fetch proxy 방식 그대로 유지.
  - **제거**: MCP 전용 `gatewayBody` 생성 로직(jsonrpc 래핑), `_rawGatewayPayload` 포함 로직.
  - **Notes:** `new URL(targetUrl)` — targetUrl이 절대 URL임을 보장. `GATEWAY_URL` 환경변수 검증은 기존 코드 유지.

---

- [ ] **TASK-3**: search-host page.tsx — MCP 응답 파싱 업데이트
  - **File:** `search-host/src/app/page.tsx`
  - **Action:** MCP 분기에서 `json.text`를 읽도록 수정
  - **현재 MCP 분기:**
    ```typescript
    // 현재 (삭제):
    setResultData(mcpJson); // 전체 객체 전달
    ```
  - **변경 후:**
    ```typescript
    if (params.protocol === 'mcp') {
      const mcpJson = json as Record<string, unknown>;
      if (mcpJson['error']) {
        setError(extractErrorMessage(mcpJson['error'], 'MCP 오류가 발생했습니다.'));
        return;
      }
      const text = typeof mcpJson['text'] === 'string' ? mcpJson['text'] : '';
      if (params.format === 'json-ld') {
        try {
          setResultData(JSON.parse(text) as object);
        } catch {
          setResultData(text);
        }
      } else {
        setResultData(text);
      }
    }
    ```
  - **Notes:** `extractErrorMessage` helper는 현재 파일에 이미 존재. 변경 없음.

---

- [ ] **TASK-4**: TypeScript 타입 검증
  - **File:** `search-gateway/` (tsc), `search-host/` (tsc)
  - **Action:** `npx tsc --noEmit` 실행하여 에러 없음 확인
  - **Notes:** `noUncheckedIndexedAccess` 때문에 `result.content[0]` 접근 시 `?` 체이닝 필수.

---

- [ ] **TASK-5**: Git commit & push
  - **Files:** TASK-1~3에서 수정한 3개 파일
  - **Action:** `git add ... && git commit -m "feat: implement MCP SDK lifecycle (Client + Server)"` && `git push`

---

### Acceptance Criteria

- [ ] **AC-1: MCP 라이프사이클 핸들셰이크**
  - Given: search-gateway 실행 중, search-host UI에서 MCP 선택
  - When: 검색어 입력 후 검색 실행
  - Then: gateway 로그에서 `initialize` 메서드 수신 확인 가능 (server.tool이 등록된 상태로 응답)

- [ ] **AC-2: 검색 결과 텍스트 표시 (json-ld)**
  - Given: 유효한 Cloudflare credentials 설정
  - When: MCP + json-ld 포맷으로 검색어 입력
  - Then: UI에 Schema.org JSON-LD 형식 검색 결과 표시 (JSON 코드블록)

- [ ] **AC-3: 검색 결과 텍스트 표시 (markdown)**
  - Given: 유효한 Cloudflare credentials 설정
  - When: MCP + markdown 포맷으로 검색어 입력
  - Then: UI에 마크다운 텍스트 표시

- [ ] **AC-4: 에러 처리 — 잘못된 credentials**
  - Given: 잘못된 X-CF-API-Token
  - When: MCP 검색 실행
  - Then: `client.connect()` 또는 `client.callTool()` 단계에서 Error throw → route.ts catch 블록에서 `{ error: msg }` 반환 → UI에 문자열 에러 메시지 표시. "Objects are not valid as React child" 에러 없음.

- [ ] **AC-7: 빈 검색 결과 처리**
  - Given: 유효한 credentials, 매칭 결과가 없는 검색어
  - When: MCP 검색 실행
  - Then: `result.content`가 빈 배열이거나 첫 항목이 text 타입이 아닐 경우 `text = ''` 처리 → UI에 "검색 결과가 없습니다" 표시 (SearchResults isEmpty 분기 활용)

- [ ] **AC-5: NLWeb 미영향**
  - Given: 코드 수정 완료
  - When: NLWeb 프로토콜로 검색
  - Then: 기존과 동일하게 결과 표시. route.ts NLWeb 분기 미변경 확인.

- [ ] **AC-6: TypeScript 타입 체크 통과**
  - Given: TASK-1~3 완료
  - When: `cd search-gateway && npx tsc --noEmit`
  - Then: 에러 0개

---

## Additional Context

### Dependencies

| 의존성 | 위치 | 상태 |
|--------|------|------|
| `@modelcontextprotocol/sdk@^1.5` | search-gateway, search-host | 이미 설치됨 |
| `zod@^3.24` | search-gateway | 이미 설치됨 |
| `eventsource-parser` | SDK 내부 의존성 | 자동 포함 |

### Testing Strategy

1. **TASK-1 완료 후 — curl 단계별 수동 테스트:**
   ```bash
   # Step A: initialize → capabilities.tools 필드 확인
   curl -X POST http://localhost:8787/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "X-CF-Account-ID: <id>" -H "X-CF-API-Token: <token>" -H "X-CF-Autorag-Name: <name>" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
   # 기대값: result.capabilities.tools 필드 존재

   # Step B: tools/list → search tool 등록 확인
   curl -X POST http://localhost:8787/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "X-CF-Account-ID: <id>" -H "X-CF-API-Token: <token>" -H "X-CF-Autorag-Name: <name>" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
   # 기대값: result.tools 배열에 name=="search" 항목 존재
   ```
2. **잘못된 credentials 에러 단계 확인:** `client.connect()` vs `client.callTool()` 중 어느 단계에서 throw되는지 로그로 확인
3. **빈 결과 처리:** AutoRAG가 매칭 없는 경우 `content: []` 또는 빈 text 반환 시 UI 표시 확인
4. **엔드투엔드 — search-host UI 검색 테스트** (gateway + host 동시 실행)
5. **TypeScript:** `cd search-gateway && npx tsc --noEmit`

### Notes

- **위험 요소**: `StreamableHTTPClientTransport.connect()` 내부에서 GET SSE 채널 수립을 시도할 수 있음. Stateless 서버는 GET에 405를 반환 → SDK `reconnectionOptions.maxRetries` 소진 후 POST-only 모드로 fallback. 동작에는 영향 없으나 연결 초기에 수백ms 지연이 발생할 수 있음. 실제 테스트로 확인 필요.
- **`c.req.raw`**: Hono의 Web Standard Request 객체. `transport.handleRequest(c.req.raw)` 직접 전달 가능.
- **`result.content[0]`**: `noUncheckedIndexedAccess` 때문에 undefined 타입 포함. `?.` 연산자 또는 변수 할당 후 undefined 체크 필수.
- **향후 고려**: stateful 세션 지원 필요 시 Cloudflare KV 기반 transport store 구현 가능. 현재 스코프 밖.
