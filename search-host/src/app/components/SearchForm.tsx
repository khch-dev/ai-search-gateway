'use client';

import { useEffect, useRef, useState } from 'react';

export type Protocol = 'mcp' | 'nlweb' | 'llm-ingest' | 'crawler';
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

  const [r2Keys, setR2Keys] = useState<string[]>([]);
  // true로 초기화: Crawler 선택 직후 r2Keys=[] 상태에서 오류 메시지 flash 방지
  const [r2KeysLoading, setR2KeysLoading] = useState(true);
  // F10: 빈 버킷(정상)과 fetch 실패(오류)를 구분하는 별도 상태
  const [r2KeysFetchError, setR2KeysFetchError] = useState(false);
  // F11: 실패 시 ref를 리셋하여 재시도 허용
  const r2FetchedRef = useRef(false);

  // NLWeb/LLM Ingest도 MCP와 동일하게 html·markdown·json-ld 선택 가능 (포맷 잠금 없음)

  // Crawler 선택 시 Markdown 미지원 → HTML 또는 JSON-LD로 보정
  useEffect(() => {
    if (protocol === 'crawler' && format === 'markdown') {
      setFormat('html');
    }
  }, [protocol, format]);

  // Crawler 최초 선택 시에만 R2 키 목록 fetch (lazy load)
  useEffect(() => {
    if (protocol !== 'crawler' || r2FetchedRef.current) return;
    r2FetchedRef.current = true;
    setR2KeysLoading(true);
    setR2KeysFetchError(false);
    fetch('/api/pages')
      .then((res) => res.json() as Promise<{ keys: string[] }>)
      .then((data) => { setR2Keys(data.keys ?? []); })
      .catch(() => {
        // F11: 실패 시 ref 리셋 → 재시도 가능
        r2FetchedRef.current = false;
        setR2KeysFetchError(true);
      })
      .finally(() => { setR2KeysLoading(false); });
  }, [protocol]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formatToSend = showFormatTabs ? format : 'json-ld';
    onSearch({ protocol, format: formatToSend, query });
  };

  const isCrawler = protocol === 'crawler';
  const showFormatTabs = protocol === 'mcp' || protocol === 'crawler';

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
          <option value="crawler">Crawler (R2 Page Content)</option>
        </select>
      </div>

      {/* 포맷 선택: MCP·Crawler만. NLWeb/LLM Ingest는 스펙 응답만 표시하므로 포맷 선택 없음 */}
      {showFormatTabs && (
        <div className="field-group">
          <label>응답 포맷</label>
          <div className="format-tabs">
            {(isCrawler ? (['html', 'json-ld'] as const) : (['html', 'markdown', 'json-ld'] as const)).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`format-tab ${format === f ? 'active' : ''}`}
                  onClick={() => setFormat(f)}
                  title={isCrawler && f === 'markdown' ? 'Crawler는 Markdown을 지원하지 않습니다' : undefined}
                >
                  {f === 'html' ? 'HTML' : f === 'markdown' ? 'Markdown' : 'JSON-LD'}
                </button>
              ))}
          </div>
          {isCrawler && (
            <p className="format-note">Crawler는 HTML과 JSON-LD 포맷만 지원합니다.</p>
          )}
        </div>
      )}

      {/* 검색어 입력 / R2 파일 선택 */}
      {isCrawler ? (
        <div className="search-input-group">
          <select
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="search-input"
            disabled={r2KeysLoading}
          >
            <option value="">
              {r2KeysLoading
                ? '목록 로딩 중...'
                : r2KeysFetchError
                ? '목록 로드 실패 (재선택하여 재시도)'
                : r2Keys.length === 0
                ? '저장된 페이지 없음'
                : '페이지를 선택하세요...'}
            </option>
            {r2Keys.map((key) => (
              <option key={key} value={key} title={key}>
                {key}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loading || !query} className="search-button">
            {loading ? '로딩 중...' : '조회'}
          </button>
        </div>
      ) : (
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
      )}
    </form>
  );
}
