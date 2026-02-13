import type { AISearchResult } from '../core/ai-search';
import type { IFormatter } from './index';

export class MarkdownFormatter implements IFormatter {
  format(results: AISearchResult[]): string {
    if (results.length === 0) {
      return '검색 결과가 없습니다.';
    }

    return results
      .map((r) => `## [${r.title}](${r.url})\n\n${r.content}\n\n---`)
      .join('\n\n');
  }
}
