import type { AISearchResult } from '../core/ai-search';
import type { IFormatter } from './index';

/** 제목에 ] 가 있으면 마크다운 링크가 깨지므로 이스케이프 */
function escapeMarkdownLinkText(s: string): string {
  return s.replace(/\]/g, '\\]');
}

/** 닫히지 않은 코드 펜스(```)가 있으면 닫아서 파서가 깨지지 않도록 함 */
function ensureCodeFencesClosed(md: string): string {
  const fence = '```';
  let count = 0;
  let i = 0;
  while (i < md.length) {
    const idx = md.indexOf(fence, i);
    if (idx === -1) break;
    count += 1;
    i = idx + fence.length;
  }
  if (count % 2 !== 0) return md + '\n' + fence;
  return md;
}

export class MarkdownFormatter implements IFormatter {
  format(results: AISearchResult[]): string {
    if (results.length === 0) {
      return '검색 결과가 없습니다.';
    }

    return results
      .map((r) => {
        const block = `## [${escapeMarkdownLinkText(r.title)}](${r.url})\n\n${r.content}`;
        return ensureCodeFencesClosed(block) + '\n\n---';
      })
      .join('\n\n');
  }
}
