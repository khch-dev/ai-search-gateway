'use client';

import { useState, useCallback, useRef } from 'react';
import { SearchForm, type SearchParams, type FormatType, type Protocol } from './components/SearchForm';
import { SearchResults } from './components/SearchResults';
import { SearchLogViewer } from './components/SearchLogViewer';
import type { GatewayLogEntry } from './types/gateway-log';

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
  const [resultProtocol, setResultProtocol] = useState<Protocol | null>(null);
  const [gatewayLogEntries, setGatewayLogEntries] = useState<GatewayLogEntry[]>([]);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRef = useRef<HTMLDivElement>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = splitRatio;
    const onMove = (moveEvent: MouseEvent) => {
      const container = splitRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const delta = (moveEvent.clientX - startX) / width;
      let next = startRatio + delta;
      next = Math.min(0.85, Math.max(0.15, next));
      setSplitRatio(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitRatio]);

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    setError(null);
    setResultData(null);
    setResultFormat(params.format);
    setResultProtocol(params.protocol);
    setGatewayLogEntries([]);

    try {
      // Crawler: /api/search POST 미경유, 별도 GET 요청 후 early return
      if (params.protocol === 'crawler') {
        const crawlerResponse = await fetch(
          `/api/page?url=${encodeURIComponent(params.query)}&format=${encodeURIComponent(params.format)}`,
        );
        const text = await crawlerResponse.text();

        if (!crawlerResponse.ok) {
          try {
            const errJson = JSON.parse(text) as Record<string, unknown>;
            setError(extractErrorMessage(errJson['error'] ?? errJson, `HTTP ${crawlerResponse.status}`));
          } catch {
            setError(text || `HTTP ${crawlerResponse.status}`);
          }
          return;
        }

        if (params.format === 'json-ld') {
          try {
            setResultData(JSON.parse(text) as object);
          } catch {
            setResultData(text);
          }
        } else {
          setResultData(text);
        }
        return; // early return — 아래 /api/search 로직 미실행
      }

      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Want-Gateway-Log': 'true',
        },
        body: JSON.stringify(params),
      });

      const isStreaming = response.headers.get('X-MCP-Stream') === 'true' ||
        response.headers.get('Content-Type')?.includes('ndjson');

      if (isStreaming && params.protocol === 'mcp' && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const streamedLogs: GatewayLogEntry[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line) as { type: string; entry?: GatewayLogEntry; body?: string; message?: string };
                if (msg.type === 'log' && msg.entry) {
                  streamedLogs.push(msg.entry);
                  setGatewayLogEntries([...streamedLogs]);
                } else if (msg.type === 'result' && typeof msg.body === 'string') {
                  try {
                    const data = JSON.parse(msg.body) as unknown;
                    const mcpJson = data as Record<string, unknown> | Array<Record<string, unknown>>;
                    const err = Array.isArray(mcpJson)
                      ? mcpJson.find((r) => r['error'] != null)?.['error']
                      : (mcpJson as Record<string, unknown>)['error'];
                    if (err != null) {
                      setError(extractErrorMessage(err, 'MCP 오류가 발생했습니다.'));
                    } else {
                      setResultData(mcpJson);
                    }
                  } catch {
                    setResultData(msg.body);
                  }
                } else if (msg.type === 'error' && msg.message) {
                  setError(msg.message);
                }
              } catch {
                // ignore malformed line
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        return;
      }

      const json = await response.json() as unknown;
      const obj = json as Record<string, unknown>;

      if (Array.isArray(obj['_gatewayLog'])) {
        setGatewayLogEntries(obj['_gatewayLog'] as GatewayLogEntry[]);
      }

      let data: unknown = json;
      if (typeof obj['_body'] === 'string') {
        try {
          data = JSON.parse(obj['_body']) as unknown;
        } catch {
          data = json;
        }
      }

      if (!response.ok) {
        const result = (data as Record<string, unknown>) ?? obj;
        if (Array.isArray(result['errors']) && (result['errors'] as unknown[]).length > 0) {
          const first = (result['errors'] as Array<{ message?: string }>)[0];
          setError(extractErrorMessage(first ?? result['errors'], `HTTP ${response.status}`));
          return;
        }
        const rawError = result['error'];
        setError(extractErrorMessage(rawError, `HTTP ${response.status}`));
        return;
      }

      if (params.protocol === 'mcp') {
        const mcpJson = data as Record<string, unknown> | Array<Record<string, unknown>>;
        const err = Array.isArray(mcpJson)
          ? mcpJson.find((r) => r['error'] != null)?.['error']
          : mcpJson['error'];
        if (err != null) {
          setError(extractErrorMessage(err, 'MCP 오류가 발생했습니다.'));
          return;
        }
        setResultData(mcpJson);
      } else {
        const result = (typeof obj['_body'] === 'string' ? data : obj) as Record<string, unknown>;
        const { _gatewayLog: _, ...rest } = result;
        const payload = Object.keys(rest).length > 0 ? rest : result;
        if (typeof payload['error'] === 'string') {
          setError(payload['error']);
          return;
        }
        if (payload['success'] === false && Array.isArray(payload['errors']) && (payload['errors'] as unknown[]).length > 0) {
          const first = (payload['errors'] as Array<{ code?: number; message?: string }>)[0];
          setError(extractErrorMessage(first ?? payload['errors'], 'API 오류가 발생했습니다.'));
          return;
        }
        if (payload['error'] != null && typeof payload['error'] === 'object') {
          setError(extractErrorMessage(payload['error'], 'API 오류가 발생했습니다.'));
          return;
        }
        setResultData(payload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch failed|Failed to fetch|ECONNREFUSED|NetworkError/i.test(msg)) {
        setError('검색 서버에 연결할 수 없습니다. 개발 서버(next dev) 실행 여부와 네트워크를 확인하세요.');
      } else {
        setError(msg || '알 수 없는 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="main-container">
      <header className="site-header">
        <h1>AI Search Test</h1>
        <p className="subtitle">NHN ACE 검색 인터페이스</p>
      </header>

      <SearchForm onSearch={handleSearch} loading={loading} />

      {((loading && resultProtocol !== 'crawler') || gatewayLogEntries.length > 0) ? (
        <div
          ref={splitRef}
          className="search-log-and-results"
          style={{
            gridTemplateColumns: `minmax(0, ${splitRatio}fr) 8px minmax(0, ${1 - splitRatio}fr)`,
          }}
        >
          <div className="search-log-and-results__pane">
            <SearchLogViewer entries={gatewayLogEntries} onClear={() => setGatewayLogEntries([])} />
          </div>
          <div
            className="search-log-and-results__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitRatio * 100)}
            aria-valuemin={15}
            aria-valuemax={85}
            onMouseDown={onResizeStart}
          />
          <div className="search-log-and-results__pane">
            <SearchResults
              protocol={resultProtocol}
              format={resultFormat}
              data={resultData}
              loading={loading}
              error={error}
            />
          </div>
        </div>
      ) : (
        <div className="search-results-only">
          <SearchResults
            protocol={resultProtocol}
            format={resultFormat}
            data={resultData}
            loading={loading}
            error={error}
          />
        </div>
      )}
    </main>
  );
}
