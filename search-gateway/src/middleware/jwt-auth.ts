import type { Context, Next } from 'hono';
import type { Env } from '../index';

// 인증 면제 경로 목록 (확장 가능)
const AUTH_EXEMPT_PATHS = ['/health'];

// MCP 엔드포인트 경로 (JSON-RPC 2.0 에러 포맷 사용)
const MCP_PATHS = ['/mcp', '/nlweb/mcp'];

const AUTH_SERVER_URL_DEFAULT = 'https://auth.nhnace-ai.com';

// 모듈 레벨 CryptoKey 캐시 — isolate 재시작 시 재생성됨
let cachedKey: CryptoKey | null = null;
let cachedKeySecret = '';

/**
 * Base64URL → Uint8Array 변환 (padding 복원 포함)
 * RFC 4648 §5: '-' → '+', '_' → '/', padding '=' 복원
 */
function base64UrlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * JWT_SECRET 문자열로 CryptoKey를 가져옴 (모듈 레벨 캐시 사용)
 * 시크릿이 변경되면 재생성
 */
async function getCryptoKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeySecret === secret) {
    return cachedKey;
  }
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  cachedKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  cachedKeySecret = secret;
  return cachedKey;
}

/**
 * 경로에 따른 인증 오류 응답 반환
 * MCP 경로: JSON-RPC 2.0 에러 포맷
 * 그 외: HTTP 401 + JSON
 */
function authErrorResponse(c: Context, path: string, message: string, authUrl: string): Response {
  if (MCP_PATHS.includes(path)) {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message,
          data: { auth_url: authUrl },
        },
      },
      401,
    );
  }
  return c.json({ error: message, auth_url: authUrl }, 401);
}

export async function jwtAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const path = c.req.path;

  // 면제 경로는 인증 없이 통과
  if (AUTH_EXEMPT_PATHS.includes(path)) {
    return next();
  }

  const authUrl = c.env.AUTH_SERVER_URL ?? AUTH_SERVER_URL_DEFAULT;
  const authHeader = c.req.header('Authorization');

  // Authorization 헤더 없음 또는 Bearer 형식 아님
  if (!authHeader?.startsWith('Bearer ')) {
    console.log('[jwt-auth] 인증 실패: Authorization 헤더 없음 또는 형식 오류', { path });
    return authErrorResponse(c, path, 'Authentication required', authUrl);
  }

  const token = authHeader.slice(7); // 'Bearer ' 이후
  const parts = token.split('.');

  // JWT는 정확히 3개 파트 (header.payload.signature)
  if (parts.length !== 3) {
    console.log('[jwt-auth] 인증 실패: JWT 형식 오류 (parts !== 3)', { path });
    return authErrorResponse(c, path, 'Invalid or expired token', authUrl);
  }

  // parts.length === 3 검사를 통과했으므로 요소가 반드시 존재함
  const headerPart = parts[0]!;
  const payloadPart = parts[1]!;
  const signaturePart = parts[2]!;

  try {
    // JWT 헤더 파싱 및 alg 검증
    const headerBytes = base64UrlDecode(headerPart);
    const headerJson = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string };
    if (headerJson.alg !== 'HS256') {
      console.log('[jwt-auth] 인증 실패: 지원하지 않는 alg', { path, alg: headerJson.alg });
      return authErrorResponse(c, path, 'Invalid or expired token', authUrl);
    }

    // payload 파싱 및 exp 검증 (RFC 7519: exp는 Unix timestamp)
    const payloadBytes = base64UrlDecode(payloadPart);
    const payloadJson = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: number };
    const now = Math.floor(Date.now() / 1000);
    if (!payloadJson.exp || payloadJson.exp <= now) {
      console.log('[jwt-auth] 인증 실패: 토큰 만료 또는 exp 없음', { path });
      return authErrorResponse(c, path, 'Invalid or expired token', authUrl);
    }

    // HMAC-SHA256 서명 검증
    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      // JWT_SECRET 미설정 시 모든 요청 거부
      console.log('[jwt-auth] 인증 실패: JWT_SECRET 미설정', { path });
      return authErrorResponse(c, path, 'Authentication required', authUrl);
    }

    const key = await getCryptoKey(jwtSecret);
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(`${headerPart}.${payloadPart}`);
    const signatureBytes = base64UrlDecode(signaturePart);

    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, dataBytes);
    if (!valid) {
      console.log('[jwt-auth] 인증 실패: 서명 검증 실패', { path });
      return authErrorResponse(c, path, 'Invalid or expired token', authUrl);
    }
  } catch {
    // 파싱/검증 오류 — 내부 세부사항 노출 금지
    console.log('[jwt-auth] 인증 실패: 파싱/검증 예외', { path });
    return authErrorResponse(c, path, 'Invalid or expired token', authUrl);
  }

  return next();
}
