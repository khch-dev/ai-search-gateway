'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { FormatType, Protocol } from './SearchForm';

interface SearchResultsProps {
  protocol: Protocol | null;
  format: FormatType | null;
  data: string | object | null;
  loading: boolean;
  error: string | null;
}

function extractMcpContentText(data: object | null): string {
  if (data === null) return '';
  type McpResponse = { result?: { content?: Array<{ type?: string; text?: string }> }; content?: Array<{ type?: string; text?: string }> };
  const raw = data as McpResponse | McpResponse[];
  const envelope: McpResponse = Array.isArray(raw)
    ? (raw.find((r) => r?.result?.content != null) ?? raw[0])
    : raw;
  const content = envelope?.result?.content ?? envelope?.content ?? [];
  return content[0]?.text ?? '';
}

/** 닫히지 않은 코드 펜스(```)가 있으면 닫아서 마크다운 파서/렌더러 경계 오류 방지 */
function ensureCodeFencesClosed(md: string): string {
  const fence = '```';
  let count = 0;
  let i = 0;
  while (i < md.length) {
    const idx = md.indexOf(fence, i);
    if (idx === -1) break;
    count += 1;
    i = idx + fence.length;
  }
  if (count % 2 !== 0) return md + '\n' + fence;
  return md;
}

export function SearchResults({ protocol, format, data, loading, error }: SearchResultsProps) {
  const [sanitizedHtml, setSanitizedHtml] = useState<string>('');
  const [mcpMarkdownText, setMcpMarkdownText] = useState<string>('');
  const [mcpJsonLdDisplay, setMcpJsonLdDisplay] = useState<string>('');
  const [specResponseDisplay, setSpecResponseDisplay] = useState<string>('');

  // F7: DOMPurify는 클라이언트 전용 라이브러리 사용
  // useEffect는 항상 클라이언트에서만 실행되므로 SSR 문제 없음
  useEffect(() => {
    if (protocol === 'mcp' && format === 'markdown' && typeof data === 'object' && data !== null) {
      const raw = extractMcpContentText(data);
      setMcpMarkdownText(ensureCodeFencesClosed(raw));
      return;
    }
    setMcpMarkdownText('');
  }, [protocol, format, data]);

  // MCP + JSON-LD: content text(JSON 문자열)를 파싱해 객체로 포맷한 문자열로 저장
  useEffect(() => {
    if (protocol === 'mcp' && format === 'json-ld' && typeof data === 'object' && data !== null) {
      const raw = extractMcpContentText(data);
      if (!raw.trim()) {
        setMcpJsonLdDisplay('');
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        setMcpJsonLdDisplay(JSON.stringify(parsed, null, 2));
      } catch {
        setMcpJsonLdDisplay(raw);
      }
      return;
    }
    setMcpJsonLdDisplay('');
  }, [protocol, format, data]);

  // NLWeb / LLM Ingest: 스펙 응답만 JSON으로 표시 (_rawGatewayPayload, _gatewayLog 제외)
  useEffect(() => {
    if ((protocol === 'nlweb' || protocol === 'llm-ingest') && typeof data === 'object' && data !== null) {
      const payload = data as Record<string, unknown>;
      const { _rawGatewayPayload: _, _gatewayLog: __, ...specOnly } = payload;
      setSpecResponseDisplay(JSON.stringify(specOnly, null, 2));
      return;
    }
    setSpecResponseDisplay('');
  }, [protocol, data]);

  useEffect(() => {
    // MCP + HTML: 게이트웨이 JSON-RPC 2.0 응답(단일 객체 또는 배치 배열)에서 result.content[0].text 추출
    if (protocol === 'mcp' && format === 'html' && typeof data === 'object' && data !== null) {
      const htmlText = extractMcpContentText(data);
      import('dompurify').then(({ default: DOMPurify }) => {
        setSanitizedHtml(DOMPurify.sanitize(htmlText));
      }).catch(() => {
        setSanitizedHtml(htmlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      });
      return;
    }
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
  }, [protocol, format, data]);

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

  // { code, message } 같은 에러 객체가 data로 넘어오면 직접 렌더 시 "Objects are not valid as React child" 발생
  const isErrorShape =
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    'code' in data &&
    'message' in data;
  if (isErrorShape) {
    const err = data as { code?: unknown; message?: unknown };
    const msg = typeof err.message === 'string' ? err.message : JSON.stringify(data);
    return (
      <div className="search-results-container error">
        <div className="error-box">
          <strong>API 오류:</strong> {msg}
        </div>
      </div>
    );
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

  // ── MCP + HTML: HTML 렌더링 영역만 표시 ──
  if (protocol === 'mcp' && format === 'html') {
    return (
      <div className="search-results-container">
        <div
          className="html-results"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          style={{ minHeight: '40vh', overflow: 'auto', padding: '1rem', border: '1px solid #eee', borderRadius: 6, background: '#fff' }}
        />
      </div>
    );
  }

  // ── MCP + Markdown: content[0].text 마크다운 렌더링 ──
  if (protocol === 'mcp' && format === 'markdown') {
    return (
      <div className="search-results-container">
        <div
          className="markdown-rendered"
          style={{ minHeight: '40vh', overflow: 'auto', padding: '1rem', border: '1px solid #eee', borderRadius: 6, background: '#fff' }}
        >
          <ReactMarkdown>{mcpMarkdownText}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // ── MCP + JSON-LD: content text(JSON 문자열)를 JSON 객체로 파싱·포맷 후 렌더링 ──
  if (protocol === 'mcp' && format === 'json-ld') {
    return (
      <div className="search-results-container">
        <pre className="jsonld-results" style={{ maxHeight: '70vh', overflow: 'auto', padding: '1rem', border: '1px solid #eee', borderRadius: 6, background: '#fff' }}>
          <code>{mcpJsonLdDisplay}</code>
        </pre>
      </div>
    );
  }

  // ── NLWeb / LLM Ingest: 스펙 응답 원문만 JSON으로 표시 (UI 포맷팅 없음) ──
  if (protocol === 'nlweb' || protocol === 'llm-ingest') {
    return (
      <div className="search-results-container">
        <pre className="jsonld-results" style={{ maxHeight: '70vh', overflow: 'auto', padding: '1rem', border: '1px solid #eee', borderRadius: 6, background: '#fff' }}>
          <code>{specResponseDisplay}</code>
        </pre>
      </div>
    );
  }

  // ── Crawler: HTML 소스 / JSON-LD payload 그대로 출력 ──
  if (protocol === 'crawler') {
    const crawlerPayloadString =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return (
      <div className="search-results-container">
        <pre className="jsonld-results" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <code>{crawlerPayloadString}</code>
        </pre>
      </div>
    );
  }

  // ── Crawler 제외: 각 프로토콜 응답 포맷 그대로 하단에 출력 ──
  const rawPayload =
    typeof data === 'object' && data !== null && '_rawGatewayPayload' in data
      ? (data as Record<string, unknown>)['_rawGatewayPayload']
      : null;
  const hasRawPayload = typeof rawPayload === 'string';
  const displayData =
    hasRawPayload && typeof data === 'object' && data !== null
      ? (() => {
          const rest = { ...(data as Record<string, unknown>) };
          delete rest['_rawGatewayPayload'];
          return rest;
        })()
      : data;
  const dataString =
    typeof displayData === 'string' ? displayData : JSON.stringify(displayData, null, 2);
  const showAsJson = typeof displayData !== 'string';

  return (
    <div className="search-results-container">
      {hasRawPayload && (
        <section className="gateway-raw-payload" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Gateway 응답 원문</h3>
          <pre className="jsonld-results" style={{ maxHeight: '40vh', overflow: 'auto' }}>
            <code>{rawPayload}</code>
          </pre>
        </section>
      )}

      {format === 'html' && !showAsJson && (
        <div
          className="html-results"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      )}

      {(format === 'html' && showAsJson) || format === 'markdown' ? (
        <pre className="markdown-results whitespace-pre-wrap">{dataString}</pre>
      ) : null}

      {(format === 'json-ld' || format === null) && (
        <pre className="jsonld-results">
          <code>{dataString}</code>
        </pre>
      )}
    </div>
  );
}
