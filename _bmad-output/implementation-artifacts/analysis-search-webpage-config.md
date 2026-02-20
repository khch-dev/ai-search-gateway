# Search Webpage Configuration Analysis

**Date:** 2026-02-12  
**Scope:** search-host (Next.js) — 검색 웹페이지 구성

---

## 1. Overview

The search UI is a single-page flow: **protocol + format + query** → API call(s) → **SearchResults** (with optional raw gateway payload). It supports four protocols, three formats, and two input modes (text search vs. R2 key picker).

---

## 2. File Map

| File | Role |
|------|------|
| `src/app/page.tsx` | Home: state (loading, error, resultData, resultFormat), `handleSearch`, layout (header + SearchForm + SearchResults) |
| `src/app/components/SearchForm.tsx` | Protocol/format/query UI, Crawler R2 key fetch, submit → `onSearch(params)` |
| `src/app/components/SearchResults.tsx` | Renders loading/error/empty/result; shows **Gateway 응답 원문** when `_rawGatewayPayload` present |
| `src/app/api/search/route.ts` | POST: MCP (SDK client) vs NLWeb/LLM-Ingest (fetch proxy); attaches `_rawGatewayPayload` for non-MCP |
| `src/app/api/page/route.ts` | GET proxy to gateway `/page?url=&format=` (Crawler single page) |
| `src/app/api/pages/route.ts` | GET proxy to gateway `/pages` → `{ keys }` (Crawler key list) |
| `src/app/layout.tsx` | Root layout, metadata, globals.css |

---

## 3. Protocol & Data Flow

### 3.1 Protocols (SearchForm)

- **mcp** — Model Context Protocol: search-host uses MCP SDK Client → `StreamableHTTPClientTransport` → gateway `/mcp`; no credentials in request body (gateway uses KV/.dev.vars).
- **nlweb** — NLWeb: POST to `/api/search` → gateway `/nlweb/ask`; format forced to `json-ld`.
- **llm-ingest** — LLM Ingest (IAB CMP): POST to `/api/search` → gateway `/llm-ingest`.
- **crawler** — R2 page content: no `/api/search`; GET `/api/page?url=<key>&format=` and GET `/api/pages` for key list; gateway provides `/page` and `/pages`.

### 3.2 Request Paths by Protocol

| Protocol | Page.tsx | API route | Gateway path |
|----------|----------|-----------|---------------|
| crawler | `fetch(/api/page?url=...)` then early return | `api/page/route.ts` (GET) | `GATEWAY_URL/page`, `GATEWAY_URL/pages` |
| mcp | `fetch(/api/search)` POST | `api/search/route.ts` | `GATEWAY_URL/mcp` (MCP SDK) |
| nlweb | `fetch(/api/search)` POST | `api/search/route.ts` | `GATEWAY_URL/nlweb/ask` |
| llm-ingest | `fetch(/api/search)` POST | `api/search/route.ts` | `GATEWAY_URL/llm-ingest` |

### 3.3 Response Handling (page.tsx)

- **Crawler:** response text → `setResultData(JSON.parse(text) || text)` by format; no `_rawGatewayPayload`.
- **MCP:** expects `{ text: string }` from API; `setResultData(JSON.parse(text) || text)` by format; no raw payload section (API does not return `_rawGatewayPayload` for MCP).
- **NLWeb / LLM-Ingest:** full JSON from API (including `_rawGatewayPayload`) → `setResultData(result)`; SearchResults shows **Gateway 응답 원문** when `_rawGatewayPayload` exists.

---

## 4. API Route Behaviour (api/search/route.ts)

- **Body:** `{ protocol, format, query }` — no `accountId`, `apiToken`, `autoragName` (gateway holds credentials).
- **Validation:** `protocol` ∈ { mcp, nlweb, llm-ingest }, `format` ∈ { html, markdown, json-ld }, `query` non-empty.
- **MCP branch:** Uses `@modelcontextprotocol/sdk` Client + `StreamableHTTPClientTransport`; `client.callTool({ name: 'search', arguments: { query, format } })`; returns `NextResponse.json({ text })` (no `_rawGatewayPayload`).
- **NLWeb / LLM-Ingest:** `fetch(targetUrl, { body: { query, format } })`; response body parsed; then returns `{ ...responseData, _rawGatewayPayload: responseText }` (or `{ _rawGatewayPayload, _parsed }` when response is not an object).

---

## 5. SearchResults Layout

1. **Loading** — "검색 중..."
2. **Error** — error message box.
3. **No data** — null.
4. **Error-shaped object** (`code` + `message`) — API 오류 메시지.
5. **Empty** (empty string or empty array) — "검색 결과가 없습니다."
6. **Normal result:**
   - If `data._rawGatewayPayload` is a string: **Gateway 응답 원문** section (scrollable `<pre>`, maxHeight 40vh).
   - Then parsed content: HTML (sanitized), or Markdown/JSON-LD in `<pre>` from `displayData` (data without `_rawGatewayPayload`).

So **Gateway 응답 원문** is shown only for NLWeb and LLM-Ingest (where API attaches `_rawGatewayPayload`). MCP and Crawler do not expose this section.

---

## 6. SearchForm Details

- **Protocol:** `<select>` mcp | nlweb | llm-ingest | crawler.
- **Format:** Tabs html | markdown | json-ld; NLWeb forces json-ld.
- **Input:**
  - **Crawler:** `<select>` populated by GET `/api/pages` (R2 keys); submit = GET `/api/page?url=<key>&format=`.
  - **Others:** text `<input>` + 검색; submit = POST `/api/search` with `{ protocol, format, query }`.

---

## 7. Inconsistencies / Notes

1. **MCP vs NLWeb/LLM-Ingest:** MCP returns `{ text }` and does not add `_rawGatewayPayload`, so the "Gateway 응답 원문" block never appears for MCP. NLWeb/LLM-Ingest add `_rawGatewayPayload`, so the raw gateway response is visible only for those two.
2. **Crawler:** Bypasses `/api/search`; uses `/api/page` and `/api/pages`; no raw gateway payload in UI.
3. **Credentials:** Not sent from browser; gateway uses env/KV. Search route does not accept or forward accountId/apiToken/autoragName.
4. **page.tsx MCP handling:** Comment says "route.ts가 { text: string } 반환" — matches current API returning `{ text }` for MCP.

---

## 8. Summary Table

| Item | Value |
|------|--------|
| Protocols | mcp, nlweb, llm-ingest, crawler |
| Formats | html, markdown, json-ld (nlweb → json-ld only) |
| Credentials | Server-side only (gateway) |
| Raw payload on screen | Only for NLWeb & LLM-Ingest (`_rawGatewayPayload`) |
| MCP response shape | `{ text: string }` |
| Crawler entrypoints | GET `/api/pages`, GET `/api/page?url=&format=` |

This document reflects the **current** search webpage configuration as of the analysis date.
