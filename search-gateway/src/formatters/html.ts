import type { AISearchResult } from '../core/ai-search';
import type { IFormatter } from './index';

export class HtmlFormatter implements IFormatter {
  format(results: AISearchResult[]): string {
    if (results.length === 0) {
      return '<div class="search-results"><p class="no-results">검색 결과가 없습니다.</p></div>';
    }

    const items = results
      .map(
        (r) =>
          `<article class="search-result">
  <h2><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></h2>
  <p>${escapeHtml(r.content)}</p>${r.score !== undefined ? `\n  <span class="score">Score: ${r.score.toFixed(3)}</span>` : ''}
</article>`,
      )
      .join('\n');

    return `<div class="search-results">\n${items}\n</div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
