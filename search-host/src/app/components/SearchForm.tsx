'use client';

import { useEffect, useState } from 'react';

export type Protocol = 'mcp' | 'nlweb' | 'llm-ingest';
export type FormatType = 'html' | 'markdown' | 'json-ld';

export interface SearchParams {
  protocol: Protocol;
  format: FormatType;
  query: string;
}

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  loading: boolean;
}

export function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [protocol, setProtocol] = useState<Protocol>('mcp');
  const [format, setFormat] = useState<FormatType>('json-ld');
  const [query, setQuery] = useState('');

  // NLWeb 선택 시 포맷 자동 JSON-LD로 고정
  useEffect(() => {
    if (protocol === 'nlweb') {
      setFormat('json-ld');
    }
  }, [protocol]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({ protocol, format, query });
  };

  const isNLWeb = protocol === 'nlweb';

  return (
    <form onSubmit={handleSubmit} className="search-form">
      {/* 프로토콜 선택 */}
      <div className="field-group">
        <label htmlFor="protocol">프로토콜</label>
        <select
          id="protocol"
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as Protocol)}
        >
          <option value="mcp">MCP (Model Context Protocol)</option>
          <option value="nlweb">NLWeb</option>
          <option value="llm-ingest">LLM Ingest (IAB CMP)</option>
        </select>
      </div>

      {/* 포맷 선택 */}
      <div className="field-group">
        <label>응답 포맷</label>
        <div className="format-tabs">
          {(['html', 'markdown', 'json-ld'] as const).map((f) => {
            const isDisabled = isNLWeb && f !== 'json-ld';
            return (
              <button
                key={f}
                type="button"
                className={`format-tab ${format === f ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => !isDisabled && setFormat(f)}
                disabled={isDisabled}
                title={isDisabled ? 'NLWeb은 JSON-LD 포맷만 지원합니다' : undefined}
              >
                {f === 'html' ? 'HTML' : f === 'markdown' ? 'Markdown' : 'JSON-LD'}
              </button>
            );
          })}
        </div>
        {isNLWeb && (
          <p className="format-note">NLWeb 프로토콜은 JSON-LD 포맷만 지원합니다.</p>
        )}
      </div>

      {/* 검색어 입력 */}
      <div className="search-input-group">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색어를 입력하세요..."
          required
          className="search-input"
        />
        <button type="submit" disabled={loading} className="search-button">
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>
    </form>
  );
}
