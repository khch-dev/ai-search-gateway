---
title: 'OAuth 2.0 Authentication for Search Gateway & Host'
slug: 'oauth2-auth'
created: '2026-02-13'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Cloudflare Workers (Hono)', 'Next.js 15 (Edge Runtime)', 'TypeScript 5.7', 'Web Crypto API']
files_to_modify: ['search-gateway/src/index.ts', 'search-gateway/src/middleware/jwt-auth.ts', 'search-gateway/.dev.vars', 'search-gateway/wrangler.toml', 'search-host/src/app/lib/gateway-auth.ts', 'search-host/src/app/api/search/route.ts', 'search-host/src/app/api/page/route.ts', 'search-host/src/app/api/pages/route.ts']
code_patterns: ['Hono middleware (Context, Next) → Promise<Response | void>', 'Module-level cache with TTL (credentials.ts pattern)', 'Edge Runtime API routes (export const runtime = edge)', 'Env type bindings in index.ts']
test_patterns: ['vitest with describe/it/expect', 'tests/ directory at package root', 'Mock data + unit assertions']
---

# Tech-Spec: OAuth 2.0 Authentication for Search Gateway & Host

**Created:** 2026-02-13

## Overview

### Problem Statement

Currently search-gateway and search-host have no authentication mechanism. The only security boundaries are CORS (browser-enforced `SEARCH_HOST_ORIGIN`) and IP-based rate limiting (60 req/min, in-memory). Any caller that passes CORS can invoke all gateway endpoints freely. An OAuth 2.0 based authentication layer is needed to protect the gateway from unauthorized access.

### Solution

Implement OAuth 2.0 Client Credentials flow between search-host and auth server (`https://auth.nhnace-ai.com`). Client credentials (`client_id`/`client_secret`) are pre-registered once out-of-band and stored as search-host environment variables. At runtime, search-host acquires JWT access tokens via `/token` using these credentials and caches tokens in module-level memory (best-effort; re-acquired on isolate cold start). search-gateway validates incoming JWT tokens using a shared `JWT_SECRET` (HMAC symmetric key via Web Crypto API). Requests without valid tokens receive an auth error response with the auth URL.

**Architectural Decision — No Session/KV Layer:** Client Credentials tokens are service-level (not per-user). The access token lives exclusively in search-host API route handlers and never reaches the browser. Adding a session cookie → KV → token lookup layer would introduce CF Pages KV binding complexity, module-level state persistence issues, and additional latency for zero security benefit. If per-user auth is needed in the future, an Authorization Code flow with sessions should be implemented as a separate spec.

### Scope

**In Scope:**
- Pre-registration: One-time manual `/register` call (`client_name = "nhnace-ai-search-test"`) → store credentials as env vars
- search-host: Client Credentials token acquisition (`/token`) → JWT access token (module-level memory cache)
- search-host: `Authorization: Bearer <token>` header injection on all gateway requests
- search-gateway: JWT validation middleware (HMAC verification with shared `JWT_SECRET` via Web Crypto API)
- search-gateway: Auth error response with auth URL when token is missing/invalid
- search-gateway: `JWT_SECRET` secure storage (`.dev.vars` / Cloudflare Secrets)
- search-gateway: CORS `Access-Control-Allow-Headers` update to include `Authorization`

**Out of Scope:**
- User-facing login/logout UI (Client Credentials is service-level auth)
- Auth server implementation/modification
- Role-based access control (RBAC)
- Per-user session management / session cookies (see Architectural Decision above)
- Token revocation (future consideration)

## Context for Development

### Codebase Patterns

**Gateway Middleware Pattern** (from `rate-limit.ts`):
- Signature: `async function middleware(c: Context, next: Next): Promise<Response | void>`
- Early return `c.json(...)` to reject, or `return next()` to pass through
- Registered via `app.use('*', middleware)` in `index.ts`

**Gateway Env Type** (from `index.ts`):
- All bindings/vars declared in `Env` type: `{ SEARCH_HOST_ORIGIN, KV_CREDENTIALS, R2_AI_SEARCH, CF_* }`
- New: `JWT_SECRET: string` and `AUTH_SERVER_URL: string` will be added

**Credentials Caching Pattern** (from `credentials.ts`):
- Module-level cache with TTL (5 min)
- Pattern: `let cached; let cacheExpiresAt; if (now < cacheExpiresAt) return cached;`
- Same pattern for CryptoKey caching (gateway) and token caching (host)
- **CF Pages caveat**: Module-level state is best-effort — each request may be a fresh isolate. Cache miss simply triggers re-acquisition (~100ms for `/token` call)

**Search-Host API Route Pattern**:
- `export const runtime = 'edge';`
- `export async function GET/POST(request): Promise<Response>`
- Gateway URL from `process.env['GATEWAY_URL']`
- All 3 routes (`search`, `page`, `pages`) share the same proxy pattern
- **Note**: `pages/route.ts` `GET()` currently lacks `request` parameter — must be added for auth header access

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `search-gateway/src/index.ts` | Hono app, middleware chain, route definitions, `Env` type |
| `search-gateway/src/middleware/rate-limit.ts` | Reference middleware pattern for JWT auth |
| `search-gateway/src/core/credentials.ts` | Reference caching pattern (module-level cache + TTL) |
| `search-gateway/wrangler.toml` | `[vars]` for `AUTH_SERVER_URL`; `JWT_SECRET` via wrangler secret only |
| `search-gateway/.dev.vars` | Local dev secrets (`JWT_SECRET`) |
| `search-host/src/app/api/search/route.ts` | Main proxy — MCP streaming + non-streaming paths, inject `Authorization` |
| `search-host/src/app/api/page/route.ts` | Page proxy — simple GET, inject `Authorization` |
| `search-host/src/app/api/pages/route.ts` | Pages list proxy — simple GET, inject `Authorization` (fix: add `request` param) |
| `search-host/src/app/components/SearchForm.tsx` | UI — calls `/api/pages` (no changes needed; auth is server-side) |

### Technical Decisions

- **Grant Type:** Client Credentials (RFC 6749 §4.4) — service-to-service, no user login
- **Client Registration:** One-time manual registration via `curl` or script → `client_id`/`client_secret` stored as search-host env vars (`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`). NOT done at runtime.
- **JWT Signing:** HMAC symmetric key (`JWT_SECRET`) shared between auth server and gateway
- **JWT Verification:** Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.verify`) — `jsonwebtoken` etc. Node.js libs NOT available in Workers
  - **Base64URL decode**: Must restore padding (`=`) before `atob()`: `s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)`
  - **Claims validation**: Verify `alg === 'HS256'` (header), `exp > now` (payload). Optionally validate `iss`, `aud` if auth server sets them.
- **No Session Layer:** Tokens cached in module-level memory in search-host. No KV, no cookies, no session management. (See Architectural Decision in Overview.)
- **Auth Server:** `https://auth.nhnace-ai.com` (register: `/register`, token: `/token`)
- **JWT_SECRET Storage:** `wrangler secret put JWT_SECRET` for prod, `.dev.vars` for local dev (NEVER in `wrangler.toml [vars]`)
- **Token Lifecycle:** Module-level cache with preemptive refresh 5 min before `exp`; on 401 from gateway → re-acquire token → retry once. In-flight promise dedup prevents concurrent `/token` calls.
- **Auth Middleware Position:** CORS → Rate Limit → **JWT Auth** → Logging
- **Auth Exceptions:** `GET /health` accessible without auth (path array for extensibility)
- **CORS Update:** Add `Authorization` to `Access-Control-Allow-Headers`
- **Error Response Format:**
  - MCP endpoints (`/mcp`, `/nlweb/mcp`): `{jsonrpc: "2.0", id: null, error: {code: -32001, message: "Authentication required", data: {auth_url: "https://auth.nhnace-ai.com"}}}`
  - REST endpoints: HTTP 401 + `{error: "Authentication required", auth_url: "https://auth.nhnace-ai.com"}`
  - **Security**: Error messages must NOT reveal JWT validation details (generic "Invalid or expired token" only)

## Implementation Plan

### Tasks

- [x] **Task 1: Pre-register client and configure environment variables**
  - Action (manual, one-time):
    ```bash
    curl -X POST https://auth.nhnace-ai.com/register \
      -H 'Content-Type: application/json' \
      -d '{"client_name": "nhnace-ai-search-test"}'
    ```
    → Save returned `client_id` and `client_secret`
  - File: `search-host/.env.local`
  - Action: Add `OAUTH_CLIENT_ID=<returned_id>`, `OAUTH_CLIENT_SECRET=<returned_secret>`, `AUTH_SERVER_URL=https://auth.nhnace-ai.com`
  - File: `search-gateway/wrangler.toml`
  - Action: Add `AUTH_SERVER_URL = "https://auth.nhnace-ai.com"` to `[vars]` section. Do NOT add JWT_SECRET here.
  - File: `search-gateway/.dev.vars`
  - Action: Add `JWT_SECRET=<shared-secret-value>` for local development
  - Notes:
    - Production: `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` via CF Pages env vars; `JWT_SECRET` via `wrangler secret put JWT_SECRET`
    - Registration is idempotent (same `client_name` returns existing credentials) — re-run if lost

- [x] **Task 2: Add `JWT_SECRET` and `AUTH_SERVER_URL` to gateway Env type**
  - File: `search-gateway/src/index.ts`
  - Action: Add `JWT_SECRET: string` and `AUTH_SERVER_URL: string` to the `Env` type

- [x] **Task 3: Create JWT auth middleware for gateway**
  - File: `search-gateway/src/middleware/jwt-auth.ts` (NEW)
  - Action: Create Hono middleware that:
    1. Skips requests matching exempt paths (`AUTH_EXEMPT_PATHS = ['/health']`)
    2. Extracts `Authorization: Bearer <token>` header
    3. If missing/malformed: returns auth error response
       - For paths `/mcp` or `/nlweb/mcp`: JSON-RPC 2.0 error format `{jsonrpc: "2.0", id: null, error: {code: -32001, message: "Authentication required", data: {auth_url}}}`
       - For all other paths: HTTP 401 + JSON `{error: "Authentication required", auth_url}`
    4. Parses JWT: split by `.` → validate `alg === 'HS256'` in header
    5. Base64URL decode with padding restoration: `s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)` → `atob` → `Uint8Array`
    6. Verifies HMAC-SHA256 signature using `crypto.subtle.verify` with `c.env.JWT_SECRET`
    7. Checks `exp > Date.now() / 1000` (reject if expired)
    8. Caches `CryptoKey` at module level — invalidate when `JWT_SECRET` value changes (compare cached secret string)
    9. On valid token: calls `next()`
    10. On any validation error: returns generic "Invalid or expired token" (no internal details)
  - Notes:
    - CryptoKey cache: `let cachedKey: CryptoKey | null; let cachedKeySecret: string;` — re-import only when secret changes
    - `crypto.subtle.importKey('raw', keyData, {name: 'HMAC', hash: 'SHA-256'}, false, ['verify'])`
    - `crypto.subtle.verify('HMAC', key, signatureBytes, dataBytes)` where `dataBytes = encoder.encode(header.payload)`

- [x] **Task 4: Register JWT auth middleware and update CORS in gateway**
  - File: `search-gateway/src/index.ts`
  - Action:
    1. Import `jwtAuthMiddleware` and add `app.use('*', jwtAuthMiddleware)` between rate limit and logging middleware:
       ```
       app.use('*', cors...)       // existing — update allowHeaders
       app.use('*', rateLimit...)  // existing
       app.use('*', jwtAuth...)    // NEW — after rate limit, before logging
       app.use('*', logging...)    // existing
       ```
    2. Update CORS config to include `Authorization` in `Access-Control-Allow-Headers`

- [x] **Task 5: Create gateway auth module for search-host**
  - File: `search-host/src/app/lib/gateway-auth.ts` (NEW)
  - Action: Create module for OAuth 2.0 Client Credentials token acquisition:
    1. `acquireToken()`: POST to `${AUTH_SERVER_URL}/token` with `grant_type=client_credentials&client_id=...&client_secret=...` (`application/x-www-form-urlencoded` per RFC 6749). Returns `{access_token, token_type, expires_in}`.
    2. `getAccessToken()`: Public function — checks module-level cached token. If missing or within 5 min of `exp`, calls `acquireToken()`. Uses in-flight promise dedup to prevent concurrent `/token` calls.
    3. `invalidateToken()`: Clears cached token (called on 401 retry).
    4. Module-level state: `cachedToken: string | null`, `tokenExpiresAt: number`, `inflightPromise: Promise<string> | null`
  - Notes:
    - `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` / `AUTH_SERVER_URL` from `process.env`
    - Edge Runtime compatible — only `fetch` and standard APIs
    - Cache miss on cold start: one `/token` call (~100ms)
    - Token refresh: `Date.now() / 1000 > tokenExpiresAt - 300` (5 min buffer)

- [x] **Task 6: Inject Authorization header in search/route.ts**
  - File: `search-host/src/app/api/search/route.ts`
  - Action:
    1. Import `getAccessToken`, `invalidateToken` from `../../lib/gateway-auth`
    2. At start of `POST` handler: call `getAccessToken()` to get token
    3. Add `Authorization: Bearer ${token}` to all `fetch()` calls to gateway:
       - MCP streaming path: `baseHeaders['Authorization'] = ...`
       - MCP non-streaming path: `baseHeaders['Authorization'] = ...`
       - NLWeb/LLM-Ingest path: `requestHeaders['Authorization'] = ...`
    4. On 401 from gateway (non-streaming paths): call `invalidateToken()` → `getAccessToken()` → retry once → if still 401, return error to client
  - Notes:
    - **MCP streaming path (NDJSON)**: Pre-validate token freshness before starting stream. If 401 occurs mid-stream, emit `{type: 'error', message: 'Authentication failed'}` — cannot retry an active stream.
    - Non-streaming MCP and NLWeb/LLM-Ingest: standard retry-once pattern

- [x] **Task 7: Inject Authorization header in page/route.ts**
  - File: `search-host/src/app/api/page/route.ts`
  - Action:
    1. Import `getAccessToken`, `invalidateToken` from `../../lib/gateway-auth`
    2. Call `getAccessToken()` at start of `GET` handler
    3. Add `Authorization: Bearer ${token}` to the gateway `fetch()` call
    4. On 401: `invalidateToken()` → retry once

- [x] **Task 8: Inject Authorization header in pages/route.ts (+ fix handler signature)**
  - File: `search-host/src/app/api/pages/route.ts`
  - Action:
    1. **Fix**: Add `request: Request` parameter to `GET()` handler (currently missing)
    2. Import `getAccessToken`, `invalidateToken` from `../../lib/gateway-auth`
    3. Call `getAccessToken()` at start of `GET` handler
    4. Add `Authorization: Bearer ${token}` to the gateway `fetch()` call
    5. On 401: `invalidateToken()` → retry once

- [x] **Task 9: Write gateway JWT middleware tests**
  - File: `search-gateway/tests/jwt-auth.test.ts` (NEW)
  - Action: vitest unit tests covering:
    - Valid JWT (HS256) → `next()` called (200)
    - Missing `Authorization` header → 401 with `auth_url`
    - Malformed token (not 3 parts) → 401
    - Wrong algorithm (e.g., `alg: 'none'`) → 401
    - Expired token (`exp` in past) → 401
    - Invalid HMAC signature → 401
    - `/health` path → bypasses auth (200)
    - `/mcp` path → JSON-RPC 2.0 error format on auth failure
    - Non-MCP path → standard HTTP 401 JSON on auth failure
    - CryptoKey cache reuse (same secret → no re-import)
  - Notes: Generate real test JWTs using Web Crypto API in test setup (sign with known test secret)

### Acceptance Criteria

- [x] **AC 1:** Given a request to gateway with valid HS256 JWT in `Authorization: Bearer <token>` header, when the signature is valid and `exp > now`, then the request is processed normally (200/JSON response).

- [x] **AC 2:** Given a request to gateway without `Authorization` header, when the request hits any endpoint except `/health`, then the gateway returns HTTP 401 with `{error: "Authentication required", auth_url: "https://auth.nhnace-ai.com"}`.

- [x] **AC 3:** Given a request to `/mcp` or `/nlweb/mcp` without valid token, when the gateway rejects, then it returns JSON-RPC 2.0 error `{jsonrpc: "2.0", id: null, error: {code: -32001, message: "Authentication required", data: {auth_url: "https://auth.nhnace-ai.com"}}}` with HTTP 401.

- [x] **AC 4:** Given a request to `/health`, when no Authorization header is present, then the gateway returns `{status: "ok"}` (200) without auth check.

- [x] **AC 5:** Given a JWT with expired `exp` claim, when the gateway validates, then it returns 401 with generic error message (no JWT internals exposed).

- [x] **AC 6:** Given a JWT with tampered signature or `alg !== 'HS256'`, when the gateway verifies, then it returns 401.

- [x] **AC 7:** Given search-host cold start (no cached token), when the first API request arrives, then search-host calls `/token` with pre-configured `client_id`/`client_secret` to acquire an access token, caches it in memory, and injects it as `Authorization: Bearer <token>` on the gateway request.

- [x] **AC 8:** Given a cached token in search-host memory, when subsequent API requests are made within token validity, then search-host reuses the cached token without calling `/token` again.

- [x] **AC 9:** Given a cached token that will expire within 5 minutes, when an API request is made, then search-host proactively acquires a new token before the old one expires.

- [x] **AC 10:** Given a gateway returns 401 to search-host (non-streaming), when the token has expired, then search-host invalidates the cached token, re-acquires via `/token`, and retries the request once.

- [x] **AC 11:** Given a CORS preflight (OPTIONS) request with `Access-Control-Request-Headers: Authorization`, when the gateway responds, then `Access-Control-Allow-Headers` includes `Authorization`.

## Additional Context

### Dependencies

**No new npm packages required for either package.**

**search-gateway:**
- Web Crypto API (`crypto.subtle.importKey`, `crypto.subtle.verify`) — built-in Workers global
- `atob()` — built-in Workers global for base64 decoding (with padding restoration)

**search-host:**
- `fetch()` — built-in Edge Runtime for auth server `/token` calls

**Infrastructure:**
- `wrangler secret put JWT_SECRET` on gateway — must match auth server's HMAC signing secret
- `AUTH_SERVER_URL=https://auth.nhnace-ai.com` in gateway `wrangler.toml [vars]` and search-host env vars
- `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` in search-host env vars (CF Pages settings for prod, `.env.local` for dev)
- One-time manual client registration via curl (Task 1)

### Testing Strategy

**Unit Tests (vitest — search-gateway):**
- `tests/jwt-auth.test.ts`: JWT parsing, base64url decode (including padding edge cases), signature verification, expiry check, alg validation, path exemption, error format (REST vs JSON-RPC)
- Generate test JWTs using Web Crypto API in test setup (sign with known test secret)
- Mock Hono Context for middleware testing

**Manual Testing:**
1. Start gateway without JWT_SECRET → verify all requests return 401
2. Set JWT_SECRET in `.dev.vars` → restart
3. Register client: `curl -X POST https://auth.nhnace-ai.com/register -H 'Content-Type: application/json' -d '{"client_name": "nhnace-ai-search-test"}'`
4. Acquire token: `curl -X POST https://auth.nhnace-ai.com/token -d 'grant_type=client_credentials&client_id=<id>&client_secret=<secret>'`
5. Test with valid token: `curl -H "Authorization: Bearer <token>" <gateway_url>/health`
6. Test expired token → verify 401
7. Test `/health` without token → verify 200
8. Test search-host full flow: browser → search-host acquires token → gateway accepts

### Notes

**High-Risk Items:**
- **Module-level cache on CF Pages**: Best-effort only. Each request may be a fresh V8 isolate. Cold start penalty: one `/token` call (~100ms). Acceptable for Client Credentials flow.
- **MCP streaming 401 handling**: If token expires mid-stream, the stream is already open and cannot be retried. Mitigation: pre-check token freshness (require 5+ min remaining) before starting stream. If 401 occurs anyway, emit `{type: 'error'}` NDJSON line.
- **Logging sanitization**: Ensure `console.log` in gateway/host never prints `JWT_SECRET`, `OAUTH_CLIENT_SECRET`, or full Bearer token values. Log only token prefix (first 8 chars) for debugging.

**Known Limitations:**
- Client Credentials tokens are service-level, not user-level. All browser users share the same underlying access token.
- Module-level caches reset on Worker/isolate restart. After cold start, first request triggers `/token` call (added latency ~100ms).
- JWT algorithm is hardcoded HS256. If auth server changes to HS384/HS512, the `hash` parameter in `crypto.subtle.importKey` must be adjusted.
- No token revocation mechanism. Compromised tokens remain valid until `exp`.

**Future Considerations:**
- Per-user tokens via Authorization Code flow + session cookies (separate spec)
- Token revocation endpoint integration
- JWT_SECRET rotation strategy (dual-key verification during rotation window)
- `refresh_token` support if auth server provides it

## Review Notes

- Adversarial review completed (2026-02-20)
- Findings: 10개 total, 7개 fixed (F1~F5, F7, F9), 3개 skipped (noise: F6, F8, F10)
- Resolution approach: auto-fix
- Additional fixes applied post-review:
  - F1: page/route.ts, pages/route.ts 401 retry 시 try-catch 추가
  - F2/F5: 비스트리밍 MCP callRes 401 retry 추가
  - F3/F7: Env.AUTH_SERVER_URL optional 타입으로 변경
  - F4: /token fetch 5초 timeout 추가
  - F9: jwt-auth.ts 검증 실패 디버그 로그 추가

### Adversarial Review Resolution

| Finding | Severity | Resolution |
|---------|----------|------------|
| F1: Module-level state non-persistent | Critical | **Resolved** — Removed session/KV dependency. Token cached best-effort in memory; cold start → 1x `/token` call (~100ms) |
| F2: Registration repeats / no idempotency | Critical | **Resolved** — Registration moved to one-time manual step (Task 1). Credentials stored as env vars. |
| F3: KV access from search-host unresolved | Critical | **Resolved** — KV layer entirely removed. No KV needed on search-host. |
| F4: Session layer unnecessary complexity | High | **Resolved** — Session layer removed. (See Architectural Decision) |
| F5: Base64URL padding missing | High | **Resolved** — Explicit padding restoration added to Task 3 spec. |
| F6: Streaming 401 retry impossible | High | **Resolved** — Pre-check token freshness before stream; emit error event if 401 mid-stream (Task 6 notes). |
| F7: Missing JWT claims validation | High | **Resolved** — `alg` validation added to Task 3; `exp` already specified; `iss`/`aud` optional. |
| F8: No token revocation | High | **Deferred** — Documented as known limitation + future consideration. |
| F9: pages/route.ts missing request param | High | **Resolved** — Task 8 explicitly fixes handler signature. |
| F10: CORS Authorization header | Medium | **Resolved** — Task 4 adds Authorization to allowed headers. |
| F11: Auth exempt paths hardcoded | Medium | **Resolved** — Changed to configurable array `AUTH_EXEMPT_PATHS`. |
| F12: MCP vs REST error format | Medium | **Already handled** — Dual format specified in Task 3 and AC 2/3. |
| F13: Token acquisition race condition | Medium | **Resolved** — In-flight promise dedup in Task 5. |
| F14: JWT_SECRET rotation | Medium | **Deferred** — Future consideration. |
| F15: Error message info leakage | Medium | **Resolved** — Generic error messages specified in Task 3 step 10. |
| F16: Integration tests missing | Medium | **Acknowledged** — Manual testing strategy covers E2E. |
| F17: Environment config separation | Medium | **Acknowledged** — `.dev.vars` / `.env.local` for dev, CF dashboard for prod. |
| F18: crypto.subtle availability | Medium | **Acknowledged** — Available in Workers + vitest (Node 20+). |
| F19: Session/token TTL mismatch | Medium | **N/A** — Session layer removed. |
| F20: Content-Type validation | Medium | **Deferred** — Not auth-specific; existing routes already validate body. |
| F21: Logging token exposure | Medium | **Resolved** — Added to High-Risk Items notes. |
| F22-F27 | Low | **Acknowledged** — Minor items; addressed where applicable in spec. |
