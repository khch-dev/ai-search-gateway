import type { AISearchResult } from '../core/ai-search';
import type { IFormatter } from './index';

export class JsonLdFormatter implements IFormatter {
  format(results: AISearchResult[]): string {
    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      numberOfItems: results.length,
      itemListElement: results.map((r, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'WebPage',
          url: r.url,
          name: r.title,
          description: r.content,
          ...(r.score !== undefined && { 'schema:score': r.score }),
        },
      })),
    };

    return JSON.stringify(itemList, null, 2);
  }
}
