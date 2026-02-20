# MCP 스펙 준수 검토 (2025-11-25 Schema)

참조: [Schema Reference](https://modelcontextprotocol.io/specification/2025-11-25/schema)

## 1. 검토 범위

- **MCP Server**: search-gateway (`/mcp`, `McpServer` + `WebStandardStreamableHTTPServerTransport`)
- **MCP Host(Client)**: search-host (`/api/search` when `protocol === 'mcp'`, `Client` + `StreamableHTTPClientTransport`)

## 2. JSON-RPC 2.0

| 항목 | 스펙 | search-gateway | search-host |
|------|------|----------------|-------------|
| 성공 응답 | `JSONRPCResultResponse`: `jsonrpc`, `id`, `result` | SDK가 SSE/HTTP로 전송 (직접 구현 없음) | ✅ `{ jsonrpc: '2.0', id, result }` 반환 |
| 에러 응답 | `JSONRPCErrorResponse`: `jsonrpc`, `id?`, `error: { code, message, data? }` | SDK가 처리 | ✅ tool `isError` 시 `{ jsonrpc, id: null, error: { code: -32000, message } }`<br>✅ catch 시 `{ jsonrpc, id: null, error: { code: -32603, message } }` (수정 반영) |
| RequestId | `string \| number` | SDK 사용 | ✅ `crypto.randomUUID()` (string) |

## 3. tools/call

| 항목 | 스펙 | search-gateway | search-host |
|------|------|----------------|-------------|
| 요청 | `CallToolRequest`: method `tools/call`, params `{ name, arguments? }` | SDK Client가 전송 | ✅ `client.callTool({ name: 'search', arguments: { query, format } })` |
| 성공 결과 | `CallToolResult`: `content: ContentBlock[]`, `structuredContent?`, `isError?` | ✅ `{ content: [{ type: 'text', text }] }` 반환 (TextContent) | SDK가 반환한 result를 그대로 봉투에 담아 전달 |
| 에러 결과 | `CallToolResult` with `isError: true` | SDK/핸들러 예외 시 SDK 처리 | ✅ `result.isError` 시 JSON-RPC error로 변환하여 반환 |

## 4. 기타

- **initialize / notifications/initialized**: SDK가 자동 처리 (search-host `client.connect(transport)`, search-gateway `transport.handleRequest`).
- **ContentBlock**: Server 툴 반환은 `TextContent` (`type: 'text'`, `text: string`)만 사용 → 스펙 준수.

## 5. 수정 사항 (이번 검토에서 반영)

- **search-host** MCP 브랜치 `catch` 블록: 예외 시 기존 `{ error: msg }` 응답을 스펙에 맞게 `{ jsonrpc: '2.0', id: null, error: { code: -32603, message: msg } }` 로 변경함. (`-32603` = Internal error)

## 6. 결론

- **search-gateway**: MCP Server 역할은 `@modelcontextprotocol/sdk`에 위임하며, 툴 반환 형식(`CallToolResult`, `TextContent`)은 스펙 준수.
- **search-host**: MCP 클라이언트로 서버와 통신한 뒤, **브라우저에 돌려줄 때** JSON-RPC 2.0 봉투(`jsonrpc`, `id`, `result` 또는 `error`)를 사용하도록 되어 있으며, 예외 시에도 동일한 에러 봉투를 사용하도록 수정 완료.
