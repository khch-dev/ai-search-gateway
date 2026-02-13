import type { AISearchResult } from '../core/ai-search';
import { HtmlFormatter } from './html';
import { MarkdownFormatter } from './markdown';
import { JsonLdFormatter } from './jsonld';

export type FormatType = 'html' | 'markdown' | 'json-ld';

export interface IFormatter {
  format(results: AISearchResult[]): string;
}

export function getFormatter(type: FormatType): IFormatter {
  switch (type) {
    case 'html':
      return new HtmlFormatter();
    case 'markdown':
      return new MarkdownFormatter();
    case 'json-ld':
      return new JsonLdFormatter();
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown format: ${_exhaustive}`);
    }
  }
}
