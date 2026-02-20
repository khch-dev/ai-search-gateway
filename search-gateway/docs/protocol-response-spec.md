# 프로토콜별 응답 스펙 준수

search-gateway는 요청 경로에 따라 해당 프로토콜의 서버로 동작하며, 각 스펙에 맞는 응답을 반환한다.

## MCP (Model Context Protocol)

- **역할**: MCP Server (JSON-RPC 2.0)
- **엔드포인트**: `POST /mcp`, `POST /nlweb/mcp`
- **스펙**: [MCP Specification](https://spec.modelcontextprotocol.io/)
- **응답**:
  - `initialize` → MCP 표준 초기화 응답
  - `tools/call` → `result: { content: [{ type: 'text', text: string }] }` (포맷팅된 검색 결과 문자열)
- **구현**: `@modelcontextprotocol/sdk` McpServer + WebStandardStreamableHTTPServerTransport, `enableJsonResponse: true`

## NLWeb

- **역할**: NLWeb /ask API 서버
- **엔드포인트**: `POST /nlweb/ask`
- **스펙**: [NLWeb Rest API](https://github.com/microsoft/NLWeb/blob/main/docs/nlweb-rest-api.md)
- **응답**:
  - `query_id`: string (요청 시 지정 또는 자동 생성)
  - `results`: 배열, 각 항목: `url`, `name`, `site`, `score`, `description`, `schema_object` (Schema.org WebPage 등)
- **구현**: `protocols/nlweb-ask.ts` — 검색 후 R2 보강, 위 필드로 JSON 반환

## LLM Ingest (IAB CMP / CoMP)

스펙상 4개 엔드포인트: **1. Info** · **2. Query** · **3. Bidding** · **4. Logging**. 현재 1·2번만 지원, 3·4번은 추후 지원 예정.

### 1. Info Endpoint (지원)

- **역할**: 서비스·엔드포인트·가격 정보 제공 (과금 계획 없음 → 단가 0)
- **엔드포인트**: `GET /llm-ingest/info`
- **인증**: 불필요
- **응답**: `version`, `endpoints` (info, query, bidding: null, logging: null), `pricing` (unit_price: 0, currency: "USD")
- **구현**: `protocols/llm-ingest-info.ts`

### 2. Query Endpoint (지원)

- **역할**: 검색/조회 (자연어 쿼리 → content, metadata, schema_markup, billing 반환)
- **엔드포인트**: `POST /llm-ingest`
- **인증**: 헤더 자격증명 필요
- **응답 포맷**: `Content-Type: application/json` (JSON 봉투)
- **응답 필드**: `content`, `metadata`, `schema_markup`, `billing`
- **구현**: `protocols/llm-ingest.ts`

### 3. Bidding Endpoint · 4. Logging Endpoint

- 추후 지원 예정.

## Crawler (R2 Page)

- **역할**: R2 버킷 단일 페이지/목록 조회 (프로토콜 스펙 없음, 내부 API)
- **엔드포인트**: `GET /page?url=...&format=...`, `GET /pages`
- **응답**: format에 따라 HTML 원문, Markdown, JSON-LD 또는 키 목록
