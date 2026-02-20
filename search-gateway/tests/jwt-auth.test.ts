import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jwtAuthMiddleware } from '../src/middleware/jwt-auth';
import type { Context, Next } from 'hono';
import type { Env } from '../src/index';

// ─── 테스트용 JWT 서명 헬퍼 ─────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-key-for-vitest-2026';

/** Base64URL 인코딩 (no padding) */
function b64url(obj: object): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** 임의 헤더/페이로드로 HS256 JWT 생성 */
async function signJwt(
  payload: object,
  secret = TEST_SECRET,
  headerOverride?: object,
): Promise<string> {
  const header = headerOverride ?? { alg: 'HS256', typ: 'JWT' };
  const headerB64 = b64url(header);
  const payloadB64 = b64url(payload);
  const data = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${sigB64}`;
}

/** 기본 유효 페이로드 (만료 1시간 후) */
function validPayload(overrides: object = {}): object {
  return {
    sub: 'test-client',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

// ─── Hono Context 모킹 ───────────────────────────────────────────────────────

function makeContext(
  path: string,
  authHeader?: string,
  envOverrides?: Partial<Env>,
): { ctx: Context<{ Bindings: Env }>; next: Next } {
  const env: Env = {
    SEARCH_HOST_ORIGIN: 'https://search-host.pages.dev',
    KV_CREDENTIALS: {} as KVNamespace,
    R2_AI_SEARCH: {} as R2Bucket,
    JWT_SECRET: TEST_SECRET,
    AUTH_SERVER_URL: 'https://auth.nhnace-ai.com',
    ...envOverrides,
  };

  const next = vi.fn().mockResolvedValue(undefined) as Next;

  const ctx = {
    req: {
      path,
      header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
    },
    env,
    json: (body: unknown, status: number = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  } as unknown as Context<{ Bindings: Env }>;

  return { ctx, next };
}

async function parseResponse(res: Response | void): Promise<{ status: number; body: unknown }> {
  if (!res) return { status: 200, body: null }; // next() が呼ばれた場合
  const body = await res.json();
  return { status: res.status, body };
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe('jwtAuthMiddleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // CryptoKey 캐시 초기화: 모듈 리셋 없이 비밀키를 변경해 캐시 무효화
    // (테스트 격리를 위해 각 테스트는 동일한 TEST_SECRET 사용)
  });

  // ── 정상 케이스 ──────────────────────────────────────────────────────────────

  it('유효한 HS256 JWT → next() 호출 (200 통과)', async () => {
    const token = await signJwt(validPayload());
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${token}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(result).toBeUndefined(); // next() 호출 → middleware가 undefined 반환
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 면제 경로 ────────────────────────────────────────────────────────────────

  it('/health 경로 → Authorization 헤더 없이도 통과', async () => {
    const { ctx, next } = makeContext('/health');

    const result = await jwtAuthMiddleware(ctx, next);

    expect(result).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  // ── Authorization 헤더 누락 ──────────────────────────────────────────────────

  it('Authorization 헤더 없음 → 401 (auth_url 포함)', async () => {
    const { ctx, next } = makeContext('/llm-ingest', undefined);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    expect((body as Record<string, unknown>)['auth_url']).toBe('https://auth.nhnace-ai.com');
    expect((body as Record<string, unknown>)['error']).toBe('Authentication required');
  });

  it('Authorization 헤더가 "Bearer " 형식 아님 → 401', async () => {
    const { ctx, next } = makeContext('/page', 'Token sometoken');

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  // ── 잘못된 토큰 형식 ─────────────────────────────────────────────────────────

  it('토큰이 3파트 아님 (malformed) → 401', async () => {
    const { ctx, next } = makeContext('/llm-ingest', 'Bearer notavalidjwt');

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    expect((body as Record<string, unknown>)['error']).toBe('Invalid or expired token');
  });

  // ── alg 검증 ────────────────────────────────────────────────────────────────

  it('alg !== HS256 (예: none) → 401', async () => {
    const token = await signJwt(validPayload(), TEST_SECRET, { alg: 'none', typ: 'JWT' });
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${token}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  it('alg === RS256 → 401', async () => {
    const token = await signJwt(validPayload(), TEST_SECRET, { alg: 'RS256', typ: 'JWT' });
    const { ctx, next } = makeContext('/page', `Bearer ${token}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  // ── exp 검증 ────────────────────────────────────────────────────────────────

  it('만료된 토큰 (exp 과거) → 401 (내부 세부사항 미노출)', async () => {
    const token = await signJwt(validPayload({ exp: Math.floor(Date.now() / 1000) - 60 }));
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${token}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    // 보안: 에러 메시지에 JWT 내부 정보(claim 이름, alg 등) 미포함
    expect((body as Record<string, unknown>)['error']).toBe('Invalid or expired token');
    // JSON 키로서의 "exp" claim 이름이 노출되지 않음
    expect(JSON.stringify(body)).not.toContain('"exp"');
    expect(JSON.stringify(body)).not.toContain('HS256');
  });

  // ── 서명 검증 ────────────────────────────────────────────────────────────────

  it('잘못된 HMAC 서명 → 401', async () => {
    const token = await signJwt(validPayload(), 'wrong-secret-key');
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${token}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  it('서명 파트 변조 → 401', async () => {
    const token = await signJwt(validPayload());
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.invalidsignatureXXX`;
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${tampered}`);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  // ── MCP 경로 에러 포맷 ───────────────────────────────────────────────────────

  it('/mcp 경로 인증 실패 → JSON-RPC 2.0 에러 포맷', async () => {
    const { ctx, next } = makeContext('/mcp', undefined);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    const b = body as Record<string, unknown>;
    expect(b['jsonrpc']).toBe('2.0');
    expect(b['id']).toBeNull();
    const error = b['error'] as Record<string, unknown>;
    expect(error['code']).toBe(-32001);
    expect(error['message']).toBe('Authentication required');
    expect((error['data'] as Record<string, unknown>)['auth_url']).toBe('https://auth.nhnace-ai.com');
  });

  it('/nlweb/mcp 경로 인증 실패 → JSON-RPC 2.0 에러 포맷', async () => {
    const { ctx, next } = makeContext('/nlweb/mcp', undefined);

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    const b = body as Record<string, unknown>;
    expect(b['jsonrpc']).toBe('2.0');
  });

  // ── REST 경로 에러 포맷 ──────────────────────────────────────────────────────

  it('REST 경로(/page) 인증 실패 → 표준 HTTP 401 JSON', async () => {
    const { ctx, next } = makeContext('/page', undefined);

    const result = await jwtAuthMiddleware(ctx, next);

    const { status, body } = await parseResponse(result);
    expect(status).toBe(401);
    const b = body as Record<string, unknown>;
    expect(b['error']).toBe('Authentication required');
    expect(b['auth_url']).toBeDefined();
    // JSON-RPC 필드 없음
    expect(b['jsonrpc']).toBeUndefined();
  });

  // ── JWT_SECRET 미설정 ────────────────────────────────────────────────────────

  it('JWT_SECRET 미설정 시 모든 요청 거부', async () => {
    const token = await signJwt(validPayload());
    const { ctx, next } = makeContext('/llm-ingest', `Bearer ${token}`, {
      JWT_SECRET: '' as string,
    });

    const result = await jwtAuthMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const { status } = await parseResponse(result);
    expect(status).toBe(401);
  });

  // ── CryptoKey 캐시 ───────────────────────────────────────────────────────────

  it('동일 시크릿으로 연속 요청 시 CryptoKey 재사용 (importKey 1회만 호출)', async () => {
    const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');

    const token1 = await signJwt(validPayload());
    const token2 = await signJwt(validPayload());

    const { ctx: ctx1, next: next1 } = makeContext('/llm-ingest', `Bearer ${token1}`);
    const { ctx: ctx2, next: next2 } = makeContext('/page', `Bearer ${token2}`);

    await jwtAuthMiddleware(ctx1, next1);
    // 첫 번째 호출 이후 importKey 호출 횟수 기록
    const callsAfterFirst = importKeySpy.mock.calls.length;

    await jwtAuthMiddleware(ctx2, next2);
    // 두 번째 호출에서 추가 importKey 없음
    expect(importKeySpy.mock.calls.length).toBe(callsAfterFirst);
    expect(next1).toHaveBeenCalled();
    expect(next2).toHaveBeenCalled();
  });
});
