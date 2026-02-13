'use client';

import { useEffect, useState } from 'react';
import type { FormatType } from './SearchForm';

interface SearchResultsProps {
  format: FormatType | null;
  data: string | object | null;
  loading: boolean;
  error: string | null;
}

export function SearchResults({ format, data, loading, error }: SearchResultsProps) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string>('');

  // F7: DOMPurify는 클라이언트 전용 라이브러리 사용
  // useEffect는 항상 클라이언트에서만 실행되므로 SSR 문제 없음
  useEffect(() => {
    if (format !== 'html' || typeof data !== 'string') {
      setSanitizedHtml('');
      return;
    }

    import('dompurify').then(({ default: DOMPurify }) => {
      setSanitizedHtml(DOMPurify.sanitize(data));
    }).catch(() => {
      // 로드 실패 시 이스케이프 처리로 안전하게 표시
      setSanitizedHtml(
        data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      );
    });
  }, [format, data]);

  if (loading) {
    return (
      <div className="search-results-container loading">
        <p>검색 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="search-results-container error">
        <div className="error-box">
          <strong>오류 발생:</strong> {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const isEmpty =
    (typeof data === 'string' && data.trim() === '') ||
    (typeof data === 'object' && Array.isArray(data) && data.length === 0);

  if (isEmpty) {
    return (
      <div className="search-results-container">
        <p className="no-results">검색 결과가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="search-results-container">
      {format === 'html' && (
        <div
          className="html-results"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      )}

      {format === 'markdown' && (
        <pre className="markdown-results whitespace-pre-wrap">
          {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
        </pre>
      )}

      {(format === 'json-ld' || format === null) && (
        <pre className="jsonld-results">
          <code>
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </code>
        </pre>
      )}
    </div>
  );
}
