'use client';

import { useEffect, useState } from 'react';

export type Protocol = 'mcp' | 'nlweb' | 'llm-ingest';
export type FormatType = 'html' | 'markdown' | 'json-ld';

export interface SearchParams {
  protocol: Protocol;
  format: FormatType;
  query: string;
  accountId: string;
  apiToken: string;
  autoragName: string;
}

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  loading: boolean;
}

const STORAGE_KEY = 'sg_credentials';

interface StoredCredentials {
  accountId: string;
  apiToken: string;
  autoragName: string;
}

export function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [accountId, setAccountId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [autoragName, setAutoragName] = useState('');
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>('mcp');
  const [format, setFormat] = useState<FormatType>('json-ld');
  const [query, setQuery] = useState('');

  // 마운트 시 localStorage에서 자격증명 로드
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const creds = JSON.parse(stored) as StoredCredentials;
        setAccountId(creds.accountId ?? '');
        setApiToken(creds.apiToken ?? '');
        setAutoragName(creds.autoragName ?? '');
        setRememberCredentials(true);
      }
    } catch {
      // 파싱 실패 시 무시
    }
  }, []);

  // NLWeb 선택 시 포맷 자동 JSON-LD로 고정
  useEffect(() => {
    if (protocol === 'nlweb') {
      setFormat('json-ld');
    }
  }, [protocol]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (rememberCredentials) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ accountId, apiToken, autoragName } satisfies StoredCredentials),
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    onSearch({ protocol, format, query, accountId, apiToken, autoragName });
  };

  const isNLWeb = protocol === 'nlweb';

  return (
    <form onSubmit={handleSubmit} className="search-form">
      {/* 자격증명 섹션 */}
      <fieldset className="credentials-fieldset">
        <legend>Cloudflare AutoRAG 자격증명</legend>

        <div className="field-group">
          <label htmlFor="accountId">Account ID</label>
          <input
            id="accountId"
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="7ba38cba..."
            required
            autoComplete="off"
          />
        </div>

        <div className="field-group">
          <label htmlFor="apiToken">API Token</label>
          <input
            id="apiToken"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Bearer token"
            required
            autoComplete="current-password"
          />
        </div>

        <div className="field-group">
          <label htmlFor="autoragName">AutoRAG Name</label>
          <input
            id="autoragName"
            type="text"
            value={autoragName}
            onChange={(e) => setAutoragName(e.target.value)}
            placeholder="crimson-shadow-a101"
            required
            autoComplete="off"
          />
        </div>

        <div className="remember-section">
          <label className="remember-label">
            <input
              type="checkbox"
              checked={rememberCredentials}
              onChange={(e) => setRememberCredentials(e.target.checked)}
            />
            <span>자격증명 기억하기</span>
          </label>
          {rememberCredentials && (
            <p className="warning-text">
              ⚠️ 자격증명이 브라우저 localStorage에 저장됩니다. 공유 기기에서는 사용하지 마세요.
            </p>
          )}
        </div>
      </fieldset>

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
