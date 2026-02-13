'use client';

import { useState } from 'react';
import { SearchForm, type SearchParams, type FormatType } from './components/SearchForm';
import { SearchResults } from './components/SearchResults';

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<string | object | null>(null);
  const [resultFormat, setResultFormat] = useState<FormatType | null>(null);

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    setError(null);
    setResultData(null);
    setResultFormat(params.format);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const json = await response.json() as unknown;

      if (!response.ok) {
        const errMsg = (json as { error?: string }).error ?? `HTTP ${response.status}`;
        setError(errMsg);
        return;
      }

      // MCP 응답: content[0].text에서 실제 데이터 추출
      if (params.protocol === 'mcp') {
        const mcpResult = json as { result?: { content?: Array<{ text?: string }> } };
        const text = mcpResult.result?.content?.[0]?.text ?? '';
        if (params.format === 'json-ld') {
          try {
            setResultData(JSON.parse(text) as object);
          } catch {
            setResultData(text);
          }
        } else {
          setResultData(text);
        }
      } else {
        // NLWeb / LLM Ingest: 응답 JSON 그대로
        setResultData(json as object);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="main-container">
      <header className="site-header">
        <h1>AI Search Gateway</h1>
        <p className="subtitle">Cloudflare AutoRAG 검색 인터페이스</p>
      </header>

      <SearchForm onSearch={handleSearch} loading={loading} />

      <SearchResults
        format={resultFormat}
        data={resultData}
        loading={loading}
        error={error}
      />
    </main>
  );
}
