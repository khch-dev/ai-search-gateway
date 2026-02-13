'use client';

import { useState } from 'react';
import { SearchForm, type SearchParams, type FormatType } from './components/SearchForm';
import { SearchResults } from './components/SearchResults';

/** 알 수 없는 에러 값을 안전하게 문자열로 변환 */
function extractErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // JSON-RPC error: { code, message }
    if (typeof obj['message'] === 'string') return obj['message'];
    // Cloudflare API error: { error: string }
    if (typeof obj['error'] === 'string') return obj['error'];
    return JSON.stringify(value);
  }
  return fallback;
}

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
        const result = json as Record<string, unknown>;
        // Cloudflare API: errors 배열
        if (Array.isArray(result['errors']) && (result['errors'] as unknown[]).length > 0) {
          const first = (result['errors'] as Array<{ message?: string }>)[0];
          setError(extractErrorMessage(first ?? result['errors'], `HTTP ${response.status}`));
          return;
        }
        const rawError = result['error'];
        setError(extractErrorMessage(rawError, `HTTP ${response.status}`));
        return;
      }

      // MCP: Client SDK 응답 처리 ({ text: string } 형식)
      if (params.protocol === 'mcp') {
        const mcpJson = json as Record<string, unknown>;

        if (mcpJson['error']) {
          setError(extractErrorMessage(mcpJson['error'], 'MCP 오류가 발생했습니다.'));
          return;
        }
        // route.ts가 { text: string } 반환 — format에 따라 파싱
        const text = typeof mcpJson['text'] === 'string' ? mcpJson['text'] : '';
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
        // 단, 최상위에 error 필드가 있으면 에러 처리
        const result = json as Record<string, unknown>;
        if (typeof result['error'] === 'string') {
          setError(result['error']);
          return;
        }
        // Cloudflare API 오류 형식: { success: false, errors: [{ code, message }] }
        if (result['success'] === false && Array.isArray(result['errors']) && (result['errors'] as unknown[]).length > 0) {
          const first = (result['errors'] as Array<{ code?: number; message?: string }>)[0];
          setError(extractErrorMessage(first ?? result['errors'], 'API 오류가 발생했습니다.'));
          return;
        }
        // error가 문자열이 아닌 객체({ code, message })인 경우
        if (result['error'] != null && typeof result['error'] === 'object') {
          setError(extractErrorMessage(result['error'], 'API 오류가 발생했습니다.'));
          return;
        }
        // API가 _rawGatewayPayload를 포함한 전체 객체를 반환 (화면에서 gateway 원문 노출)
        setResultData(result);
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
