# AI Search Gateway & Host

Cloudflare AutoRAG를 백엔드로 하는 다중 프로토콜 검색 게이트웨이와 웹 인터페이스.

## 아키텍처

```
[Browser]
    │ POST /api/search
    ▼
[search-host] Next.js on Cloudflare Pages
    │ POST /mcp | /nlweb/ask | /llm-ingest
    │ Headers: X-CF-Account-ID, X-CF-API-Token, X-CF-Autorag-Name
    ▼
[search-gateway] Cloudflare Worker (Hono)
    │ POST https://api.cloudflare.com/client/v4/accounts/{id}/autorag/rags/{name}/search
    ▼
[Cloudflare AutoRAG]
```

## 지원 프로토콜

| 경로 | 프로토콜 | 응답 포맷 |
|------|---------|---------|
| `POST /mcp` | MCP (Model Context Protocol) | HTML / Markdown / JSON-LD |
| `POST /nlweb/ask` | NLWeb (custom extension) | JSON-LD 고정 |
| `POST /nlweb/mcp` | NLWeb MCP compat → `/mcp` 동일 처리 | HTML / Markdown / JSON-LD |
| `POST /llm-ingest` | IAB CMP LLM Ingest | JSON |

> **NLWeb 주의**: 공식 NLWeb 스펙 기반 custom extension 구현. Cloudflare native NLWeb 미사용.

## 모노레포 구조

```
/
├── search-gateway/   # Cloudflare Worker + Hono
├── search-host/      # Next.js + Cloudflare Pages
├── .gitignore
└── README.md
```

## 로컬 개발

### search-gateway

```bash
cd search-gateway
npm install
npm run dev          # wrangler dev → http://localhost:8787
```

**TASK-0: MCP SDK 호환성 검증** (첫 실행 시 필수):
```bash
# 1. StreamableHTTPServerTransport 동작 확인
curl http://localhost:8787/health
# → {"status":"ok"}

# 2. MCP SDK 호환 확인
npx @modelcontextprotocol/inspector http://localhost:8787/mcp

# 3. SDK 미호환 시 → src/protocols/mcp.ts에서 fallback 주석 해제
```

### search-host

```bash
cd search-host
npm install
cp .env.example .env.local
# .env.local에 GATEWAY_URL=http://localhost:8787 설정

npm run dev          # next dev → http://localhost:3000
```

## 테스트

### Formatter 단위 테스트

```bash
cd search-gateway
npm test             # vitest run
```

### Gateway 수동 테스트 (wrangler dev 실행 중)

```bash
# 헬스체크
curl http://localhost:8787/health

# NLWeb /ask
curl -X POST http://localhost:8787/nlweb/ask \
  -H "X-CF-Account-ID: YOUR_ACCOUNT_ID" \
  -H "X-CF-API-Token: YOUR_API_TOKEN" \
  -H "X-CF-Autorag-Name: YOUR_AUTORAG_NAME" \
  -H "Content-Type: application/json" \
  -d '{"query": "NHN"}'

# LLM Ingest
curl -X POST http://localhost:8787/llm-ingest \
  -H "X-CF-Account-ID: YOUR_ACCOUNT_ID" \
  -H "X-CF-API-Token: YOUR_API_TOKEN" \
  -H "X-CF-Autorag-Name: YOUR_AUTORAG_NAME" \
  -H "Content-Type: application/json" \
  -d '{"query": "NHN"}'

# Rate limit 테스트 (61회 연속)
for i in $(seq 1 61); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    http://localhost:8787/health
done
# 마지막 요청에서 429 확인
```

## 배포

> **⚠️ 배포 순서 중요: Gateway 먼저 → Host 이후**

### 1단계: search-gateway 배포

```bash
cd search-gateway
npm run deploy       # wrangler deploy
```

- 배포 후 Worker URL 메모: `https://search-gateway.your-subdomain.workers.dev`
- `wrangler.toml`의 `SEARCH_HOST_ORIGIN`을 실제 Pages URL로 업데이트 후 재배포

### 2단계: search-host 배포

```bash
# 1. Cloudflare Pages에 GitHub 레포 연결 (Dashboard에서)
# 2. Pages 환경변수 설정:
#    GATEWAY_URL = https://search-gateway.your-subdomain.workers.dev
# 3. 배포
cd search-host
npm run deploy
```

### AUTORAG_NAME 설정

코드 변경 없이 웹사이트 UI에서 직접 입력합니다:
1. 웹사이트 접속
2. "AutoRAG Name" 필드에 입력 (예: `crimson-shadow-a101`)
3. "기억하기" 체크 시 localStorage에 저장

## 보안 주의사항

- API Token은 브라우저 → `/api/search` API Route → Gateway 방식으로 전달 (브라우저에서 Gateway 직접 호출 없음)
- "기억하기" 기능은 localStorage에 **평문** 저장 — 공유 기기 사용 금지
- Gateway CORS는 search-host 도메인만 허용 (`SEARCH_HOST_ORIGIN` env var)
- Rate limiting: IP당 분당 60회 초과 시 HTTP 429 반환

## 환경변수

| 위치 | 변수 | 설명 |
|------|------|------|
| `search-gateway` wrangler.toml | `SEARCH_HOST_ORIGIN` | CORS 허용 origin |
| `search-host` .env.local | `GATEWAY_URL` | Gateway Worker URL |
