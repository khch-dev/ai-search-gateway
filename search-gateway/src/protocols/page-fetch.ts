import type { Context } from 'hono';
import type { Env } from '../index';
import { fetchPage, listPageKeys, toSearchResult } from '../core/r2-page';
import { getFormatter } from '../formatters';
import type { FormatType } from '../formatters';

const VALID_FORMATS: FormatType[] = ['html', 'markdown', 'json-ld'];

export const pageHandler = async (
  c: Context<{ Bindings: Env }>,
): Promise<Response> => {
  const url = c.req.query('url');
  const format = (c.req.query('format') ?? 'html') as FormatType;

  if (!url) {
    return c.json({ error: 'url parameter is required' }, 400);
  }
  // F8: url이 http(s):// 스킴을 가진 유효한 URL인지 검증
  if (!/^https?:\/\/.+/.test(url)) {
    return c.json({ error: 'url must be a valid http or https URL' }, 400);
  }
  if (!VALID_FORMATS.includes(format)) {
    return c.json(
      { error: `Invalid format: ${format}. Must be one of: ${VALID_FORMATS.join(', ')}` },
      400,
    );
  }

  try {
    const page = await fetchPage(c.env.R2_AI_SEARCH, url);
    if (!page) {
      return c.json({ error: `Page not found: ${url}` }, 404);
    }

    // html 포맷: HtmlFormatter는 escapeHtml(content) 호출 -> raw HTML 렌더 불가.
    // raw 콘텐츠를 text/html로 직접 반환.
    if (format === 'html') {
      return new Response(page.raw, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // markdown / json-ld: 기존 포매터 재사용
    // TypeScript narrows format to 'markdown' | 'json-ld' after html early return
    const formatted = getFormatter(format).format([toSearchResult(page)]);
    return new Response(formatted, {
      headers: {
        'Content-Type':
          format === 'json-ld'
            ? 'application/json; charset=utf-8'
            : 'text/plain; charset=utf-8',
      },
    });
  } catch {
    return c.json({ error: 'R2 service error' }, 502);
  }
};

export const pagesHandler = async (
  c: Context<{ Bindings: Env }>,
): Promise<Response> => {
  try {
    const keys = await listPageKeys(c.env.R2_AI_SEARCH);
    return c.json({ keys });
  } catch {
    return c.json({ error: 'R2 service error' }, 502);
  }
};
