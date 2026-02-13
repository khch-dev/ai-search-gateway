import type { Context, Next } from 'hono';

const LIMIT = 60;
const WINDOW_MS = 60_000; // 1분
// F6: 만료 항목 정리 주기 (5분마다)
const CLEANUP_INTERVAL_MS = 5 * 60_000;

const store = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function cleanupExpired(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  for (const [ip, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(ip);
    }
  }
  lastCleanup = now;
}

// F13: Hono MiddlewareHandler 시그니처에 맞게 반환 타입 수정
export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();

  // F6: 만료 항목 주기적 정리
  cleanupExpired(now);

  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else if (entry.count >= LIMIT) {
    return c.json(
      { error: 'Rate limit exceeded. Max 60 requests/min.' },
      429,
    );
  } else {
    entry.count++;
  }

  return next();
}
