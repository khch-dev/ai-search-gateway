import { describe, it, expect } from 'vitest';
import type { AISearchResult } from '../src/core/ai-search';
import { HtmlFormatter } from '../src/formatters/html';
import { MarkdownFormatter } from '../src/formatters/markdown';
import { JsonLdFormatter } from '../src/formatters/jsonld';

const mockResults: AISearchResult[] = [
  {
    url: 'https://example.com/page1',
    title: 'NHN 소개',
    content: 'NHN은 대한민국의 IT 기업입니다.',
    score: 0.95,
  },
  {
    url: 'https://example.com/page2',
    title: 'NHN 서비스',
    content: 'NHN은 다양한 클라우드 서비스를 제공합니다.',
    score: 0.87,
  },
];

describe('HtmlFormatter', () => {
  it('should wrap results in .search-results div', () => {
    const formatter = new HtmlFormatter();
    const output = formatter.format(mockResults);
    expect(output).toContain('<div class="search-results">');
    expect(output).toContain('</div>');
  });

  it('should render each result as an article with link', () => {
    const formatter = new HtmlFormatter();
    const output = formatter.format(mockResults);
    expect(output).toContain('<article class="search-result">');
    expect(output).toContain('href="https://example.com/page1"');
    expect(output).toContain('NHN 소개');
  });

  it('should escape HTML special characters', () => {
    const formatter = new HtmlFormatter();
    const output = formatter.format([
      { url: 'https://example.com', title: '<script>alert(1)</script>', content: 'safe' },
    ]);
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('should return no-results message for empty array', () => {
    const formatter = new HtmlFormatter();
    const output = formatter.format([]);
    expect(output).toContain('<div class="search-results">');
    expect(output).toContain('검색 결과가 없습니다.');
  });
});

describe('MarkdownFormatter', () => {
  it('should render ## headings for each result', () => {
    const formatter = new MarkdownFormatter();
    const output = formatter.format(mockResults);
    expect(output).toContain('## [NHN 소개](https://example.com/page1)');
    expect(output).toContain('## [NHN 서비스](https://example.com/page2)');
  });

  it('should separate results with ---', () => {
    const formatter = new MarkdownFormatter();
    const output = formatter.format(mockResults);
    expect(output).toContain('---');
  });

  it('should return message for empty array', () => {
    const formatter = new MarkdownFormatter();
    const output = formatter.format([]);
    expect(output).toBe('검색 결과가 없습니다.');
  });
});

describe('JsonLdFormatter', () => {
  it('should produce valid JSON with @type ItemList', () => {
    const formatter = new JsonLdFormatter();
    const output = formatter.format(mockResults);
    const parsed = JSON.parse(output);
    expect(parsed['@type']).toBe('ItemList');
    expect(parsed['@context']).toBe('https://schema.org');
  });

  it('should include all results as ListItem elements', () => {
    const formatter = new JsonLdFormatter();
    const output = formatter.format(mockResults);
    const parsed = JSON.parse(output);
    expect(parsed.itemListElement).toHaveLength(2);
    expect(parsed.itemListElement[0]['@type']).toBe('ListItem');
    expect(parsed.itemListElement[0].item['@type']).toBe('WebPage');
  });

  it('should set numberOfItems correctly', () => {
    const formatter = new JsonLdFormatter();
    const output = formatter.format(mockResults);
    const parsed = JSON.parse(output);
    expect(parsed.numberOfItems).toBe(2);
  });

  it('should return ItemList with 0 items for empty array', () => {
    const formatter = new JsonLdFormatter();
    const output = formatter.format([]);
    const parsed = JSON.parse(output);
    expect(parsed['@type']).toBe('ItemList');
    expect(parsed.itemListElement).toHaveLength(0);
  });
});
